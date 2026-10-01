import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingButton } from '../FloatingButton.js';

describe('FloatingButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mount()를 두 번 호출해도 버튼은 하나만 만든다', () => {
    const btn = new FloatingButton(vi.fn());
    btn.mount();
    btn.mount();
    expect(document.querySelectorAll('#qa-recorder-root')).toHaveLength(1);
    btn.unmount();
  });

  describe('body가 없을 때 (<head>의 script)', () => {
    let body: HTMLElement;
    beforeEach(() => {
      body = document.body;
      document.documentElement.removeChild(body);
    });
    afterEach(() => {
      if (!document.body) document.documentElement.appendChild(body);
    });

    it('throw하지 않고, DOMContentLoaded 때 마운트 전에 정한 상태로 버튼을 붙인다', () => {
      const btn = new FloatingButton(vi.fn());
      expect(() => btn.mount()).not.toThrow();
      btn.setState('recording');
      document.documentElement.appendChild(body);
      expect(document.getElementById('qa-recorder-root')).toBeNull();

      document.dispatchEvent(new Event('DOMContentLoaded'));
      const host = document.getElementById('qa-recorder-root')!;
      expect(host).not.toBeNull();
      expect(host.shadowRoot!.querySelector('button')!.title).toBe('Stop and save recording');
      btn.unmount();
    });

    it('DOMContentLoaded 전에 unmount()하면 나중에도 버튼을 붙이지 않는다', () => {
      const btn = new FloatingButton(vi.fn());
      btn.mount();
      btn.unmount();
      document.documentElement.appendChild(body);
      document.dispatchEvent(new Event('DOMContentLoaded'));
      expect(document.getElementById('qa-recorder-root')).toBeNull();
    });

    it('마운트를 기다리는 중에 mount()를 다시 불러도 버튼은 하나만 붙인다', () => {
      const btn = new FloatingButton(vi.fn());
      btn.mount();
      btn.mount();
      document.documentElement.appendChild(body);
      document.dispatchEvent(new Event('DOMContentLoaded'));
      expect(document.querySelectorAll('#qa-recorder-root')).toHaveLength(1);
      btn.unmount();
    });
  });

  it('mount()는 Shadow DOM 버튼을 body에 추가한다', () => {
    const btn = new FloatingButton(vi.fn());
    btn.mount();
    expect(document.getElementById('qa-recorder-root')).not.toBeNull();
  });

  it('host와 shadow 최상위 요소에 rr-block 클래스를 붙여 리플레이 녹화에서 제외한다', () => {
    const btn = new FloatingButton(vi.fn());
    btn.mount();
    btn.setState('recording');
    const host = document.getElementById('qa-recorder-root')!;
    expect(host.classList.contains('rr-block')).toBe(true);
    for (const child of Array.from(host.shadowRoot!.children)) {
      expect(child.classList.contains('rr-block')).toBe(true);
    }
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

  it('8px 미만의 마우스 이동은 드래그로 인식되지 않아 클릭 콜백이 호출된다', () => {
    const onClick = vi.fn();
    const floatingBtn = new FloatingButton(onClick);
    floatingBtn.mount();
    const host = document.getElementById('qa-recorder-root')!;
    const button = host.shadowRoot!.querySelector('button')!;

    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 105, clientY: 103 })); // 5px — 8px 미만
    document.dispatchEvent(new MouseEvent('mouseup', {}));
    button.click();

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('8px 이상의 마우스 이동은 드래그로 인식되어 클릭 콜백이 호출되지 않는다', () => {
    const onClick = vi.fn();
    const floatingBtn = new FloatingButton(onClick);
    floatingBtn.mount();
    const host = document.getElementById('qa-recorder-root')!;
    const button = host.shadowRoot!.querySelector('button')!;

    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, button: 0 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 100 })); // 10px — 8px 이상
    document.dispatchEvent(new MouseEvent('mouseup', {}));
    button.click();

    expect(onClick).not.toHaveBeenCalled();
  });
});
