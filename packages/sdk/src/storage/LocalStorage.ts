import type { HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import { UnifiedViewer } from '../viewer/UnifiedViewer.js';
import { zipSync, strToU8 } from 'fflate';

export class LocalStorage {
  static async save(sessionEvents: unknown[] | null, harLog: HARLog, consoleLogs: ConsoleEntry[] = [], memo = ''): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const entries: Record<string, Uint8Array> = {};

    if (sessionEvents) {
      entries[`qa-session-${timestamp}.rr.json`] = strToU8(JSON.stringify(sessionEvents));
    }
    entries[`qa-network-${timestamp}.har`] = strToU8(JSON.stringify(harLog, null, 2));
    entries[`qa-report-${timestamp}.html`] = strToU8(
      UnifiedViewer.generate(sessionEvents ?? [], harLog, consoleLogs, memo),
    );

    const zipped = zipSync(entries);
    const zipBlob = new Blob([zipped], { type: 'application/zip' });
    await LocalStorage.downloadBlob(zipBlob, `qa-report-${timestamp}.zip`);
  }

  private static downloadBlob(blob: Blob, filename: string): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      // 브라우저가 다운로드를 시작할 시간을 준 뒤 URL 해제 (Safari/Samsung 브라우저 호환)
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve();
      }, 300);
    });
  }
}
