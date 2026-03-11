import { nanoid } from 'nanoid';

/** 공유 링크용 12자리 URL-safe 토큰 생성 */
export function generateToken(): string {
  return nanoid(12);
}
