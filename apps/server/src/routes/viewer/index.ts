import type { FastifyInstance } from 'fastify';
import { getTimeline } from './timeline.js';

export async function viewerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/:sessionId/timeline', getTimeline);
}
