export interface QARecorderConfig {
  endpoint?: string;
  apiKey?: string;
  maxRequests?: number;
  maskHeaders?: string[];
  storage?: 'remote' | 'local';
}

const DEFAULT_CONFIG: Required<QARecorderConfig> = {
  endpoint: '',
  apiKey: '',
  maxRequests: 100,
  maskHeaders: ['Authorization', 'Cookie', 'Set-Cookie'],
  storage: 'remote',
};

export function resolveConfig(overrides?: QARecorderConfig): Required<QARecorderConfig> {
  const fromWindow = (window as Window & { __QA_RECORDER_CONFIG__?: QARecorderConfig })
    .__QA_RECORDER_CONFIG__ ?? {};
  return { ...DEFAULT_CONFIG, ...fromWindow, ...overrides };
}
