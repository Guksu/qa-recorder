export const S3_KEY = {
  rawVideo: (sessionId: string) => `sessions/${sessionId}/raw.webm`,
  video: (sessionId: string) => `sessions/${sessionId}/video.mp4`,
  har: (sessionId: string) => `sessions/${sessionId}/har.json`,
  thumbnail: (sessionId: string) => `sessions/${sessionId}/thumb.png`,
} as const;

export const SESSION_STATUS = {
  RECORDING: 'recording',
  UPLOADING: 'uploading',
  TRANSCODING: 'transcoding',
  DONE: 'done',
  EXPIRED: 'expired',
} as const;

/** 상태 전이 허용 맵 */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  recording: ['uploading'],
  uploading: ['transcoding'],
  transcoding: ['done'],
  done: ['expired'],
  expired: [],
};
