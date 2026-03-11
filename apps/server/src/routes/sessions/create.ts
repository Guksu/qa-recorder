import type { FastifyRequest, FastifyReply } from 'fastify';
import { SessionService } from '../../services/SessionService.js';
import type { CreateSessionRequest } from '@qa-recorder/shared';

export async function createSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { recordingStartedAt } = request.body as CreateSessionRequest;
  const apiKey = request.headers.authorization!.slice(7);

  const service = new SessionService(request.server);
  const result = await service.create(apiKey, recordingStartedAt);

  reply.code(201).send({ sessionId: result.sessionId, expiresAt: result.expiresAt.toISOString() });
}
