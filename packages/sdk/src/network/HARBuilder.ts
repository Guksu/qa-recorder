import type { HARLog, HAREntry } from '@qa-recorder/shared';
import { VERSION } from '../core/version.js';

export class HARBuilder {
  static build(entries: HAREntry[]): HARLog {
    return {
      version: '1.2',
      creator: { name: 'qa-recorder', version: VERSION },
      entries,
    };
  }
}
