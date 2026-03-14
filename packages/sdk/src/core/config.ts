export interface QARecorderConfig {
  endpoint?: string;
  maxRequests?: number;
  maskHeaders?: string[];
}

const DEFAULT_CONFIG: Required<QARecorderConfig> = {
  endpoint: '',
  maxRequests: 100,
  maskHeaders: ['Authorization', 'Cookie', 'Set-Cookie'],
};

export function resolveConfig(overrides?: QARecorderConfig): Required<QARecorderConfig> {
  const fromWindow = (window as Window & { __QA_RECORDER_CONFIG__?: QARecorderConfig })
    .__QA_RECORDER_CONFIG__ ?? {};
  return { ...DEFAULT_CONFIG, ...fromWindow, ...overrides };
}
