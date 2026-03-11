import Fastify from 'fastify';
import { app } from './app.js';
import { env } from './config/env.js';

const server = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

async function start(): Promise<void> {
  await server.register(app);
  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  server.log.info(`Server running on port ${env.PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
