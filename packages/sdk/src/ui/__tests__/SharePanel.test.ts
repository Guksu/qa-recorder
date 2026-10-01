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

  it('host와 shadow 최상위 요소에 rr-block 클래스를 붙여 리플레이 녹화에서 제외한다', () => {
    SharePanel.show('https://example.com/share/abc');
    const host = document.querySelector('[data-qa="share-panel"]') as HTMLElement;
    expect(host.classList.contains('rr-block')).toBe(true);
    for (const child of Array.from(host.shadowRoot!.children)) {
      expect(child.classList.contains('rr-block')).toBe(true);
    }
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

  describe('복사 결과와 닫기', () => {
    const copyButton = () =>
      (document.querySelector('[data-qa="share-panel"]') as HTMLElement).shadowRoot!.querySelector<HTMLButtonElement>('.qa-copy-btn')!;

    afterEach(() => {
      vi.useRealTimers();
    });

    it('복사에 성공하면 Copied!를 잠시 보여주고 원래 문구로 돌아온다', async () => {
      vi.useFakeTimers();
      SharePanel.show('https://example.com/s/1');
      copyButton().click();
      await vi.waitFor(() => expect(copyButton().textContent).toBe('Copied!'));
      await vi.advanceTimersByTimeAsync(2000);
      expect(copyButton().textContent).toBe('Copy link');
    });

    it('navigator.clipboard가 없으면(https가 아닌 페이지) execCommand로 복사한다', async () => {
      vi.stubGlobal('navigator', {});
      const execCommand = vi.fn().mockReturnValue(true);
      Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
      try {
        SharePanel.show('https://example.com/s/2');
        expect(() => copyButton().click()).not.toThrow();
        await vi.waitFor(() => expect(copyButton().textContent).toBe('Copied!'));
        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(document.querySelector('textarea')).toBeNull(); // 임시 textarea는 정리한다
      } finally {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    });

    it('클립보드 권한이 거부되고 execCommand도 실패하면 실패 안내를 보여준다', async () => {
      vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
      Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });
      try {
        SharePanel.show('https://example.com/s/3');
        copyButton().click();
        await vi.waitFor(() => expect(copyButton().textContent).toBe('Copy failed — select the link above'));
      } finally {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    });

    it('닫기 버튼을 누르면 패널이 사라진다', () => {
      SharePanel.show('https://example.com/s/4');
      const host = document.querySelector('[data-qa="share-panel"]') as HTMLElement;
      host.shadowRoot!.querySelector<HTMLButtonElement>('.qa-share-close')!.click();
      expect(document.querySelector('[data-qa="share-panel"]')).toBeNull();
    });
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
