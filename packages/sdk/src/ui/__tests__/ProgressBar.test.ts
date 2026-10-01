import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProgressBar } from '../ProgressBar.js';

describe('ProgressBar', () => {
  afterEach(() => {
    ProgressBar.hide();
  });

  it('show()는 progress bar를 DOM에 추가한다', () => {
    ProgressBar.show();
    const host = document.querySelector('[data-qa="progress-bar"]');
    expect(host).not.toBeNull();
  });

  it('host와 shadow 최상위 요소에 rr-block 클래스를 붙여 리플레이 녹화에서 제외한다', () => {
    ProgressBar.show();
    const host = document.querySelector('[data-qa="progress-bar"]') as HTMLElement;
    expect(host.classList.contains('rr-block')).toBe(true);
    for (const child of Array.from(host.shadowRoot!.children)) {
      expect(child.classList.contains('rr-block')).toBe(true);
    }
  });

  it('show()를 중복 호출해도 하나만 노출된다', () => {
    ProgressBar.show();
    ProgressBar.show();
    const hosts = document.querySelectorAll('[data-qa="progress-bar"]');
    expect(hosts).toHaveLength(1);
  });

  it('진행률을 알 수 없으므로 막대 폭을 0%로 고정하지 않고, 움직이는 막대 스타일을 쓴다', () => {
    ProgressBar.show();
    const host = document.querySelector('[data-qa="progress-bar"]') as HTMLElement;
    const fill = host.shadowRoot!.querySelector<HTMLElement>('#fill')!;
    expect(fill.style.width).toBe('');
    expect(host.shadowRoot!.querySelector('style')!.textContent).toContain('qa-progress-slide');
  });

  it('label은 HTML로 해석하지 않는다', () => {
    ProgressBar.show('<img src=x onerror=alert(1)>');
    const host = document.querySelector('[data-qa="progress-bar"]') as HTMLElement;
    expect(host.shadowRoot!.querySelector('img')).toBeNull();
    expect(host.shadowRoot!.querySelector('#label')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('show(label)은 label 텍스트를 표시한다', () => {
    ProgressBar.show('업로드 중...');
    const host = document.querySelector('[data-qa="progress-bar"]') as HTMLElement;
    const label = host.shadowRoot!.querySelector('#label');
    expect(label?.textContent).toBe('업로드 중...');
  });

  it('hide()는 progress bar를 DOM에서 제거한다', () => {
    ProgressBar.show();
    ProgressBar.hide();
    const host = document.querySelector('[data-qa="progress-bar"]');
    expect(host).toBeNull();
  });

  it('hide()를 show() 전에 호출해도 에러가 발생하지 않는다', () => {
    expect(() => ProgressBar.hide()).not.toThrow();
  });
});
