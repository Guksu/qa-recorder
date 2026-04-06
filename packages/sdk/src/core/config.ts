import type { ConsoleLevel } from '../console/ConsoleCapture.js';

export interface QARecorderConfig {
  endpoint?: string;
  maxRequests?: number;
  maskHeaders?: string[];
  zIndex?: number;
  consoleLevels?: ConsoleLevel[];
  maxConsoleEntries?: number;
}

const DEFAULT_CONFIG: Required<QARecorderConfig> = {
  endpoint: '',
  maxRequests: 100,
  maskHeaders: ['Authorization', 'Cookie', 'Set-Cookie'],
  zIndex: 2147483647,
  consoleLevels: ['error', 'warn'],
  maxConsoleEntries: 200,
};

export function resolveConfig(overrides?: QARecorderConfig): Required<QARecorderConfig> {
  const fromWindow = (window as Window & { __QA_RECORDER_CONFIG__?: QARecorderConfig })
    .__QA_RECORDER_CONFIG__ ?? {};
  return { ...DEFAULT_CONFIG, ...fromWindow, ...overrides };
}
