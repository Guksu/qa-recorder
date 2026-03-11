import type { FastifyRequest, FastifyReply } from 'fastify';
import { UploadService } from '../../services/UploadService.js';
import type { InitUploadRequest } from '@qa-recorder/shared';

export async function initMultipart(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { sessionId, mimeType } = request.body as InitUploadRequest;
  const service = new UploadService(request.server);
  const result = await service.initMultipart(sessionId, mimeType);
  reply.code(201).send(result);
}
