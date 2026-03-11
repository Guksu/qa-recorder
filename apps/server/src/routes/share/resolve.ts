import type { FastifyRequest, FastifyReply } from 'fastify';
import { ShareService } from '../../services/ShareService.js';

export async function resolveShare(
  request: FastifyRequest<{ Params: { token: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const service = new ShareService(request.server);
  const result = await service.resolve(request.params.token);
  if (!result) { reply.code(404).send({ error: 'Link not found or expired' }); return; }
  // 뷰어 페이지로 리다이렉트
  reply.redirect(302, `/viewer/${result.sessionId}`);
}
