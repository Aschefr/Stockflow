
const DB_NAME = "stockflow_db";
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

export async function getWebDb(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("products")) {
        const prodStore = db.createObjectStore("products", { keyPath: "sku" });
        prodStore.createIndex("category", "category", { unique: false });
        prodStore.createIndex("sub_category", "sub_category", { unique: false });
        prodStore.createIndex("location", "location", { unique: false });
      }

      if (!db.objectStoreNames.contains("boms")) {
        db.createObjectStore("boms", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("history")) {
        const historyStore = db.createObjectStore("history", { autoIncrement: true });
        historyStore.createIndex("sku", "sku", { unique: false });
        historyStore.createIndex("timestamp", "timestamp", { unique: false });
      }

      if (!db.objectStoreNames.contains("audit_log")) {
        const auditStore = db.createObjectStore("audit_log", { keyPath: "audit_id" });
        auditStore.createIndex("sku", "sku", { unique: false });
        auditStore.createIndex("timestamp", "timestamp", { unique: false });
      }

      if (!db.objectStoreNames.contains("applied_events")) {
        db.createObjectStore("applied_events", { keyPath: "filename" });
      }

      if (!db.objectStoreNames.contains("applied_audits")) {
        db.createObjectStore("applied_audits", { keyPath: "filename" });
      }

      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains("media_cache")) {
        db.createObjectStore("media_cache", { keyPath: "path" });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

// ==================== REPOSITORY HELPERS ====================

export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await getWebDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const db = await getWebDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await getWebDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);

    // Sécurité préventive contre les erreurs DataError sur keyPath
    if (storeName === "boms" && (!(value as any)?.id || (value as any)?.id === "undefined")) {
      (value as any).id = crypto.randomUUID();
    }
    if (storeName === "products" && !(value as any)?.sku) {
      console.warn("[idbPut] Produit sans SKU ignoré");
      return resolve();
    }

    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await getWebDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetByIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T[]> {
  const db = await getWebDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(key);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbClear(storeName: string): Promise<void> {
  const db = await getWebDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
