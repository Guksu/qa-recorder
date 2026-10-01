import type { EnvironmentInfo } from '../core/environment.js';
import type { HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import { UnifiedViewer } from '../viewer/UnifiedViewer.js';
import { zip, zipSync, strToU8, type Zippable } from 'fflate';

export class LocalStorage {
  static async save(
    sessionEvents: unknown[] | null,
    harLog: HARLog,
    consoleLogs: ConsoleEntry[] = [],
    memo = '',
    environment?: EnvironmentInfo,
  ): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // 직렬화와 압축은 메인 스레드를 오래 잡으므로, 그 전에 "Saving..." 진행 막대가 먼저 그려지게 한 번 양보한다
    await nextPaint();

    const entries: Record<string, Uint8Array> = {};

    if (sessionEvents) {
      entries[`qa-session-${timestamp}.rr.json`] = strToU8(JSON.stringify(sessionEvents));
    }
    entries[`qa-network-${timestamp}.har`] = strToU8(JSON.stringify(harLog, null, 2));
    if (environment) {
      entries[`qa-env-${timestamp}.json`] = strToU8(JSON.stringify(environment, null, 2));
    }
    entries[`qa-report-${timestamp}.html`] = strToU8(
      UnifiedViewer.generate(sessionEvents ?? [], harLog, consoleLogs, memo, environment),
    );

    // TS 5.9+: Uint8Array<ArrayBufferLike>는 BlobPart로 좁혀지지 않으므로 명시 캐스트
    const zipped = (await zipOffMainThread(entries)) as Uint8Array<ArrayBuffer>;
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

/** 다음 화면 그리기가 끝난 뒤에 resolve (requestAnimationFrame이 없으면 다음 태스크) */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

/**
 * fflate의 비동기 zip으로 압축한다 (큰 파일은 Web Worker에서 압축해 페이지가 멈추지 않는다).
 * 페이지의 CSP가 blob: Worker를 막는 등 비동기 압축이 실패하면 기존처럼 메인 스레드에서 zipSync로 압축한다.
 * zip()은 consume 옵션 없이는 입력 버퍼를 Worker로 넘기지 않고 복사하므로 실패 후에도 entries를 그대로 쓸 수 있다.
 */
function zipOffMainThread(entries: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const fallback = () => {
      try {
        resolve(zipSync(entries));
      } catch (err) {
        reject(err);
      }
    };
    try {
      zip(entries, (err, data) => (err ? fallback() : resolve(data)));
    } catch {
      fallback();
    }
  });
}
