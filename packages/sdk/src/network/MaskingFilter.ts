import type { HAREntry } from '@qa-recorder/shared';

const MASKED = '[MASKED]';

export class MaskingFilter {
  static apply(entry: HAREntry, maskHeaders: string[]): HAREntry {
    const maskSet = new Set(maskHeaders.map((h) => h.toLowerCase()));

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
