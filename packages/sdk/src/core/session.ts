export interface LocalSession {
  sessionId: string;
  recordingStartedAt: Date;
  recordingEndedAt?: Date;
}

export function createLocalSession(sessionId: string): LocalSession {
  return { sessionId, recordingStartedAt: new Date() };
}
