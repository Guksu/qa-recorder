import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

export async function authPlugin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing Authorization header' });
    return;
  }
  const token = header.slice(7);
  if (token !== env.API_KEY_SECRET) {
    reply.code(401).send({ error: 'Invalid API key' });
  }
}
