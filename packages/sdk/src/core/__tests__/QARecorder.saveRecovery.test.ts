import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';
import type { ScreenRecorder } from '../../recorder/ScreenRecorder.js';
import type { HARDocument } from '../../types/har.js';

/**
 * 저장 실패 복구 회귀 테스트 — 실제 rrweb으로 녹화한다 (확인창·다운로드·업로드만 대체).
 * 분석 당시 재현: maxReplaySize 20000, 정적인 페이지에서 로컬 다운로드 실패를 10번 반복하면
 * 리플레이 JSON이 계속 커지고(13,527자 → 159,823자) 전체 스냅샷이 1개 → 11개로 쌓였다.
 */

const mocks = vi.hoisted(() => ({ save: vi.fn(), send: vi.fn() }));
vi.mock('../../ui/ConfirmModal.js', () => ({ ConfirmModal: { show: async () => ({ confirmed: true, memo: '' }) } }));
vi.mock('../../storage/LocalStorage.js', () => ({ LocalStorage: { save: mocks.save } }));
vi.mock('../../storage/RemoteDelivery.js', () => ({
  RemoteDelivery: class { send(...args: unknown[]) { return mocks.send(...args); } },
}));

type RrwebEvent = { type: number; data?: Record<string, unknown> };
type Internals = { screenRecorder: ScreenRecorder; activeSave: object | null };
const internals = (r: QARecorder) => r as unknown as Internals;
const replay = (r: QARecorder) => internals(r).screenRecorder.getEvents() as RrwebEvent[];
const jsonSize = (events: unknown[]) => JSON.stringify(events).length;
const fullSnapshots = (events: RrwebEvent[]) => events.filter((e) => e.type === 2).length;
/** 재생 가능한 리플레이: Meta + FullSnapshot으로 시작하고, 첫 스냅샷 앞에 고아 변경이 없다 */
const playable = (events: RrwebEvent[]) => events[0]?.type === 4 && events[1]?.type === 2;

/** MutationObserver 콜백과 rrweb 처리가 끝날 때까지 */
const flush = () => new Promise((r) => setTimeout(r, 0));

function staticPage(paragraphs: number, text = 'Static paragraph with some text') {
  document.body.innerHTML = `<main>${Array.from({ length: paragraphs }, (_, i) =>
    `<p class="row" id="p${i}">${text} ${i}</p>`).join('')}</main>`;
}

async function save(recorder: QARecorder) {
  document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('button')!.click();
  await vi.waitFor(() => expect(internals(recorder).activeSave).toBeNull());
  await flush();
}

let alerts: string[];
let recorder: QARecorder | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  alerts = [];
  vi.spyOn(window, 'alert').mockImplementation((m?: string) => { alerts.push(String(m)); });
});

