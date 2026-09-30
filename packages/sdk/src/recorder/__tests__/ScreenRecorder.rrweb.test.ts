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

  it('maskAllInputs 기본값(false)은 rrweb 기본 동작대로 비밀번호 입력만 마스킹한다', async () => {
    document.body.innerHTML = '<input id="pw" type="password"><input id="name" type="text"><input id="typeless">';
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
  });
});
