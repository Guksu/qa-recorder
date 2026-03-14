import type { HARLog } from '@qa-recorder/shared';

export class RemoteDelivery {
  constructor(private readonly endpoint: string) {}

  async send(videoBlob: Blob, harLog: HARLog): Promise<string | undefined> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const form = new FormData();
    form.append('video', videoBlob, `qa-recording-${timestamp}.webm`);
    form.append(
      'har',
      new Blob([JSON.stringify(harLog)], { type: 'application/json' }),
      `qa-network-${timestamp}.har`,
    );

    const response = await fetch(this.endpoint, { method: 'POST', body: form });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    try {
      const json = await response.json();
      return json.url as string | undefined;
    } catch {
      return undefined;
    }
  }
}
