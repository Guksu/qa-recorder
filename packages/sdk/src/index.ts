export { QARecorder } from './core/QARecorder.js';
export type { QARecorderConfig } from './core/config.js';

// 자동 초기화: script 태그로 삽입 시 window.__QA_RECORDER_CONFIG__ 감지
if (typeof window !== 'undefined' && (window as Window & { __QA_RECORDER_CONFIG__?: object }).__QA_RECORDER_CONFIG__) {
  const { QARecorder } = await import('./core/QARecorder.js');
  const recorder = new QARecorder();
  recorder.init().catch(console.error);
}
