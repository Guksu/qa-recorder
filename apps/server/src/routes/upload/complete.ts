import type { FastifyRequest, FastifyReply } from 'fastify';
import { UploadService } from '../../services/UploadService.js';
import type { CompleteUploadRequest } from '@qa-recorder/shared';

export async function completeUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { sessionId, uploadId, parts } = request.body as CompleteUploadRequest;
  const service = new UploadService(request.server);
  await service.completeUpload(sessionId, uploadId, parts);
  reply.send({ status: 'transcoding' });
}
