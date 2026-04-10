export interface BackupData {
  events: unknown[];
  harEntries: unknown[];
  consoleLogs: unknown[];
  savedAt: string;
}

const DB_NAME    = 'qa-recorder';
const STORE_NAME = 'backup';
const RECORD_KEY = 'session';
const DB_VERSION = 1;

/** 커넥션 캐시 — 한 번 열면 재사용하여 unload 시 빠른 저장 보장 */
let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function txPut(db: IDBDatabase, data: BackupData): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put(data, RECORD_KEY);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function txGet(db: IDBDatabase): Promise<BackupData | null> {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(RECORD_KEY);
    req.onsuccess = () => resolve((req.result as BackupData) ?? null);
    req.onerror   = () => reject(req.error);
  });
}

function txDelete(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(RECORD_KEY);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export class IndexedDBBackup {
  /** init() 시점에 호출해 커넥션을 미리 열어둠 — visibilitychange 시 저장 속도 보장 */
  static warmUp(): Promise<void> {
    return getDB().then(() => undefined);
  }

  static async save(data: BackupData): Promise<void> {
    const db = await getDB();
    await txPut(db, data);
  }

  static async load(): Promise<BackupData | null> {
    const db = await getDB();
    return txGet(db);
  }

  static async clear(): Promise<void> {
    const db = await getDB();
    await txDelete(db);
  }

  static async hasData(): Promise<boolean> {
    const data = await IndexedDBBackup.load();
    return data !== null;
  }
}
