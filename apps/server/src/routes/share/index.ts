import type { FastifyInstance } from 'fastify';
import { createShare } from './create.js';
import { resolveShare } from './resolve.js';

export async function shareRoutes(fastify: FastifyInstance): Promise<void> {
  // 단축 URL 해석 (인증 불필요)
  fastify.get('/:token', resolveShare);
  // 공유 링크 생성 (인증 필요 - app.ts에서 auth hook 적용)
  fastify.post('/sessions/:sessionId/share', createShare);
}
