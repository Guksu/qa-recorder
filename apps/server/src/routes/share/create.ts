import type { FastifyRequest, FastifyReply } from 'fastify';
import { ShareService } from '../../services/ShareService.js';
import type { CreateShareRequest } from '@qa-recorder/shared';

export async function createShare(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { expiresInDays } = (request.body ?? {}) as CreateShareRequest;
  const service = new ShareService(request.server);
  const result = await service.create(request.params.sessionId, expiresInDays);
  reply.code(201).send({ ...result, expiresAt: result.expiresAt.toISOString() });
}
