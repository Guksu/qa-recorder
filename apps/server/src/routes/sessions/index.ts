import type { FastifyInstance } from 'fastify';
import { createSession } from './create.js';
import { getSession } from './get.js';

export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/', createSession);
  fastify.get('/:sessionId', getSession);
}
