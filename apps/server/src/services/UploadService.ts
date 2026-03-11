import type { FastifyInstance } from 'fastify';
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { SessionRepository } from '../repositories/SessionRepository.js';
import { ChunkRepository } from '../repositories/ChunkRepository.js';
import { TranscodeService } from './TranscodeService.js';
import { S3_KEY } from '../config/constants.js';
import { env } from '../config/env.js';

export class UploadService {
  private sessionRepo: SessionRepository;
  private chunkRepo: ChunkRepository;
  private transcodeService: TranscodeService;

  constructor(private readonly fastify: FastifyInstance) {
    this.sessionRepo = new SessionRepository(fastify);
    this.chunkRepo = new ChunkRepository(fastify);
    this.transcodeService = new TranscodeService(fastify);
  }

  async initMultipart(sessionId: string, mimeType: string): Promise<{ uploadId: string }> {
    await this.sessionRepo.transition(sessionId, 'uploading');
    const cmd = new CreateMultipartUploadCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: S3_KEY.rawVideo(sessionId),
      ContentType: mimeType,
    });
    const res = await this.fastify.s3.send(cmd);
    await this.fastify.pg.query(
      `UPDATE sessions SET s3_multipart_upload_id = $1 WHERE id = $2`,
      [res.UploadId, sessionId],
    );
    return { uploadId: res.UploadId! };
  }

  async uploadChunk(params: {
    sessionId: string;
    uploadId: string;
    partNumber: number;
    buffer: Buffer;
  }): Promise<{ partNumber: number; etag: string }> {
    const cmd = new UploadPartCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: S3_KEY.rawVideo(params.sessionId),
      UploadId: params.uploadId,
      PartNumber: params.partNumber,
      Body: params.buffer,
    });
    const res = await this.fastify.s3.send(cmd);
    const etag = res.ETag!;

    await this.chunkRepo.upsert({
      sessionId: params.sessionId,
      partNumber: params.partNumber,
      etag,
      sizeBytes: params.buffer.length,
    });

    return { partNumber: params.partNumber, etag };
  }

  async completeUpload(
    sessionId: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void> {
    const cmd = new CompleteMultipartUploadCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: S3_KEY.rawVideo(sessionId),
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    });
    await this.fastify.s3.send(cmd);

    // 비동기 트랜스코딩 시작
    this.transcodeService.enqueue(sessionId).catch((err) => {
      this.fastify.log.error({ err, sessionId }, 'Transcoding failed');
    });
  }
}
