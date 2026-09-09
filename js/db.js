// Lightweight IndexedDB wrapper. Stores: sales, targets, uploads, meta
const DB_NAME = "ledger-sales-performance";
const DB_VERSION = 1;

let dbPromise = null;

function openDB(){
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sales")){
        const s = db.createObjectStore("sales", { keyPath: "id", autoIncrement: true });
        s.createIndex("period", "period");
        s.createIndex("store", "store");
        s.createIndex("salesperson", "salesperson");
        s.createIndex("uploadId", "uploadId");
      }
      if (!db.objectStoreNames.contains("targets")){
        db.createObjectStore("targets", { keyPath: "key" }); // key = store|salesperson|period
      }
      if (!db.objectStoreNames.contains("uploads")){
        db.createObjectStore("uploads", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("meta")){
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode){
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const DB = {
  async addSalesRecords(records){
    const store = await tx("sales", "readwrite");
    for (const r of records) store.put(r);
    return new Promise((res, rej) => {
      store.transaction.oncomplete = () => res(records.length);
      store.transaction.onerror = () => rej(store.transaction.error);
    });
  },

  async getAllSales(){
    const store = await tx("sales", "readonly");
    return reqToPromise(store.getAll());
  },

  async deleteSalesByUpload(uploadId){
    const store = await tx("sales", "readwrite");
    const idx = store.index("uploadId");
    const range = IDBKeyRange.only(uploadId);
    return new Promise((resolve, reject) => {
      const cursorReq = idx.openCursor(range);
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor){ cursor.delete(); cursor.continue(); }
        else resolve();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  async clearSales(){
    const store = await tx("sales", "readwrite");
    return reqToPromise(store.clear());
  },

  async getAllTargets(){
    const store = await tx("targets", "readonly");
    return reqToPromise(store.getAll());
  },

  async putTargets(targetRows){
    const store = await tx("targets", "readwrite");
    for (const t of targetRows) store.put(t);
    return new Promise((res, rej) => {
      store.transaction.oncomplete = () => res(targetRows.length);
      store.transaction.onerror = () => rej(store.transaction.error);
    });
  },

  async deleteTarget(key){
    const store = await tx("targets", "readwrite");
    return reqToPromise(store.delete(key));
  },

  async clearTargets(){
    const store = await tx("targets", "readwrite");
    return reqToPromise(store.clear());
  },

  async addUpload(meta){
    const store = await tx("uploads", "readwrite");
    return reqToPromise(store.add(meta));
  },

  async getAllUploads(){
    const store = await tx("uploads", "readonly");
    return reqToPromise(store.getAll());
  },

  async deleteUpload(id){
    const store = await tx("uploads", "readwrite");
    return reqToPromise(store.delete(id));
  },

  async clearUploads(){
    const store = await tx("uploads", "readwrite");
    return reqToPromise(store.clear());
  },

  async setMeta(key, value){
    const store = await tx("meta", "readwrite");
    return reqToPromise(store.put({ key, value }));
  },

  async getMeta(key, fallback){
    const store = await tx("meta", "readonly");
    const row = await reqToPromise(store.get(key));
    return row ? row.value : fallback;
  },

  async clearAll(){
    await this.clearSales();
    await this.clearTargets();
    await this.clearUploads();
    const store = await tx("meta", "readwrite");
    await reqToPromise(store.clear());
  }
};
