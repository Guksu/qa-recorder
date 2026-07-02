import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SharePanel } from '../SharePanel.js';

describe('SharePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    SharePanel.hide();
    vi.unstubAllGlobals();
  });

  it('show(url)는 패널을 DOM에 추가한다', () => {
    SharePanel.show('https://example.com/share/abc');
    const host = document.querySelector('[data-qa="share-panel"]');
    expect(host).not.toBeNull();
  });

  it('show(url)는 URL 텍스트를 표시한다', () => {
    SharePanel.show('https://example.com/share/abc');
    const host = document.querySelector('[data-qa="share-panel"]') as HTMLElement;
    const urlEl = host.shadowRoot!.querySelector('.qa-share-url');
    expect(urlEl?.textContent).toContain('https://example.com/share/abc');
  });

  it('show()를 중복 호출해도 하나만 노출된다', () => {
    SharePanel.show('https://a.com');
    SharePanel.show('https://b.com');
    const hosts = document.querySelectorAll('[data-qa="share-panel"]');
    expect(hosts).toHaveLength(1);
  });

  it('show()를 다시 호출하면 최신 URL이 표시된다', () => {
    SharePanel.show('https://a.com/old');
    SharePanel.show('https://b.com/new');
    const host = document.querySelector('[data-qa="share-panel"]') as HTMLElement;
    const urlEl = host.shadowRoot!.querySelector('.qa-share-url');
    expect(urlEl?.textContent).toBe('https://b.com/new');
  });

  it('URL의 HTML 마크업이 해석되지 않고 텍스트로 표시된다', () => {
    SharePanel.show('https://a.com/<img src=x onerror=alert(1)>');
    const host = document.querySelector('[data-qa="share-panel"]') as HTMLElement;
    expect(host.shadowRoot!.querySelector('img')).toBeNull();
    expect(host.shadowRoot!.querySelector('.qa-share-url')?.textContent)
      .toBe('https://a.com/<img src=x onerror=alert(1)>');
  });

  it('복사 버튼 클릭 시 clipboard.writeText가 호출된다', async () => {
    SharePanel.show('https://example.com/share/abc');
    const host = document.querySelector('[data-qa="share-panel"]') as HTMLElement;
    const copyBtn = host.shadowRoot!.querySelector<HTMLElement>('.qa-copy-btn');
    copyBtn?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/share/abc');
  });

  it('hide()는 패널을 DOM에서 제거한다', () => {
    SharePanel.show('https://example.com');
    SharePanel.hide();
    const host = document.querySelector('[data-qa="share-panel"]');
    expect(host).toBeNull();
  });

  it('hide()를 show() 전에 호출해도 에러가 발생하지 않는다', () => {
    expect(() => SharePanel.hide()).not.toThrow();
  });
});
