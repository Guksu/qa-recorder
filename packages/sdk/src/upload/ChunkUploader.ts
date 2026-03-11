import type { UploadChunkResponse } from '@qa-recorder/shared';
import { ResumeManager } from './ResumeManager.js';
import { ProgressTracker } from './ProgressTracker.js';
import { apiClient } from '../api/client.js';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB (S3 멀티파트 최소 단위)
const MAX_RETRIES = 3;
const CONCURRENCY = 3;

export class ChunkUploader {
  constructor(
    private readonly sessionId: string,
    private readonly uploadId: string,
  ) {}

  async upload(
    blob: Blob,
    onProgress: (progress: number) => void,
  ): Promise<Array<{ partNumber: number; etag: string }>> {
    const chunks = this.splitBlob(blob);
    const tracker = new ProgressTracker(chunks.length, onProgress);
    const resume = ResumeManager.load(this.sessionId);
    const completed = resume?.completedParts ?? [];

    const pending = chunks
      .map((chunk, i) => ({ chunk, partNumber: i + 1 }))
      .filter(({ partNumber }) => !completed.find((p) => p.partNumber === partNumber));

    const results = [...completed];

    // CONCURRENCY 개씩 병렬 업로드
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(({ chunk, partNumber }) =>
          this.uploadChunkWithRetry(chunk, partNumber, MAX_RETRIES),
        ),
      );
      results.push(...batchResults);
      batchResults.forEach(() => tracker.tick());
      ResumeManager.save(this.sessionId, this.uploadId, results);
    }

    ResumeManager.clear(this.sessionId);
    return results.sort((a, b) => a.partNumber - b.partNumber);
  }

  private async uploadChunkWithRetry(
    chunk: Blob,
    partNumber: number,
    retriesLeft: number,
  ): Promise<UploadChunkResponse> {
    try {
      return await apiClient.uploadChunk(this.sessionId, this.uploadId, partNumber, chunk);
    } catch (err) {
      if (retriesLeft <= 0) throw err;
      await delay(1000 * (MAX_RETRIES - retriesLeft + 1)); // exponential backoff
      return this.uploadChunkWithRetry(chunk, partNumber, retriesLeft - 1);
    }
  }

  private splitBlob(blob: Blob): Blob[] {
    const chunks: Blob[] = [];
    for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
      chunks.push(blob.slice(offset, offset + CHUNK_SIZE));
    }
    return chunks;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
