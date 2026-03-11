import type { HARLog, HAREntry } from '@qa-recorder/shared';

export class HARBuilder {
  static build(entries: HAREntry[]): HARLog {
    return {
      version: '1.2',
      creator: { name: 'qa-recorder', version: '0.1.0' },
      entries,
    };
  }
}
