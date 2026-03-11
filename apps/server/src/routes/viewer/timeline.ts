import type { FastifyRequest, FastifyReply } from 'fastify';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getPresignedUrl } from '../../lib/s3.js';
import { SessionRepository } from '../../repositories/SessionRepository.js';
import { S3_KEY } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { HARLog } from '@qa-recorder/shared';

export async function getTimeline(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const repo = new SessionRepository(request.server);
  const session = await repo.findById(sessionId);
  if (!session || session.status !== 'done') {
    reply.code(404).send({ error: 'Session not ready' });
    return;
  }

  // 비디오 presigned URL
  const videoUrl = await getPresignedUrl(request.server.s3, S3_KEY.video(sessionId));

  // HAR JSON 조회
  const harRes = await request.server.s3.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: S3_KEY.har(sessionId) }),
  );
  const harText = await harRes.Body?.transformToString();
  const harLog: HARLog = JSON.parse(harText ?? '{}');

  reply.send({
    videoUrl,
    harEntries: harLog.entries ?? [],
    startedAt: session.recording_started_at?.toISOString(),
  });
}
