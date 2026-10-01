import { describe, it, expect } from 'vitest';
import pkg from '../../../package.json';
import { VERSION } from '../version.js';

describe('VERSION', () => {
  it('package.json의 version과 같다 (HAR의 creator.version에 기록되므로 함께 올려야 한다)', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
