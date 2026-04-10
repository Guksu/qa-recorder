import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IndexedDBBackup, type BackupData } from '../IndexedDBBackup.js';

function makeBackup(): BackupData {
  return {
    events: [{ type: 2, data: {}, timestamp: 1000 }],
    harEntries: [],
    consoleLogs: [],
    savedAt: new Date().toISOString(),
  };
}

describe('IndexedDBBackup', () => {
  beforeEach(async () => {
    /* fake-indexeddb는 모듈 간 상태를 공유하므로 각 테스트 전 데이터만 초기화 */
    await IndexedDBBackup.clear();
  });

  it('save() 후 hasData()는 true를 반환한다', async () => {
    await IndexedDBBackup.save(makeBackup());
    expect(await IndexedDBBackup.hasData()).toBe(true);
  });

  it('데이터가 없으면 hasData()는 false를 반환한다', async () => {
    expect(await IndexedDBBackup.hasData()).toBe(false);
  });

  it('save()한 데이터를 load()로 복원할 수 있다', async () => {
    const backup = makeBackup();
    await IndexedDBBackup.save(backup);
    const loaded = await IndexedDBBackup.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.events).toEqual(backup.events);
    expect(loaded!.savedAt).toBe(backup.savedAt);
  });

  it('데이터가 없으면 load()는 null을 반환한다', async () => {
    expect(await IndexedDBBackup.load()).toBeNull();
  });

  it('clear() 후 hasData()는 false를 반환한다', async () => {
    await IndexedDBBackup.save(makeBackup());
    await IndexedDBBackup.clear();
    expect(await IndexedDBBackup.hasData()).toBe(false);
  });

  it('consoleLogs와 harEntries가 함께 저장된다', async () => {
    const backup: BackupData = {
      events: [],
      harEntries: [{ url: 'https://api.example.com' }],
      consoleLogs: [{ level: 'error', message: 'Test error', timestamp: '', _offsetMs: 0 }],
      savedAt: new Date().toISOString(),
    };
    await IndexedDBBackup.save(backup);
    const loaded = await IndexedDBBackup.load();
    expect(loaded!.harEntries).toEqual(backup.harEntries);
    expect(loaded!.consoleLogs).toEqual(backup.consoleLogs);
  });

  it('덮어쓰기가 가능하다 — save()를 두 번 호출하면 마지막 데이터가 유지된다', async () => {
    await IndexedDBBackup.save({ ...makeBackup(), events: [{ type: 1 }] });
    await IndexedDBBackup.save({ ...makeBackup(), events: [{ type: 2 }] });
    const loaded = await IndexedDBBackup.load();
    expect((loaded!.events[0] as { type: number }).type).toBe(2);
  });

  it('warmUp()은 커넥션을 미리 열고 이후 save()가 즉시 실행된다', async () => {
    await IndexedDBBackup.warmUp();
    await IndexedDBBackup.save(makeBackup());
    expect(await IndexedDBBackup.hasData()).toBe(true);
  });
});
