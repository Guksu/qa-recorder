import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fp from 'fastify-plugin';
import { postgresPlugin } from './plugins/postgres.js';
import { s3Plugin } from './plugins/s3.js';
import { authPlugin } from './plugins/auth.js';
import { sessionRoutes } from './routes/sessions/index.js';
import { uploadRoutes } from './routes/upload/index.js';
import { harRoutes } from './routes/har/index.js';
import { shareRoutes } from './routes/share/index.js';
import { viewerRoutes } from './routes/viewer/index.js';

export const app = fp(async (fastify: FastifyInstance) => {
  // 플러그인
  await fastify.register(cors, { origin: true });
  await fastify.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB
  await fastify.register(postgresPlugin);
  await fastify.register(s3Plugin);

  // 공개 라우트 (인증 불필요)
  await fastify.register(shareRoutes, { prefix: '/s' });

  // 인증 필요 라우트
  await fastify.register(async (instance) => {
    instance.addHook('preHandler', authPlugin);
    await instance.register(sessionRoutes, { prefix: '/sessions' });
    await instance.register(uploadRoutes, { prefix: '/upload' });
    await instance.register(harRoutes, { prefix: '/sessions' });
    await instance.register(viewerRoutes, { prefix: '/sessions' });
  });

  // 헬스체크
  fastify.get('/health', async () => ({ status: 'ok' }));
});
