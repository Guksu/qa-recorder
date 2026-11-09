import type { HARDocument } from '../types/har.js';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import type { EnvironmentInfo } from '../core/environment.js';
import { createAbortError, isAbortError } from '../core/abort.js';

/** session·har 외에 함께 보내는 파일 (지정한 것만 전송) */
export interface UploadExtras {
  /** 콘솔 로그 → `console` 필드 (qa-console-*.json) */
  consoleLogs?: ConsoleEntry[];
  /** 통합 HTML 리포트 → `report` 필드 (qa-report-*.html) */
  reportHtml?: string;
  /** 저장 시점의 환경 정보 → `env` 필드 (qa-env-*.json) */
  environment?: EnvironmentInfo;
}

export interface SendOptions {
  /**
   * 업로드 전체(요청을 보내고 응답 본문을 다 읽을 때까지)의 제한 시간(ms).
   * 넘기면 요청을 취소하고 UploadTimeoutError로 실패한다. 0, 음수, Infinity, undefined면 제한하지 않는다.
   */
  timeout?: number;
  /** 호출한 쪽의 취소 신호 (녹화기 destroy() 등). 취소되면 요청을 끊고 AbortError(name === 'AbortError')로 실패한다 */
  signal?: AbortSignal;
}

/** 업로드가 제한 시간 안에 끝나지 않았다 — 업로드 실패로 다룬다 (사용자의 취소와 구분) */
export class UploadTimeoutError extends Error {
  constructor(readonly timeout: number) {
    super(`timed out after ${formatSeconds(timeout)}`);
    this.name = 'UploadTimeoutError';
  }
}

export class RemoteDelivery {
  constructor(private readonly endpoint: string) {}

  async send(
    sessionBlob: Blob | null,
    har: HARDocument,
    memo = '',
    extras: UploadExtras = {},
    options: SendOptions = {},
  ): Promise<string | undefined> {
    const { signal } = options;
    if (signal?.aborted) throw createAbortError();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const form = new FormData();
    if (sessionBlob) form.append('session', sessionBlob, `qa-session-${timestamp}.rr.json`);
    form.append(
      'har',
      new Blob([JSON.stringify(har)], { type: 'application/json' }),
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

    // AbortSignal.any·AbortSignal.timeout은 최근 브라우저에만 있어 컨트롤러 하나로 두 신호를 합친다
    const controller = new AbortController();
    let timedOut = false;
    const timeout = options.timeout;
    const timer = typeof timeout === 'number' && timeout > 0 && Number.isFinite(timeout)
      ? setTimeout(() => { timedOut = true; controller.abort(); }, timeout)
      : undefined;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const response = await fetch(this.endpoint, { method: 'POST', body: form, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch (err) {
        // 취소·시간 초과로 본문 읽기가 끊긴 경우는 아래에서 구분한다. 그 밖에는 URL 없는 성공 응답
        if (controller.signal.aborted) throw err;
        return undefined;
      }
      const url = (json as { url?: unknown } | null)?.url;
      return typeof url === 'string' ? url : undefined;
    } catch (err) {
      // 사용자의 취소가 시간 초과보다 우선 — 둘 다 일어났어도 종료한 것으로 다룬다
      if (signal?.aborted) throw isAbortError(err) ? err : createAbortError();
      if (timedOut) throw new UploadTimeoutError(timeout as number);
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function formatSeconds(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}
