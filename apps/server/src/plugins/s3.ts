import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    s3: S3Client;
  }
}

export const s3Plugin = fp(async (fastify: FastifyInstance) => {
  const client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  fastify.decorate('s3', client);
});
