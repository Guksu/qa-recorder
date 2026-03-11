import type { HARLog } from '@qa-recorder/shared';
import { apiClient } from '../api/client.js';
import { ChunkUploader } from '../upload/ChunkUploader.js';

export class RemoteStorage {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {
    apiClient.configure(endpoint, apiKey);
  }

  async upload(
    videoBlob: Blob,
    harLog: HARLog,
    onProgress: (progress: number) => void,
  ): Promise<string> {
    // 1. 세션 생성
    const { sessionId } = await apiClient.createSession(new Date().toISOString());

    // 2. HAR 업로드
    await apiClient.uploadHAR(sessionId, harLog);

    // 3. 비디오 멀티파트 업로드 초기화
    const { uploadId } = await apiClient.initUpload(sessionId, 'recording.webm', 'video/webm');

    // 4. 청크 업로드
    const uploader = new ChunkUploader(sessionId, uploadId);
    const parts = await uploader.upload(videoBlob, onProgress);

    // 5. 업로드 완료 처리
    await apiClient.completeUpload(sessionId, uploadId, parts);

    // 6. 트랜스코딩 완료까지 polling
    await this.pollUntilDone(sessionId);

    // 7. 공유 링크 생성
    const { shareUrl } = await apiClient.createShare(sessionId);
    return shareUrl;
  }

  private async pollUntilDone(sessionId: string): Promise<void> {
    const INTERVAL = 2000;
    const TIMEOUT = 5 * 60 * 1000; // 5분
    const start = Date.now();

    while (Date.now() - start < TIMEOUT) {
      const { status } = await apiClient.getUploadStatus(sessionId);
      if (status === 'done') return;
      if (status === 'expired') throw new Error('Session expired during processing');
      await delay(INTERVAL);
    }
    throw new Error('Transcoding timeout');
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
