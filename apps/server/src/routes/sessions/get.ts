import type { FastifyRequest, FastifyReply } from 'fastify';
import { SessionService } from '../../services/SessionService.js';

export async function getSession(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const service = new SessionService(request.server);
  const session = await service.getById(request.params.sessionId);
  reply.send(session);
}
