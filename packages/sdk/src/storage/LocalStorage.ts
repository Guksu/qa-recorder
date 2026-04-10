import type { HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import { UnifiedViewer } from '../viewer/UnifiedViewer.js';

export class LocalStorage {
  static async save(sessionEvents: unknown[] | null, harLog: HARLog, consoleLogs: ConsoleEntry[] = [], memo = ''): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (sessionEvents) {
      const sessionJson = JSON.stringify(sessionEvents);
      LocalStorage.downloadBlob(
        new Blob([sessionJson], { type: 'application/json' }),
        `qa-session-${timestamp}.rr.json`,
      );
    }

    const harJson = JSON.stringify(harLog, null, 2);
    LocalStorage.downloadBlob(
      new Blob([harJson], { type: 'application/json' }),
      `qa-network-${timestamp}.har`,
    );

    const reportHtml = UnifiedViewer.generate(sessionEvents ?? [], harLog, consoleLogs, memo);
    LocalStorage.downloadBlob(
      new Blob([reportHtml], { type: 'text/html' }),
      `qa-report-${timestamp}.html`,
    );
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
