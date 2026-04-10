import type { HAREntry } from '@qa-recorder/shared';

const MASKED = '[MASKED]';

export class MaskingFilter {
  /** maskSet は呼び出し元で一度だけ生成し再利用すること (lowercase 済みの Set<string>) */
  static apply(entry: HAREntry, maskSet: Set<string>): HAREntry {
    const maskHeaderList = (headers: { name: string; value: string }[]) =>
      headers.map((h) => ({
        name: h.name,
        value: maskSet.has(h.name.toLowerCase()) ? MASKED : h.value,
      }));

    return {
      ...entry,
      request: {
        ...entry.request,
        headers: maskHeaderList(entry.request.headers),
      },
      response: {
        ...entry.response,
        headers: maskHeaderList(entry.response.headers),
      },
    };
  }
}
