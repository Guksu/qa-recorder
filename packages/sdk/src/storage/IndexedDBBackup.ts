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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
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
  static async save(data: BackupData): Promise<void> {
    const db = await openDB();
    await txPut(db, data);
    db.close();
  }

  static async load(): Promise<BackupData | null> {
    const db     = await openDB();
    const result = await txGet(db);
    db.close();
    return result;
  }

  static async clear(): Promise<void> {
    const db = await openDB();
    await txDelete(db);
    db.close();
  }

  static async hasData(): Promise<boolean> {
    const data = await IndexedDBBackup.load();
    return data !== null;
  }
}
