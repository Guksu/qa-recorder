const KEY_PREFIX = 'qa-recorder:resume:';

interface ResumeState {
  uploadId: string;
  completedParts: Array<{ partNumber: number; etag: string }>;
}

export class ResumeManager {
  static save(sessionId: string, uploadId: string, completedParts: Array<{ partNumber: number; etag: string }>): void {
    localStorage.setItem(KEY_PREFIX + sessionId, JSON.stringify({ uploadId, completedParts }));
  }

  static load(sessionId: string): ResumeState | null {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId);
    return raw ? (JSON.parse(raw) as ResumeState) : null;
  }

  static clear(sessionId: string): void {
    localStorage.removeItem(KEY_PREFIX + sessionId);
  }
}
