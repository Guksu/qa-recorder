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

  it('show()를 중복 호출해도 하나만 노출된다', () => {
    ProgressBar.show();
    ProgressBar.show();
    const hosts = document.querySelectorAll('[data-qa="progress-bar"]');
    expect(hosts).toHaveLength(1);
  });

  it('update(50)은 fill width를 50%로 설정한다', () => {
    ProgressBar.show();
    ProgressBar.update(50);
    const host = document.querySelector('[data-qa="progress-bar"]') as HTMLElement;
    const fill = host.shadowRoot!.querySelector<HTMLElement>('#fill');
    expect(fill?.style.width).toBe('50%');
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