afterEach(() => {
  recorder?.destroy();
  recorder = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('반복 저장 실패와 리플레이 보관량', () => {
  it('정적인 페이지에서 로컬 다운로드 실패를 10번 반복해도 보관량과 스냅샷 수가 그대로다', async () => {
    staticPage(60);
    mocks.save.mockRejectedValue(new Error('download blocked'));
    recorder = new QARecorder({ maxReplaySize: 20_000 });
    await recorder.init();
    const initial = jsonSize(replay(recorder));
    // 저장할 때마다 SDK 진행 막대(rr-block 자리표시자)의 추가·삭제가 변경 이벤트로 기록된다 — 한 번에 1,000자 미만
    const perSave = 1_000;

    for (let i = 1; i <= 10; i++) {
      await save(recorder);
      const events = replay(recorder);
      expect(fullSnapshots(events)).toBe(1);
      expect(jsonSize(events)).toBeLessThan(initial + i * perSave);
      expect(playable(events)).toBe(true);
    }
    // 10번 실패한 뒤에도 스냅샷 하나 분량(분석 당시에는 스냅샷 11개, 약 12배)
    expect(jsonSize(replay(recorder))).toBeLessThan(initial * 2);
    // 매번 저장한 리플레이도 스냅샷이 하나뿐이다 — 실패한 저장의 스냅샷이 다음 저장에 쌓이지 않는다
    const saved = mocks.save.mock.calls.map(([events]) => events as RrwebEvent[]);
    expect(saved.every((events) => fullSnapshots(events) === 1 && playable(events))).toBe(true);
    expect(alerts.every((m) => m.endsWith('The recording was kept. Please try again.'))).toBe(true);
  });

  it('업로드와 로컬 대체 저장이 모두 실패해도 같다. 이어서 재시도에 성공하면 그동안의 변경이 한 번씩 들어간 재생 가능한 리플레이가 저장된다', async () => {
    staticPage(20);
    mocks.send.mockRejectedValue(new Error('network down'));
    mocks.save.mockRejectedValue(new Error('download blocked'));
    recorder = new QARecorder({ endpoint: 'https://qa.example.com/upload', maxReplaySize: 20_000 });
    await recorder.init();

    const marks: string[] = [];
    for (let i = 0; i < 5; i++) {
      // 저장하는 동안(업로드 대기 중) 페이지가 바뀐다
      mocks.send.mockImplementationOnce(async () => {
        const mark = `changed-during-save-${i}`;
        document.getElementById(`p${i}`)!.textContent = mark;
        marks.push(mark);
        await flush();
        throw new Error('network down');
      });
      await save(recorder);
      expect(fullSnapshots(replay(recorder))).toBe(1);
      expect(alerts.at(-1)).toContain('Upload failed: network down');
      expect(alerts.at(-1)).toContain('Save failed: download blocked');
      expect(alerts.at(-1)).toContain('The recording was kept. Please try again.');
    }

    mocks.send.mockResolvedValue('https://qa.example.com/share/1');
    await save(recorder);
    const uploaded = mocks.send.mock.calls.at(-1)!;
    const events = JSON.parse(await (uploaded[0] as Blob).text()) as RrwebEvent[];
    expect(playable(events)).toBe(true);
    expect(fullSnapshots(events)).toBe(1);
    // 저장 중에 기록된 변경이 각각 정확히 한 번씩 들어 있다 (중복도 소실도 없음)
    const json = JSON.stringify(events);
    for (const mark of marks) expect(json.split(mark).length - 1).toBe(1);
    // 성공 뒤에는 자를 때 시작한 구간만 남는다
    expect(fullSnapshots(replay(recorder))).toBe(1);
  });

  it('큰 DOM과 작은 maxReplaySize: 스냅샷 하나가 제한보다 커도 실패를 반복하며 쌓이지 않고, 저장하는 리플레이는 재생 가능하다', async () => {
    staticPage(400, 'Large static page paragraph with quite a lot of text in it');
    mocks.save.mockRejectedValue(new Error('download blocked'));
    recorder = new QARecorder({ maxReplaySize: 10_000 });
    await recorder.init();
    const initial = replay(recorder);
    expect(jsonSize(initial)).toBeGreaterThan(10_000); // 스냅샷 하나가 제한보다 크다

    const sizes: number[] = [];
    for (let i = 0; i < 6; i++) {
      document.getElementById(`p${i}`)!.textContent = `edit ${i}`;
      await flush();
      await save(recorder);
      const events = replay(recorder);
      sizes.push(jsonSize(events));
      expect(fullSnapshots(events)).toBe(1);
      expect(playable(events)).toBe(true);
    }
    // 변경 몇 개만큼만 늘어난다 — 실패마다 (제한보다 큰) 스냅샷이 더해지지 않는다
    expect(sizes.at(-1)! - jsonSize(initial)).toBeLessThan(6 * 1_000);

    mocks.save.mockResolvedValue(undefined);
    await save(recorder);
    const saved = mocks.save.mock.calls.at(-1)![0] as RrwebEvent[];
    expect(playable(saved)).toBe(true);
    expect(fullSnapshots(saved)).toBe(1);
  });

  it('저장하는 동안의 기록 때문에 되돌린 녹화가 제한을 넘으면 오래된 부분을 버리고, 안내도 모두 남았다고 하지 않는다', async () => {
    staticPage(10);
    recorder = new QARecorder({ maxReplaySize: 6_000, maxRequests: 2 });
    await recorder.init();
    const appFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const nativeFetch = window.fetch;
    window.fetch = appFetch as unknown as typeof fetch;
    try {
      // 녹화를 다시 시작해 패치가 appFetch를 감싸게 한다
      recorder.destroy();
      await recorder.init();
      await window.fetch('https://app.example.com/a');
      await window.fetch('https://app.example.com/b');

      mocks.save.mockImplementationOnce(async () => {
        // 저장하는 동안 페이지가 많이 바뀌어 크기 기준 체크아웃이 여러 번 일어나고, 요청 버퍼(2개)도 새 요청으로 밀려난다
        for (let i = 0; i < 40; i++) {
          document.getElementById(`p${i % 10}`)!.textContent = `busy ${i} ${'x'.repeat(200)}`;
          await flush();
        }
        await window.fetch('https://app.example.com/c');
        await window.fetch('https://app.example.com/d');
        throw new Error('download blocked');
      });
      await save(recorder);

      const message = alerts.at(-1)!;
      expect(message).toContain('Save failed: download blocked');
      expect(message).not.toContain('The recording was kept. Please try again.');
      expect(message).toMatch(/except for its oldest part.*\d+ replay events, 2 network requests/);
      const events = replay(recorder);
      expect(playable(events)).toBe(true);
      // 보관 정책: 마지막 두 구간만 남고(되돌린 오래된 구간은 버림), 한 구간은 제한의 절반 또는 스냅샷의 약 두 배까지 커진다
      const segments = (internals(recorder).screenRecorder as unknown as { segments: unknown[] }).segments;
      expect(segments).toHaveLength(2);
      const snapshotSize = jsonSize(events.slice(0, 2));
      expect(jsonSize(events)).toBeLessThan(2 * Math.max(6_000 / 2, 2 * snapshotSize) + 2 * 1_000);
    } finally {
      window.fetch = nativeFetch;
    }
  });
});

describe('리포트 재생 가능 여부', () => {
  it('실패 후 재시도에 성공해 만든 HAR와 리플레이가 리포트 생성에 그대로 쓰인다', async () => {
    staticPage(5);
    mocks.save.mockRejectedValueOnce(new Error('download blocked')).mockResolvedValue(undefined);
    recorder = new QARecorder({ maxReplaySize: 20_000 });
    await recorder.init();
    await save(recorder);
    await save(recorder);
    const [events, har] = mocks.save.mock.calls[1]! as [RrwebEvent[], HARDocument];
    expect(playable(events)).toBe(true);
    expect(har.log.version).toBe('1.2');
  });
});
