import type { FastifyRequest, FastifyReply } from 'fastify';
import { UploadService } from '../../services/UploadService.js';

export async function uploadChunk(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const data = await request.file();
  if (!data) { reply.code(400).send({ error: 'No file' }); return; }

  const fields = data.fields as Record<string, { value: string }>;
  const sessionId = fields.sessionId?.value;
  const uploadId = fields.uploadId?.value;
  const partNumber = parseInt(fields.partNumber?.value ?? '0', 10);
  const buffer = await data.toBuffer();

  const service = new UploadService(request.server);
  const result = await service.uploadChunk({ sessionId, uploadId, partNumber, buffer });
  reply.send(result);
}
