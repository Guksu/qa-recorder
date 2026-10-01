import type { HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import type { EnvironmentInfo } from '../core/environment.js';

/** session·har 외에 함께 보내는 파일 (지정한 것만 전송) */
export interface UploadExtras {
  /** 콘솔 로그 → `console` 필드 (qa-console-*.json) */
  consoleLogs?: ConsoleEntry[];
  /** 통합 HTML 리포트 → `report` 필드 (qa-report-*.html) */
  reportHtml?: string;
  /** 저장 시점의 환경 정보 → `env` 필드 (qa-env-*.json) */
  environment?: EnvironmentInfo;
}

export class RemoteDelivery {
  constructor(private readonly endpoint: string) {}

  async send(sessionBlob: Blob | null, harLog: HARLog, memo = '', extras: UploadExtras = {}): Promise<string | undefined> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const form = new FormData();
    if (sessionBlob) form.append('session', sessionBlob, `qa-session-${timestamp}.rr.json`);
    form.append(
      'har',
      new Blob([JSON.stringify(harLog)], { type: 'application/json' }),
      `qa-network-${timestamp}.har`,
    );
    if (extras.consoleLogs) {
      form.append(
        'console',
        new Blob([JSON.stringify(extras.consoleLogs)], { type: 'application/json' }),
        `qa-console-${timestamp}.json`,
      );
    }
    if (extras.reportHtml !== undefined) {
      form.append('report', new Blob([extras.reportHtml], { type: 'text/html' }), `qa-report-${timestamp}.html`);
    }
    if (extras.environment) {
      form.append(
        'env',
        new Blob([JSON.stringify(extras.environment)], { type: 'application/json' }),
        `qa-env-${timestamp}.json`,
      );
    }
    if (memo) form.append('memo', memo);

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
