import type { FastifyInstance } from 'fastify';
import fastifyPostgres from '@fastify/postgres';
import { env } from '../config/env.js';

export async function postgresPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyPostgres, { connectionString: env.DATABASE_URL });
}
