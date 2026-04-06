import type { HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import { HARViewer } from '../viewer/HARViewer.js';
import { SessionViewer } from '../viewer/SessionViewer.js';

export class LocalStorage {
  static async save(sessionEvents: unknown[] | null, harLog: HARLog, consoleLogs: ConsoleEntry[] = []): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (sessionEvents) {
      const sessionJson = JSON.stringify(sessionEvents);
      LocalStorage.downloadBlob(
        new Blob([sessionJson], { type: 'application/json' }),
        `qa-session-${timestamp}.rr.json`,
      );
      const sessionHtml = SessionViewer.generate(sessionEvents);
      LocalStorage.downloadBlob(
        new Blob([sessionHtml], { type: 'text/html' }),
        `qa-session-${timestamp}.html`,
      );
    }

    const harJson = JSON.stringify(harLog, null, 2);
    LocalStorage.downloadBlob(
      new Blob([harJson], { type: 'application/json' }),
      `qa-network-${timestamp}.har`,
    );
    const viewerHtml = HARViewer.generate(harLog, consoleLogs);
    LocalStorage.downloadBlob(
      new Blob([viewerHtml], { type: 'text/html' }),
      `qa-network-${timestamp}.html`,
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
