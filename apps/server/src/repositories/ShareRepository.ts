import type { FastifyInstance } from 'fastify';

export interface ShareRow {
  id: string;
  session_id: string;
  token: string;
  expires_at: Date;
  access_count: number;
  created_at: Date;
}

export class ShareRepository {
  constructor(private readonly fastify: FastifyInstance) {}

  async create(params: { sessionId: string; token: string; expiresAt: Date }): Promise<ShareRow> {
    const { rows } = await this.fastify.pg.query<ShareRow>(
      `INSERT INTO share_links (session_id, token, expires_at)
       VALUES ($1, $2, $3) RETURNING *`,
      [params.sessionId, params.token, params.expiresAt],
    );
    return rows[0];
  }

  async findByToken(token: string): Promise<ShareRow | null> {
    const { rows } = await this.fastify.pg.query<ShareRow>(
      `SELECT * FROM share_links WHERE token = $1 AND expires_at > now()`,
      [token],
    );
    if (!rows[0]) return null;
    await this.fastify.pg.query(
      `UPDATE share_links SET access_count = access_count + 1 WHERE token = $1`,
      [token],
    );
    return rows[0];
  }
}
