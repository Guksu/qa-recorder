import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { record } from 'rrweb';
import { FloatingButton } from '../FloatingButton.js';
import { ConfirmModal, type ConfirmResult } from '../ConfirmModal.js';
import { ProgressBar } from '../ProgressBar.js';
import { SharePanel } from '../SharePanel.js';

/* rrweb을 mock하지 않고 실제 record()로 SDK UI가 녹화 이벤트에 남지 않는지 검증.
 * 차단된 요소는 class 속성과 크기만 가진 빈 placeholder로 남으므로 클래스 이름은 검사하지 않는다. */

const SDK_UI_TEXTS = [
  'QA Recorder', 'REC', 'Stop and save recording',
  'Save this QA session?', 'Bug memo', 'Describe what happened', 'secret bug memo',
  'Saving...', 'https://example.com/share/abc', 'Copy link',
];

/** MutationObserver 콜백과 rrweb 내부 처리가 끝날 때까지 대기 */
const flush = () => new Promise((r) => setTimeout(r, 0));

function startRecording(): { events: unknown[]; stop: () => void } {
  const events: unknown[] = [];
  const stop = record({ emit: (event) => { events.push(event); } });
  return { events, stop: stop ?? (() => {}) };
}

/** 모든 SDK UI를 띄우고, 메모 textarea에 입력한 뒤 버튼 상태를 바꾼다 */
async function showAllSdkUi(): Promise<{ button: FloatingButton; modal: Promise<ConfirmResult> }> {
  const button = new FloatingButton(() => {});
  button.mount();
  const modal = ConfirmModal.show('Save this QA session?');
  ProgressBar.show('Saving...');
  SharePanel.show('https://example.com/share/abc');
  await flush();
  return { button, modal };
}

async function interactWithSdkUi(button: FloatingButton): Promise<void> {
  button.setState('recording');
  const modalHost = document.querySelector('[data-qa="confirm-modal"]')!;
  const textarea = modalHost.shadowRoot!.querySelector('textarea')!;
  textarea.value = 'secret bug memo';
  textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await flush();
}

describe('SDK UI 리플레이 녹화 제외 (실제 rrweb)', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    document.body.innerHTML = '<main>host app content</main>';
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });
  });

  afterEach(() => {
    stop();
    ProgressBar.hide();
    SharePanel.hide();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('대조군: rr-block이 없는 shadow DOM 콘텐츠와 입력값은 기록된다', async () => {
    const recording = startRecording();
    stop = recording.stop;

    // SDK UI와 같은 구조: shadow root에 최상위 요소 하나를 append한 뒤 host를 body에 추가
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const panel = document.createElement('div');
    panel.innerHTML = '<p>plain shadow text</p><textarea></textarea>';
    shadow.append(panel);
    document.body.appendChild(host);
    await flush();
    const textarea = shadow.querySelector('textarea')!;
    textarea.value = 'plain typed value';
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await flush();

    const json = JSON.stringify(recording.events);
    expect(json).toContain('plain shadow text');
    expect(json).toContain('plain typed value');
  });

  it('녹화 시작 후 띄운 SDK UI의 내용과 메모 입력값이 기록되지 않는다', async () => {
    const recording = startRecording();
    stop = recording.stop;

    const { button, modal } = await showAllSdkUi();
    await interactWithSdkUi(button);

    const json = JSON.stringify(recording.events);
    expect(json).toContain('host app content');
    for (const text of SDK_UI_TEXTS) expect(json).not.toContain(text);

    document.querySelector('[data-qa="confirm-modal"]')!
      .shadowRoot!.querySelector<HTMLButtonElement>('#cancel')!.click();
    await modal;
  });

  it('녹화 시작 전부터 떠 있던 SDK UI도 전체 스냅샷과 이후 이벤트에 기록되지 않는다', async () => {
    const { button, modal } = await showAllSdkUi();

    const recording = startRecording();
    stop = recording.stop;
    await interactWithSdkUi(button);

    const json = JSON.stringify(recording.events);
    expect(json).toContain('host app content');
    for (const text of SDK_UI_TEXTS) expect(json).not.toContain(text);

    document.querySelector('[data-qa="confirm-modal"]')!
      .shadowRoot!.querySelector<HTMLButtonElement>('#cancel')!.click();
    await modal;
  });
});
