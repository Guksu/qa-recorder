import type { FastifyInstance } from 'fastify';
import { createHash } from 'crypto';
import { addDays } from '../lib/date.js';
import { SessionRepository } from '../repositories/SessionRepository.js';
import { env } from '../config/env.js';
import type { Session } from '@qa-recorder/shared';
import { getPresignedUrl } from '../lib/s3.js';
import { S3_KEY } from '../config/constants.js';

export class SessionService {
  private repo: SessionRepository;

  constructor(private readonly fastify: FastifyInstance) {
    this.repo = new SessionRepository(fastify);
  }

  async create(apiKey: string, recordingStartedAt: string): Promise<{ sessionId: string; expiresAt: Date }> {
    const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
    const expiresAt = addDays(new Date(), env.SESSION_TTL_DAYS);
    const row = await this.repo.create({
      apiKeyHash,
      recordingStartedAt: new Date(recordingStartedAt),
      expiresAt,
    });
    return { sessionId: row.id, expiresAt };
  }

  async getById(sessionId: string): Promise<Session> {
    const row = await this.repo.findById(sessionId);
    if (!row) throw Object.assign(new Error('Session not found'), { statusCode: 404 });

    let videoUrl: string | undefined;
    let thumbnailUrl: string | undefined;

    if (row.status === 'done') {
      videoUrl = await getPresignedUrl(this.fastify.s3, S3_KEY.video(sessionId));
      if (row.thumbnail_s3_key) {
        thumbnailUrl = await getPresignedUrl(this.fastify.s3, row.thumbnail_s3_key);
      }
    }

    return {
      id: row.id,
      status: row.status,
      videoUrl,
      thumbnailUrl,
      durationMs: row.duration_ms ?? undefined,
      recordingStartedAt: row.recording_started_at?.toISOString(),
      recordingEndedAt: row.recording_ended_at?.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }
}
