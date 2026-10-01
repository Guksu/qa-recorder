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

  describe('드래그 (pointer 이벤트: 마우스·터치·펜)', () => {
    function mountButton(onClick = vi.fn()) {
      const floatingBtn = new FloatingButton(onClick);
      floatingBtn.mount();
      const button = document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('button')!;
      return { floatingBtn, button, onClick };
    }
    const down = (target: EventTarget, x: number, y: number, init: PointerEventInit = {}) =>
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, ...init }));
    const move = (x: number, y: number, init: PointerEventInit = {}) =>
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 1, ...init }));
    const up = (type: 'pointerup' | 'pointercancel' = 'pointerup', init: PointerEventInit = {}) =>
      document.dispatchEvent(new PointerEvent(type, { pointerId: 1, ...init }));

    it('8px 미만의 이동은 드래그로 인식되지 않아 클릭 콜백이 호출된다', () => {
      const { button, onClick, floatingBtn } = mountButton();
      down(button, 100, 100);
      move(105, 103); // 5px — 8px 미만
      up();
      button.click();
      expect(onClick).toHaveBeenCalledOnce();
      floatingBtn.unmount();
    });

    it('8px 이상의 이동은 드래그로 인식되어 클릭 콜백이 호출되지 않는다', () => {
      const { button, onClick, floatingBtn } = mountButton();
      down(button, 100, 100);
      move(110, 100); // 10px — 8px 이상
      up();
      button.click();
      expect(onClick).not.toHaveBeenCalled();
      floatingBtn.unmount();
    });

    it('터치로도 버튼을 끌어 옮길 수 있다', () => {
      const { button, floatingBtn } = mountButton();
      down(button, 100, 100, { pointerType: 'touch' });
      move(130, 140, { pointerType: 'touch' });
      expect(button.style.left).not.toBe('');
      expect(button.style.top).not.toBe('');
      expect(button.style.bottom).toBe('auto');
      up('pointerup', { pointerType: 'touch' });
      floatingBtn.unmount();
    });

    it('드래그를 버튼 밖에서 끝내 click이 오지 않아도, 다음 진짜 클릭은 무시되지 않는다', () => {
      const { button, onClick, floatingBtn } = mountButton();
      down(button, 100, 100);
      move(200, 200);
      up(); // 버튼 밖에서 놓아 click 이벤트가 오지 않은 상황
      down(button, 50, 50);
      up();
      button.click();
      expect(onClick).toHaveBeenCalledOnce();
      floatingBtn.unmount();
    });

    it('pointercancel이 오면 드래그를 끝내고 더 이상 따라 움직이지 않는다', () => {
      const { button, floatingBtn } = mountButton();
      down(button, 100, 100);
      move(120, 120);
      up('pointercancel');
      const left = button.style.left;
      move(300, 300);
      expect(button.style.left).toBe(left);
      floatingBtn.unmount();
    });

    it('다른 포인터(두 번째 손가락)의 움직임은 무시한다', () => {
      const { button, floatingBtn } = mountButton();
      down(button, 100, 100);
      const before = button.style.left;
      move(300, 300, { pointerId: 2 });
      expect(button.style.left).toBe(before);
      up();
      floatingBtn.unmount();
    });

    it('마우스 오른쪽 버튼으로는 드래그를 시작하지 않는다', () => {
      const { button, floatingBtn } = mountButton();
      down(button, 100, 100, { button: 2 });
      move(200, 200);
      expect(button.style.left).toBe('');
      up();
      floatingBtn.unmount();
    });

    it('터치 드래그 중 화면이 스크롤되지 않도록 touch-action: none을 쓴다', () => {
      const { floatingBtn } = mountButton();
      const style = document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('style')!;
      expect(style.textContent).toContain('touch-action: none');
      floatingBtn.unmount();
    });
  });
});
