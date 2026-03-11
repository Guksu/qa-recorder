import type { FastifyInstance } from 'fastify';
import type { SessionStatus } from '@qa-recorder/shared';
import { ALLOWED_TRANSITIONS } from '../config/constants.js';

export interface SessionRow {
  id: string;
  api_key_hash: string;
  status: SessionStatus;
  video_s3_key: string | null;
  raw_video_s3_key: string | null;
  har_s3_key: string | null;
  thumbnail_s3_key: string | null;
  s3_multipart_upload_id: string | null;
  duration_ms: number | null;
  recording_started_at: Date | null;
  recording_ended_at: Date | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export class SessionRepository {
  constructor(private readonly fastify: FastifyInstance) {}

  async create(params: {
    apiKeyHash: string;
    recordingStartedAt: Date;
    expiresAt: Date;
  }): Promise<SessionRow> {
    const { rows } = await this.fastify.pg.query<SessionRow>(
      `INSERT INTO sessions (api_key_hash, recording_started_at, expires_at)
       VALUES ($1, $2, $3) RETURNING *`,
      [params.apiKeyHash, params.recordingStartedAt, params.expiresAt],
    );
    return rows[0];
  }

  async findById(id: string): Promise<SessionRow | null> {
    const { rows } = await this.fastify.pg.query<SessionRow>(
      'SELECT * FROM sessions WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async transition(id: string, toStatus: SessionStatus, extra: Partial<SessionRow> = {}): Promise<void> {
    const session = await this.findById(id);
    if (!session) throw new Error(`Session ${id} not found`);

    const allowed = ALLOWED_TRANSITIONS[session.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new Error(`Invalid transition: ${session.status} → ${toStatus}`);
    }

    const setClauses = Object.keys(extra)
      .map((k, i) => `${k} = $${i + 3}`)
      .join(', ');
    const values = Object.values(extra);

    await this.fastify.pg.query(
      `UPDATE sessions SET status = $1, updated_at = now() ${setClauses ? `, ${setClauses}` : ''} WHERE id = $2`,
      [toStatus, id, ...values],
    );
  }

  async deleteExpired(): Promise<number> {
    const { rowCount } = await this.fastify.pg.query(
      `DELETE FROM sessions WHERE expires_at < now()`,
    );
    return rowCount ?? 0;
  }
}
