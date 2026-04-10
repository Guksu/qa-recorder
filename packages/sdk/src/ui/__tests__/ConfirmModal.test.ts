import { describe, it, expect, beforeEach } from 'vitest';
import { ConfirmModal } from '../ConfirmModal.js';

describe('ConfirmModal.show', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('textarea가 포함된 모달을 표시한다', async () => {
    const promise = ConfirmModal.show('Save?');
    const host = document.body.lastElementChild as HTMLElement;
    expect(host.shadowRoot!.querySelector('textarea')).not.toBeNull();
    host.shadowRoot!.querySelector<HTMLButtonElement>('#cancel')!.click();
    await promise;
  });

  it('확인 클릭 시 { confirmed: true, memo }를 반환한다', async () => {
    const promise = ConfirmModal.show('Save?');
    const host = document.body.lastElementChild as HTMLElement;
    const textarea = host.shadowRoot!.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = '로그인 버튼 클릭 시 500 에러';
    host.shadowRoot!.querySelector<HTMLButtonElement>('#confirm')!.click();
    const result = await promise;
    expect(result.confirmed).toBe(true);
    expect(result.memo).toBe('로그인 버튼 클릭 시 500 에러');
  });

  it('취소 클릭 시 { confirmed: false, memo: "" }를 반환한다', async () => {
    const promise = ConfirmModal.show('Save?');
    const host = document.body.lastElementChild as HTMLElement;
    host.shadowRoot!.querySelector<HTMLButtonElement>('#cancel')!.click();
    const result = await promise;
    expect(result.confirmed).toBe(false);
    expect(result.memo).toBe('');
  });

  it('memo가 비어 있어도 확인할 수 있다', async () => {
    const promise = ConfirmModal.show('Save?');
    const host = document.body.lastElementChild as HTMLElement;
    host.shadowRoot!.querySelector<HTMLButtonElement>('#confirm')!.click();
    const result = await promise;
    expect(result.confirmed).toBe(true);
    expect(result.memo).toBe('');
  });

  it('확인 후 모달이 DOM에서 제거된다', async () => {
    const promise = ConfirmModal.show('Save?');
    const host = document.body.lastElementChild as HTMLElement;
    host.shadowRoot!.querySelector<HTMLButtonElement>('#confirm')!.click();
    await promise;
    expect(document.body.contains(host)).toBe(false);
  });
});
