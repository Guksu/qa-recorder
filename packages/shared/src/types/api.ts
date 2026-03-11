import type { SessionStatus } from './session.js';
import type { HAREntry } from './har.js';

// Session
export interface CreateSessionRequest {
  recordingStartedAt: string;
}
export interface CreateSessionResponse {
  sessionId: string;
  expiresAt: string;
}
export interface GetSessionResponse {
  sessionId: string;
  status: SessionStatus;
  durationMs?: number;
  thumbnailUrl?: string;
}

// Upload
export interface InitUploadRequest {
  sessionId: string;
  fileName: string;
  mimeType: string;
}
export interface InitUploadResponse {
  uploadId: string;
}
export interface UploadChunkResponse {
  partNumber: number;
  etag: string;
}
export interface CompleteUploadRequest {
  sessionId: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}
export interface UploadStatusResponse {
  status: SessionStatus;
  progress?: number;
}

// Share
export interface CreateShareRequest {
  expiresInDays?: number;
}
export interface CreateShareResponse {
  shareUrl: string;
  token: string;
  expiresAt: string;
}

// Viewer
export interface TimelineResponse {
  videoUrl: string;
  harEntries: HAREntry[];
  startedAt: string;
}
