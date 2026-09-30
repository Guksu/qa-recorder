import { describe, it, expect, afterEach } from 'vitest';
import { ScreenRecorder } from '../ScreenRecorder.js';
import { resolveConfig } from '../../core/config.js';
import { HARBuilder } from '../../network/HARBuilder.js';
import { UnifiedViewer } from '../../viewer/UnifiedViewer.js';

/* rrweb을 mock하지 않고 실제 record()로 입력값·페이지 URL 마스킹 결과를 검증 */

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

describe('ScreenRecorder 페이지 URL 마스킹 (실제 rrweb)', () => {
  const originalHref = window.location.href;
  /** QARecorder가 ScreenRecorder에 넘기는 기본 maskKeys */
  const maskKeys = resolveConfig().maskKeys;
  let recorder: ScreenRecorder | null = null;

  afterEach(() => {
    recorder?.stop();
    recorder = null;
    document.body.innerHTML = '';
    history.replaceState(null, '', originalHref);
  });

  it('Meta 이벤트 href의 ?token=과 #access_token= 값이 이벤트 JSON과 HTML 리포트에 남지 않는다', () => {
    // 링크 없는 본문 — 상대 링크(href="#")는 rrweb이 페이지 URL 기준 절대 URL로 기록하며 maskKeys 대상이 아니다
    document.body.innerHTML = '<h1>Reset password</h1><input id="pw" type="password">';
    history.replaceState(
      null, '', '/reset-password?token=RESET-TOKEN-SECRET&lang=ko#access_token=IMPLICIT-TOKEN-SECRET&token_type=bearer',
    );

    recorder = new ScreenRecorder('normal', { maskKeys });
    recorder.start();

    const events = recorder.getEvents();
    const meta = events.find((e) => (e as { type: number }).type === 4) as { data: { href: string } };
    expect(meta.data.href).toBe(
      `${location.origin}/reset-password?token=[MASKED]&lang=ko#access_token=[MASKED]&token_type=bearer`,
    );

    const html = UnifiedViewer.generate(events, HARBuilder.build([]), []);
    expect(html).toContain('access_token=[MASKED]'); // 이벤트가 리포트에 실제로 임베드됐는지 확인
    for (const output of [JSON.stringify(events), html]) {
      expect(output).not.toContain('RESET-TOKEN-SECRET');
      expect(output).not.toContain('IMPLICIT-TOKEN-SECRET');
    }
  });

  it('clearBuffer()가 새로 찍는 스냅샷의 Meta href(해시 라우트 쿼리)도 가린다', () => {
    recorder = new ScreenRecorder('normal', { maskKeys });
    recorder.start();
    history.replaceState(null, '', '/app#/magic-link?token=MAGIC-LINK-SECRET');
    recorder.clearBuffer();

    const json = JSON.stringify(recorder.getEvents());
    expect(json).toContain(`"href":"${location.origin}/app#/magic-link?token=[MASKED]"`);
    expect(json).not.toContain('MAGIC-LINK-SECRET');
  });

  it.each([
    ['/app#/users/VXNlcjoxMg==/verify?token=B64-ROUTE-SECRET', '/app#/users/VXNlcjoxMg==/verify?token=[MASKED]'],
    ['/app#/reset;mode=email?token=MATRIX-ROUTE-SECRET', '/app#/reset;mode=email?token=[MASKED]'],
  ])('라우트 경로에 "="가 있는 해시 라우트의 쿼리도 Meta href에서 가린다: %s', (path, maskedPath) => {
    history.replaceState(null, '', path);
    recorder = new ScreenRecorder('normal', { maskKeys });
    recorder.start();

    const json = JSON.stringify(recorder.getEvents());
    expect(json).toContain(`"href":"${location.origin}${maskedPath}"`);
    expect(json).not.toContain('ROUTE-SECRET');
  });

  it('maskKeys: []이면 rrweb이 기록한 페이지 URL을 그대로 둔다', () => {
    history.replaceState(null, '', '/reset-password?token=RESET-TOKEN-SECRET');
    recorder = new ScreenRecorder('normal', { maskKeys: [] });
    recorder.start();

    expect(JSON.stringify(recorder.getEvents()))
      .toContain(`"href":"${location.origin}/reset-password?token=RESET-TOKEN-SECRET"`);
  });
});
