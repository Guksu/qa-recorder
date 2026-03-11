export type SessionStatus =
  | 'recording'
  | 'uploading'
  | 'transcoding'
  | 'done'
  | 'expired';

export interface Session {
  id: string;
  status: SessionStatus;
  videoUrl?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  recordingStartedAt?: string;
  recordingEndedAt?: string;
  expiresAt: string;
  createdAt: string;
}
