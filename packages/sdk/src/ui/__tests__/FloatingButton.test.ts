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
    expect(button.title).toBe('녹화 중지 및 저장');
  });

  it('setState("idle")은 버튼 title을 녹화 시작으로 변경한다', () => {
    const btn = new FloatingButton(vi.fn());
    btn.mount();
    btn.setState('recording');
    btn.setState('idle');
    const host = document.getElementById('qa-recorder-root')!;
    const button = host.shadowRoot!.querySelector('button')!;
    expect(button.title).toBe('QA 녹화 시작');
  });
});
