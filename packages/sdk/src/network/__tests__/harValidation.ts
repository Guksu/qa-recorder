import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import harSchemas from 'har-schema';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json';

/**
 * HAR 1.2 JSON 스키마(har-schema, har-validator가 쓰던 스키마)로 검증하는 함수 (vitest와 Playwright E2E가 함께 쓴다).
 * har-schema는 draft-06이며 `optional`·`min` 같은 비표준 키워드를 써서 strict 모드를 끈다.
 * `min`은 Ajv가 검사하지 않으므로 HAR 명세의 수치 규칙은 checkHarSpecRules로 따로 확인한다.
 */
function createValidator() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addMetaSchema(draft06);
  for (const schema of Object.values(harSchemas as Record<string, object>)) ajv.addSchema(schema);
  return ajv.getSchema('har.json#')!;
}

const validate = createValidator();

/** 스키마 위반과 명세 규칙 위반을 사람이 읽을 수 있는 문자열 목록으로 반환한다 (없으면 []) */
export function harProblems(har: unknown): string[] {
  const problems: string[] = [];
  if (!validate(har)) {
    for (const err of validate.errors ?? []) problems.push(`schema ${err.instancePath} ${err.message}`);
  }
  problems.push(...checkHarSpecRules(har));
  return problems;
}

/**
 * 스키마가 표현하지 않는 HAR 1.2 명세 규칙:
 * - timings의 send·wait·receive는 0 이상, 나머지 단계는 -1(해당 없음) 이상
 * - entry.time은 -1이 아닌 timings의 합
 * - 크기 필드(headersSize, bodySize, content.size)는 -1 이상의 정수
 */
export function checkHarSpecRules(har: unknown): string[] {
  const problems: string[] = [];
  const entries = (har as { log?: { entries?: unknown[] } })?.log?.entries;
  if (!Array.isArray(entries)) return ['log.entries is not an array'];
  entries.forEach((raw, i) => {
    const e = raw as {
      time: number;
      timings: Record<string, unknown>;
      request: { headersSize: number; bodySize: number };
      response: { headersSize: number; bodySize: number; content: { size: number } };
    };
    for (const key of ['send', 'wait', 'receive']) {
      if (!(typeof e.timings[key] === 'number' && (e.timings[key] as number) >= 0)) {
        problems.push(`entries[${i}].timings.${key} must be >= 0`);
      }
    }
    let sum = 0;
    for (const key of ['blocked', 'dns', 'connect', 'send', 'wait', 'receive']) {
      const v = e.timings[key];
      if (v === undefined) continue;
      if (typeof v !== 'number' || v < -1) problems.push(`entries[${i}].timings.${key} must be >= -1`);
      else if (v !== -1) sum += v;
    }
    // ssl은 connect에 포함되므로 합에 더하지 않는다 (HAR 1.2)
    if (Math.abs(sum - e.time) > 1e-6) problems.push(`entries[${i}].time (${e.time}) != sum of timings (${sum})`);
    const sizes = {
      'request.headersSize': e.request.headersSize,
      'request.bodySize': e.request.bodySize,
      'response.headersSize': e.response.headersSize,
      'response.bodySize': e.response.bodySize,
      'response.content.size': e.response.content.size,
    };
    for (const [name, v] of Object.entries(sizes)) {
      if (!Number.isInteger(v) || v < -1) problems.push(`entries[${i}].${name} must be an integer >= -1`);
    }
  });
  return problems;
}
