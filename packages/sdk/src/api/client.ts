import type {
  CreateSessionResponse,
  InitUploadResponse,
  UploadChunkResponse,
  UploadStatusResponse,
  CreateShareResponse,
  HARLog,
} from '@qa-recorder/shared';

class APIClient {
  private baseURL = '';
  private apiKey = '';

  configure(baseURL: string, apiKey: string): void {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...init.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${path} failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<T>;
  }

  createSession(recordingStartedAt: string): Promise<CreateSessionResponse> {
    return this.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingStartedAt }),
    });
  }

  uploadHAR(sessionId: string, harLog: HARLog): Promise<void> {
    return this.request(`/sessions/${sessionId}/har`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(harLog),
    });
  }

  initUpload(sessionId: string, fileName: string, mimeType: string): Promise<InitUploadResponse> {
    return this.request('/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, fileName, mimeType }),
    });
  }

  uploadChunk(
    sessionId: string,
    uploadId: string,
    partNumber: number,
    chunk: Blob,
  ): Promise<UploadChunkResponse> {
    const form = new FormData();
    form.append('sessionId', sessionId);
    form.append('uploadId', uploadId);
    form.append('partNumber', String(partNumber));
    form.append('chunk', chunk);
    return this.request('/upload/chunk', { method: 'POST', body: form });
  }

  completeUpload(
    sessionId: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void> {
    return this.request('/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, uploadId, parts }),
    });
  }

  getUploadStatus(sessionId: string): Promise<UploadStatusResponse> {
    return this.request(`/upload/status/${sessionId}`);
  }

  createShare(sessionId: string): Promise<CreateShareResponse> {
    return this.request(`/sessions/${sessionId}/share`, { method: 'POST' });
  }
}

export const apiClient = new APIClient();
