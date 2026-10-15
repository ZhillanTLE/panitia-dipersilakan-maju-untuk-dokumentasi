// Small IndexedDB wrapper. Everything stays in this browser profile (app-private storage).

const DB_NAME = 'dengarbaca';
const DB_VERSION = 1;

export type StoreName = 'students' | 'sessions' | 'takes' | 'audio';

const KEY_PATHS: Record<Exclude<StoreName, 'audio'>, string> = {
  students: 'student_ref',
  sessions: 'session_id',
  takes: 'take_id',
};

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(KEY_PATHS)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const db = {
  all<T>(store: StoreName): Promise<T[]> {
    return run(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  },
  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return run(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  },
  put(store: StoreName, value: unknown, key?: string): Promise<IDBValidKey> {
    return run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
  },
  delete(store: StoreName, key: string): Promise<undefined> {
    return run(store, 'readwrite', (s) => s.delete(key));
  },
  async clear(): Promise<void> {
    for (const store of ['students', 'sessions', 'takes', 'audio'] as StoreName[]) {
      await run(store, 'readwrite', (s) => s.clear());
    }
  },
};
