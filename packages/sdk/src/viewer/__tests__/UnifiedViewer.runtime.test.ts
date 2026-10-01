import { describe, it, expect, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { UnifiedViewer } from '../UnifiedViewer.js';
import type { HARLog, HAREntry } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../../console/ConsoleCapture.js';

/** 리포트의 rrweb CDN 스크립트 대신 넣는 가짜 재생기. 테스트가 재생 위치(time)를 직접 바꾼다 */
const FAKE_RRWEB = `<script>
  window.__replayers = [];
  window.rrweb = {
    Replayer: class {
      constructor() { this.handlers = {}; this.time = 0; window.__replayers.push(this); }
      on(name, fn) { this.handlers[name] = fn; }
      play(t) { this.time = t || 0; }
      pause(t) { if (t !== undefined) this.time = t; }
      setConfig() {}
      getCurrentTime() { return this.time; }
    },
  };
</script>`;

interface FakeReplayer {
  time: number;
  handlers: Record<string, () => void>;
}

type ReportWindow = JSDOM['window'] & { __replayers: FakeReplayer[] };

/** 첫 이벤트부터 마지막 이벤트까지 60초짜리 세션 */
const EVENTS = [{ type: 2, data: {}, timestamp: 1000 }, { type: 3, data: {}, timestamp: 61000 }];

function entry(overrides: { status?: number; startedDateTime?: string; url?: string } = {}): HAREntry {
  return {
    startedDateTime: overrides.startedDateTime ?? '1970-01-01T00:00:11.000Z',
    time: 100,
    request: {
      method: 'GET', url: overrides.url ?? 'https://api.example.com/users',
      httpVersion: 'HTTP/1.1', headers: [], queryString: [], bodySize: -1, headersSize: -1,
    },
    response: {
      status: overrides.status ?? 200, statusText: '', httpVersion: 'HTTP/1.1', headers: [],
      content: { size: 0, mimeType: 'application/json', text: '' }, bodySize: 0, headersSize: -1,
    },
    timings: { send: 0, wait: 100, receive: 0 },
  };
}

function harLog(entries: HAREntry[]): HARLog {
  return { version: '1.2', creator: { name: 'qa-recorder', version: 'test' }, entries };
}

function consoleEntry(level: ConsoleEntry['level'], at: string, extra: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return { timestamp: at, level, message: `${level} message`, _offsetMs: 0, ...extra };
}

const open: JSDOM[] = [];

/** 생성한 리포트를 jsdom에서 실행한다. withPlayer=false면 rrweb을 불러오지 못한 상황 */
function render(entries: HAREntry[], logs: ConsoleEntry[] = [], withPlayer = true) {
  const html = UnifiedViewer.generate(EVENTS, harLog(entries), logs)
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, withPlayer ? FAKE_RRWEB : '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  open.push(dom);
  const win = dom.window as ReportWindow;
  return { win, doc: win.document, replayer: () => win.__replayers[0] };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const currentTime = (doc: Document) => doc.getElementById('t-current')!.textContent;

afterEach(() => {
  while (open.length) open.pop()!.window.close();
});

describe('UnifiedViewer 실행 (jsdom)', () => {
  it('rrweb 스크립트에 SRI integrity와 crossorigin을 붙인다', () => {
    const html = UnifiedViewer.generate(EVENTS, harLog([]), []);
    expect(html).toMatch(
      /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/rrweb@1\.1\.3\/dist\/rrweb\.min\.js" integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous"><\/script>/,
    );
  });

  describe('재생 시간', () => {
    it('재생 중 시간 표시는 벽시계가 아니라 재생기의 현재 위치를 따른다 (skipInactive로 건너뛴 구간 포함)', async () => {
      const { doc, replayer } = render([]);
      doc.getElementById('btn-play')!.click();
      // 재생기가 빈 구간을 건너뛰어 45초 지점에 있다고 가정
      replayer().time = 45000;
      await wait(250);
      expect(currentTime(doc)).toBe('0:45');
    });

    it('재생이 끝나면(finish) 끝 시간으로 맞추고 재생 버튼으로 돌아간다', async () => {
      const { doc, replayer } = render([]);
      doc.getElementById('btn-play')!.click();
      replayer().handlers.finish();
      expect(currentTime(doc)).toBe('1:00');
      expect(doc.getElementById('icon-play')!.style.display).toBe('');
      expect(doc.getElementById('icon-pause')!.style.display).toBe('none');
    });
  });

  describe('실패한 요청', () => {
    it('status 0은 초록색(2xx)이 아니라 실패로 표시한다', () => {
      const { doc } = render([entry({ status: 0 }), entry({ status: 200 })]);
      const cells = doc.querySelectorAll('#net-tbody .col-status');
      expect(cells[0].textContent).toBe('failed');
      expect(cells[0].classList.contains('s-fail')).toBe(true);
      expect(cells[1].textContent).toBe('200');
      expect(cells[1].classList.contains('s-2xx')).toBe(true);
    });
  });

  describe('콘솔 stack', () => {
    it('stack이 있는 항목은 펼쳐 볼 수 있고, 펼쳐도 재생 위치는 바뀌지 않는다', () => {
      const { doc, replayer } = render([], [
        consoleEntry('error', '1970-01-01T00:00:31.000Z', { stack: 'Error: boom\n    at app.js:1:1' }),
        consoleEntry('warn', '1970-01-01T00:00:41.000Z'),
      ]);
      const rows = doc.querySelectorAll('.con-row');
      expect(rows[1].querySelector('.con-stack-toggle')).toBeNull();

      const toggle = rows[0].querySelector<HTMLElement>('.con-stack-toggle')!;
      expect(rows[0].querySelector('.con-stack')!.textContent).toBe('Error: boom\n    at app.js:1:1');
      toggle.click();
      expect(rows[0].classList.contains('expanded')).toBe(true);
      expect(toggle.textContent).toBe('▼ stack');
      expect(replayer().time).toBe(0);
      toggle.click();
      expect(rows[0].classList.contains('expanded')).toBe(false);
    });

    it('stack은 HTML로 해석하지 않는다', () => {
      const { doc } = render([], [
        consoleEntry('error', '1970-01-01T00:00:31.000Z', { stack: '<img src=x onerror=alert(1)>' }),
      ]);
      const stack = doc.querySelector('.con-stack')!;
      expect(stack.querySelector('img')).toBeNull();
      expect(stack.textContent).toBe('<img src=x onerror=alert(1)>');
    });
  });

  describe('타임라인 마커', () => {
    it('네트워크 요청과 콘솔 에러·경고 위치에 마커를 그리고, 실패한 요청은 에러 색으로 표시한다', () => {
      const { doc } = render(
        [entry({ startedDateTime: '1970-01-01T00:00:16.000Z' }), entry({ status: 0, startedDateTime: '1970-01-01T00:00:31.000Z' })],
        [
          consoleEntry('error', '1970-01-01T00:00:46.000Z'),
          consoleEntry('warn', '1970-01-01T00:00:51.000Z'),
          consoleEntry('log', '1970-01-01T00:00:56.000Z'),
        ],
      );
      const markers = Array.from(doc.querySelectorAll<HTMLElement>('#timeline-track .tl-marker'));
      expect(markers.map((m) => [m.className, m.style.left])).toEqual([
        ['tl-marker tl-marker-net', '25%'],
        ['tl-marker tl-marker-err', '50%'],
        ['tl-marker tl-marker-err', '75%'],
        ['tl-marker tl-marker-warn', '83.33333333333334%'],
      ]);
      expect(markers[1].title).toBe('GET https://api.example.com/users → failed');
    });

    it('마커를 누르면 그 시점으로 이동한다', () => {
      const { doc, win, replayer } = render([], [consoleEntry('error', '1970-01-01T00:00:31.000Z')]);
      const marker = doc.querySelector<HTMLElement>('.tl-marker')!;
      marker.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
      expect(replayer().time).toBe(30000);
      expect(currentTime(doc)).toBe('0:30');
    });

    it('마커 title은 HTML로 해석하지 않는다', () => {
      const { doc } = render([entry({ url: 'https://x.test/"><img src=x onerror=alert(1)>' })]);
      expect(doc.querySelector('#timeline-track img')).toBeNull();
      expect(doc.querySelector('.tl-marker')!.getAttribute('title')).toContain('<img src=x');
    });
  });

  describe('rrweb을 불러오지 못한 경우', () => {
    it('재생 영역에 안내를 띄우고, 네트워크·콘솔 패널과 마커는 그대로 동작한다', () => {
      const { doc } = render([entry()], [consoleEntry('error', '1970-01-01T00:00:31.000Z')], false);
      const player = doc.getElementById('player')!;
      expect(player.className).toBe('player-unavailable');
      expect(player.textContent).toContain('Session replay is unavailable');
      expect(doc.querySelectorAll('#net-tbody tr')).toHaveLength(1);
      expect(doc.querySelectorAll('.con-row')).toHaveLength(1);
      expect(doc.querySelectorAll('.tl-marker')).toHaveLength(2);
    });
  });
});
