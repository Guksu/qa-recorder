import type { HARLog } from '@qa-recorder/shared';

export class LocalStorage {
  static async save(videoBlob: Blob, harLog: HARLog): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    LocalStorage.downloadBlob(videoBlob, `qa-recording-${timestamp}.webm`);
    const harJson = JSON.stringify(harLog, null, 2);
    const harBlob = new Blob([harJson], { type: 'application/json' });
    LocalStorage.downloadBlob(harBlob, `qa-network-${timestamp}.har`);
  }

  private static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
