import type { FastifyInstance } from 'fastify';

export interface ChunkRow {
  id: string;
  session_id: string;
  part_number: number;
  etag: string | null;
  size_bytes: number;
  uploaded_at: Date;
}

export class ChunkRepository {
  constructor(private readonly fastify: FastifyInstance) {}

  async upsert(params: {
    sessionId: string;
    partNumber: number;
    etag: string;
    sizeBytes: number;
  }): Promise<void> {
    await this.fastify.pg.query(
      `INSERT INTO upload_chunks (session_id, part_number, etag, size_bytes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, part_number) DO UPDATE SET etag = $3`,
      [params.sessionId, params.partNumber, params.etag, params.sizeBytes],
    );
  }

  async findBySession(sessionId: string): Promise<ChunkRow[]> {
    const { rows } = await this.fastify.pg.query<ChunkRow>(
      'SELECT * FROM upload_chunks WHERE session_id = $1 ORDER BY part_number',
      [sessionId],
    );
    return rows;
  }
}
