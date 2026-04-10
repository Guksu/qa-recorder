import type { HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import { UnifiedViewer } from '../viewer/UnifiedViewer.js';

export class LocalStorage {
  static async save(sessionEvents: unknown[] | null, harLog: HARLog, consoleLogs: ConsoleEntry[] = [], memo = ''): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const files: Array<{ blob: Blob; filename: string }> = [];

    if (sessionEvents) {
      files.push({
        blob: new Blob([JSON.stringify(sessionEvents)], { type: 'application/json' }),
        filename: `qa-session-${timestamp}.rr.json`,
      });
    }

    files.push({
      blob: new Blob([JSON.stringify(harLog, null, 2)], { type: 'application/json' }),
      filename: `qa-network-${timestamp}.har`,
    });

    files.push({
      blob: new Blob([UnifiedViewer.generate(sessionEvents ?? [], harLog, consoleLogs, memo)], { type: 'text/html' }),
      filename: `qa-report-${timestamp}.html`,
    });

    for (const { blob, filename } of files) {
      await LocalStorage.downloadBlob(blob, filename);
    }
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
