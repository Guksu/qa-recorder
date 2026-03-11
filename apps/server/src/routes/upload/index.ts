import type { FastifyInstance } from 'fastify';
import { initMultipart } from './initMultipart.js';
import { uploadChunk } from './chunk.js';
import { completeUpload } from './complete.js';
import { getUploadStatus } from './status.js';

export async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/init', initMultipart);
  fastify.post('/chunk', uploadChunk);
  fastify.post('/complete', completeUpload);
  fastify.get('/status/:sessionId', getUploadStatus);
}
