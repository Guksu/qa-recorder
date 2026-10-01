import { QARecorder } from './core/QARecorder.js';
export { QARecorder };
export type { QARecorderConfig } from './core/config.js';

// 자동 초기화: script 태그로 삽입 시 window.__QA_RECORDER_CONFIG__ 감지.
// setup()을 거쳐 싱글톤으로 등록해야 앱이 이후에 QARecorder.setup()을 호출해도 인스턴스가 하나만 생긴다.
if (typeof window !== 'undefined' && (window as Window & { __QA_RECORDER_CONFIG__?: object }).__QA_RECORDER_CONFIG__) {
  QARecorder.setup();
}
