import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FloatingButton } from '../FloatingButton.js';

describe('FloatingButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mount()는 Shadow DOM 버튼을 body에 추가한다', () => {
    const btn = new FloatingButton(vi.fn());
    btn.mount();
    expect(document.getElementById('qa-recorder-root')).not.toBeNull();
  });

  it('버튼 클릭 시 onClick 콜백이 호출된다', () => {
    const onClick = vi.fn();
    const btn = new FloatingButton(onClick);
    btn.mount();
    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('setState("recording")은 버튼 title을 녹화 중지로 변경한다', () => {
    const btn = new FloatingButton(vi.fn());
    btn.mount();
    btn.setState('recording');
    const host = document.getElementById('qa-recorder-root')!;
    const button = host.shadowRoot!.querySelector('button')!;
    expect(button.title).toBe('Stop and save recording');
  });

  it('setState("idle")은 버튼 title을 녹화 시작으로 변경한다', () => {
    const btn = new FloatingButton(vi.fn());
    btn.mount();
    btn.setState('recording');
    btn.setState('idle');
    const host = document.getElementById('qa-recorder-root')!;
    const button = host.shadowRoot!.querySelector('button')!;
    expect(button.title).toBe('Start QA recording');
  });

  it('zIndex 옵션을 설정하면 Shadow DOM 스타일에 적용된다', () => {
    const btn = new FloatingButton(vi.fn(), 999);
    btn.mount();
    const host = document.getElementById('qa-recorder-root')!;
    const style = host.shadowRoot!.querySelector('style')!;
    expect(style.textContent).toContain('z-index: 999');
  });

  it('zIndex 미설정 시 기본값(2147483647)이 적용된다', () => {
    const btn = new FloatingButton(vi.fn());
    btn.mount();
    const host = document.getElementById('qa-recorder-root')!;
    const style = host.shadowRoot!.querySelector('style')!;
    expect(style.textContent).toContain('z-index: 2147483647');
  });
});
