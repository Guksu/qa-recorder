import type { FastifyInstance } from 'fastify';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SessionRepository } from '../repositories/SessionRepository.js';
import { runFFmpeg } from '../lib/ffmpeg.js';
import { S3_KEY } from '../config/constants.js';
import { env } from '../config/env.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, readFile, unlink } from 'fs/promises';

export class TranscodeService {
  private sessionRepo: SessionRepository;

  constructor(private readonly fastify: FastifyInstance) {
    this.sessionRepo = new SessionRepository(fastify);
  }

  async enqueue(sessionId: string): Promise<void> {
    await this.sessionRepo.transition(sessionId, 'transcoding');

    const rawKey = S3_KEY.rawVideo(sessionId);
    const rawPath = join(tmpdir(), `${sessionId}.webm`);
    const outPath = join(tmpdir(), `${sessionId}.mp4`);
    const thumbPath = join(tmpdir(), `${sessionId}-thumb.png`);

    try {
      // S3에서 raw 비디오 다운로드
      const getCmd = new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: rawKey });
      const s3Res = await this.fastify.s3.send(getCmd);
      const chunks: Uint8Array[] = [];
      for await (const chunk of s3Res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      await writeFile(rawPath, Buffer.concat(chunks));

      // FFmpeg 트랜스코딩 + 썸네일 생성
      await runFFmpeg(rawPath, outPath, thumbPath);

      // 결과물 S3 업로드
      await this.fastify.s3.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: S3_KEY.video(sessionId),
        Body: await readFile(outPath),
        ContentType: 'video/mp4',
      }));
      await this.fastify.s3.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: S3_KEY.thumbnail(sessionId),
        Body: await readFile(thumbPath),
        ContentType: 'image/png',
      }));

      await this.sessionRepo.transition(sessionId, 'done', {
        video_s3_key: S3_KEY.video(sessionId) as unknown as null,
        thumbnail_s3_key: S3_KEY.thumbnail(sessionId) as unknown as null,
      });
    } finally {
      await Promise.allSettled([unlink(rawPath), unlink(outPath), unlink(thumbPath)]);
    }
  }
}
