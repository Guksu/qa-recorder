import { describe, it, expect, afterEach } from 'vitest';
import { ScreenRecorder } from '../ScreenRecorder.js';

/* rrweb을 mock하지 않고 실제 record()로 입력값 마스킹 결과를 검증 */

/** MutationObserver 콜백과 rrweb 내부 처리가 끝날 때까지 대기 */
const flush = () => new Promise((r) => setTimeout(r, 0));

function setValue(id: string, value: string): HTMLInputElement | HTMLTextAreaElement {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  el.value = value;
  return el;
}

describe('ScreenRecorder 입력값 마스킹 (실제 rrweb)', () => {
  let recorder: ScreenRecorder | null = null;

  afterEach(() => {
    recorder?.stop();
    recorder = null;
    document.body.innerHTML = '';
  });

  it('maskAllInputs: true는 type 속성이 없는 input과 hidden input 값도 전체 스냅샷에서 마스킹한다', async () => {
    document.body.innerHTML = `
      <input id="typeless">
      <input id="text" type="text">
      <input id="hidden" type="hidden" value="HIDDEN-CSRF-SECRET">
      <textarea id="memo"></textarea>
      <select id="plan"><option value="free">FREE-PLAN</option><option value="pro">PRO-PLAN</option></select>
      <input id="agree" type="checkbox" value="yes">`;
    setValue('typeless', 'TYPELESS-SECRET');
    setValue('text', 'TYPED-SECRET');
    setValue('memo', 'TEXTAREA-SECRET');

    recorder = new ScreenRecorder('normal', { maskAllInputs: true });
    recorder.start();
    // 스냅샷 이후 입력 이벤트도 마스킹되어야 한다
    setValue('typeless', 'TYPELESS-LATER').dispatchEvent(new Event('input', { bubbles: true }));
    await flush();

    const json = JSON.stringify(recorder.getEvents());
    expect(json).toContain('"id":"typeless"'); // 스냅샷이 실제로 만들어졌는지 확인
    for (const secret of [
      'TYPELESS-SECRET', 'TYPED-SECRET', 'HIDDEN-CSRF-SECRET', 'TEXTAREA-SECRET', 'TYPELESS-LATER',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('maskAllInputs: true는 textarea의 텍스트 콘텐츠(마크업 초기값·React식 defaultValue 갱신)도 마스킹한다', async () => {
    // rrweb은 textarea의 value에만 maskInputOptions를 적용하고 텍스트 자식 노드는 그대로 직렬화한다.
    // 서버 렌더링된 초기값과, React 제어 textarea가 입력마다 node.defaultValue로 교체하는 텍스트 자식이
    // 이 경로로 기록된다.
    document.body.innerHTML = `
      <textarea id="prefilled">PREFILLED-TEXTAREA-SECRET</textarea>
      <textarea id="edited">ORIGINAL-TEXT</textarea>
      <textarea id="controlled"></textarea>`;

    recorder = new ScreenRecorder('normal', { maskAllInputs: true });
    recorder.start();

    // React 18 제어 textarea의 입력 처리 재현: value 변경 → input 이벤트 → defaultValue 동기화(텍스트 자식 교체)
    const controlled = setValue('controlled', 'REACT-TYPED-SECRET') as HTMLTextAreaElement;
    controlled.dispatchEvent(new Event('input', { bubbles: true }));
    controlled.defaultValue = 'REACT-TYPED-SECRET';

    // 녹화 시작 후 초기 텍스트를 가진 textarea가 마운트되는 경우 (mutation adds 경로)
    const mounted = document.createElement('textarea');
    mounted.textContent = 'MOUNTED-TEXTAREA-SECRET';
    document.body.appendChild(mounted);

    // textarea의 텍스트 노드를 직접 수정하는 경우 (characterData 경로)
    (document.getElementById('edited')!.firstChild as Text).data = 'EDITED-TEXTAREA-SECRET';
    await flush();

    const json = JSON.stringify(recorder.getEvents());
    expect(json).toContain('"id":"prefilled"'); // 스냅샷이 실제로 만들어졌는지 확인
    for (const secret of [
      'PREFILLED-TEXTAREA-SECRET', 'ORIGINAL-TEXT', 'REACT-TYPED-SECRET', 'MOUNTED-TEXTAREA-SECRET',
      'EDITED-TEXTAREA-SECRET',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('maskAllInputs: true와 maskTextSelector를 함께 지정하면 두 마스킹이 모두 적용된다', async () => {
    document.body.innerHTML = `
      <p class="pii">SELECTOR-TEXT-SECRET</p>
      <p>VISIBLE-PARAGRAPH</p>
      <textarea>TEXTAREA-SECRET</textarea>`;

    recorder = new ScreenRecorder('normal', { maskAllInputs: true, maskTextSelector: '.pii' });
    recorder.start();
    await flush();

    const json = JSON.stringify(recorder.getEvents());
    expect(json).not.toContain('SELECTOR-TEXT-SECRET');
    expect(json).not.toContain('TEXTAREA-SECRET');
    expect(json).toContain('VISIBLE-PARAGRAPH');
  });

  it('maskAllInputs 기본값(false)은 rrweb 기본 동작대로 비밀번호 입력만 마스킹한다', async () => {
    document.body.innerHTML = `
      <input id="pw" type="password"><input id="name" type="text"><input id="typeless">
      <textarea id="memo">VISIBLE-TEXTAREA</textarea>`;
    setValue('pw', 'PASSWORD-SECRET');
    setValue('name', 'VISIBLE-NAME');
    setValue('typeless', 'VISIBLE-TYPELESS');

    recorder = new ScreenRecorder('normal');
    recorder.start();
    await flush();

    const json = JSON.stringify(recorder.getEvents());
    expect(json).not.toContain('PASSWORD-SECRET');
    expect(json).toContain('VISIBLE-NAME');
    expect(json).toContain('VISIBLE-TYPELESS');
    expect(json).toContain('VISIBLE-TEXTAREA');
  });
});
