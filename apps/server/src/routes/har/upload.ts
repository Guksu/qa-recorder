import type { FastifyRequest, FastifyReply } from 'fastify';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3_KEY } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { HARLog } from '@qa-recorder/shared';

export async function uploadHAR(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const harLog = request.body as HARLog;

  await request.server.s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: S3_KEY.har(sessionId),
      Body: JSON.stringify(harLog),
      ContentType: 'application/json',
    }),
  );

  await request.server.pg.query(
    `UPDATE sessions SET har_s3_key = $1 WHERE id = $2`,
    [S3_KEY.har(sessionId), sessionId],
  );

  reply.code(201).send({ key: S3_KEY.har(sessionId) });
}
