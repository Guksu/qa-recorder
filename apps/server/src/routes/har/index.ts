import type { FastifyInstance } from 'fastify';
import { uploadHAR } from './upload.js';

export async function harRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/:sessionId/har', uploadHAR);
}
