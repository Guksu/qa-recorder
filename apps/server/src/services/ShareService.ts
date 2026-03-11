import type { FastifyInstance } from 'fastify';
import { ShareRepository } from '../repositories/ShareRepository.js';
import { generateToken } from '../lib/tokenGenerator.js';
import { addDays } from '../lib/date.js';
import { env } from '../config/env.js';

export class ShareService {
  private repo: ShareRepository;

  constructor(private readonly fastify: FastifyInstance) {
    this.repo = new ShareRepository(fastify);
  }

  async create(sessionId: string, expiresInDays?: number): Promise<{ shareUrl: string; token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = addDays(new Date(), expiresInDays ?? env.SHARE_LINK_TTL_DAYS);
    await this.repo.create({ sessionId, token, expiresAt });
    const shareUrl = `${process.env.PUBLIC_URL ?? ''}/s/${token}`;
    return { shareUrl, token, expiresAt };
  }

  async resolve(token: string): Promise<{ sessionId: string } | null> {
    const row = await this.repo.findByToken(token);
    return row ? { sessionId: row.session_id } : null;
  }
}
