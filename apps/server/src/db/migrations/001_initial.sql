-- QA Recorder 초기 스키마

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 세션 테이블
CREATE TABLE sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_hash           VARCHAR(64) NOT NULL,
  status                 VARCHAR(20) NOT NULL DEFAULT 'recording'
                           CHECK (status IN ('recording','uploading','transcoding','done','expired')),
  video_s3_key           VARCHAR(512),
  raw_video_s3_key       VARCHAR(512),
  har_s3_key             VARCHAR(512),
  thumbnail_s3_key       VARCHAR(512),
  s3_multipart_upload_id VARCHAR(256),
  duration_ms            INTEGER,
  recording_started_at   TIMESTAMPTZ,
  recording_ended_at     TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_api_key_hash ON sessions(api_key_hash);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- 청크 업로드 추적 테이블 (resume 지원)
CREATE TABLE upload_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  part_number  INTEGER NOT NULL,
  etag         VARCHAR(64),
  size_bytes   INTEGER NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, part_number)
);

-- 공유 링크 테이블
CREATE TABLE share_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token        VARCHAR(16) NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_share_links_token ON share_links(token);
CREATE INDEX idx_share_links_session_id ON share_links(session_id);
CREATE INDEX idx_share_links_expires_at ON share_links(expires_at);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
