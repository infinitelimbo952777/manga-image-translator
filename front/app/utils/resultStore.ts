import { processingStatuses, type FileEntry, type FileStatus, type FinishedImage } from "@/types";

/**
 * 翻译会话持久化(IndexedDB):
 *  - results  : 画廊结果图(key = originalName),Blob 原生存储
 *  - entries  : 待翻译文件列表(key = entry.id),含源文件 File 对象,
 *               刷新后不用重新选择文件夹,还能直接续翻
 *  - statuses : 每个文件的翻译状态(key = entry.id,不存 result Blob,
 *               恢复时从 results 里按 relativePath 取回)
 *
 * localStorage 存不了 Blob(旧版曾 JSON.stringify 进去,Blob 变成空对象,
 * 刷新后画廊崩溃——见 localStorage.ts 的 clearLegacyFinishedImages)。
 *
 * 所有操作失败(浏览器不支持/隐私模式/配额不足)只降级为"不持久化",
 * 不影响本次会话内的正常使用。
 */

const DB_NAME = "manga-translator-results";
const DB_VERSION = 2;
const RESULTS = "results";
const ENTRIES = "entries";
const STATUSES = "statuses";

let dbPromise: Promise<IDBDatabase> | null = null;
let quotaWarned = false;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RESULTS)) db.createObjectStore(RESULTS);
        if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES);
        if (!db.objectStoreNames.contains(STATUSES)) db.createObjectStore(STATUSES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function warnOnce(scene: string, error: unknown) {
  if (quotaWarned) return;
  quotaWarned = true;
  console.warn(`resultStore: ${scene} failed, session will not persist:`, error);
}

function getAll<T>(store: string): Promise<T[]> {
  return openDB().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as T[]);
        req.onerror = () => reject(req.error);
      })
  );
}

/** clear + 逐条写入,同一个事务内完成 */
function rewrite(store: string, records: { key: IDBValidKey; value: unknown }[]): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        const os = tx.objectStore(store);
        os.clear();
        for (const r of records) os.put(r.value, r.key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

// ---------- 画廊结果 ----------

/** 刷新后恢复画廊;按完成时间倒序,与内存中的插入顺序一致 */
export async function loadSavedResults(): Promise<FinishedImage[]> {
  try {
    const records = await getAll<FinishedImage>(RESULTS);
    return records
      .map((r) => ({ ...r, finishedAt: new Date(r.finishedAt) }))
      .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
  } catch (error) {
    warnOnce("load results", error);
    return [];
  }
}

/** 单条写入(翻译完成时调用);重新翻译同一文件自动覆盖旧记录 */
export async function saveResult(image: FinishedImage): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RESULTS, "readwrite");
      tx.objectStore(RESULTS).put(image, image.originalName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    warnOnce("save result", error);
  }
}

export async function clearSavedResults(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RESULTS, "readwrite");
      tx.objectStore(RESULTS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    warnOnce("clear results", error);
  }
}

// ---------- 待翻译文件列表 ----------

export async function loadSavedEntries(): Promise<FileEntry[]> {
  try {
    return await getAll<FileEntry>(ENTRIES);
  } catch (error) {
    warnOnce("load entries", error);
    return [];
  }
}

export async function saveEntries(entries: FileEntry[]): Promise<void> {
  try {
    await rewrite(
      ENTRIES,
      entries.map((e) => ({ key: e.id, value: e }))
    );
  } catch (error) {
    warnOnce("save entries", error);
  }
}

// ---------- 翻译状态 ----------

/**
 * 恢复状态并归一化:
 *  - finished 状态从 results 仓库按 relativePath 取回缩略图 Blob,
 *    结果已被"全部清空"的按未翻译处理
 *  - 进行中的状态(刷新时被中断)重置为未翻译
 *  - error 状态原样保留,便于续翻时重试
 */
export async function loadSavedStatuses(entries: FileEntry[]): Promise<Map<string, FileStatus>> {
  const map = new Map<string, FileStatus>();
  try {
    const [raw, results] = await Promise.all([
      getAll<{ id: string } & FileStatus>(STATUSES),
      getAll<FinishedImage>(RESULTS),
    ]);
    const resultByName = new Map(results.map((r) => [r.originalName, r.result]));
    for (const entry of entries) {
      const st = raw.find((r) => r.id === entry.id);
      if (!st || !st.status) continue;
      if (st.status === "finished") {
        const blob = resultByName.get(entry.relativePath);
        if (blob) {
          map.set(entry.id, { status: "finished", progress: null, queuePos: null, error: null, result: blob });
        }
      } else if (!processingStatuses.includes(st.status)) {
        map.set(entry.id, { status: st.status, progress: null, queuePos: null, error: st.error, result: null });
      }
    }
  } catch (error) {
    warnOnce("load statuses", error);
  }
  return map;
}

export async function saveStatuses(entries: FileEntry[], statuses: Map<string, FileStatus>): Promise<void> {
  try {
    const records: { key: IDBValidKey; value: unknown }[] = [];
    for (const e of entries) {
      const s = statuses.get(e.id);
      if (!s || !s.status) continue;
      // result Blob 不入库(画廊仓库里已有),恢复时按 relativePath 取回
      records.push({
        key: e.id,
        value: { id: e.id, status: s.status, progress: null, queuePos: null, error: s.error },
      });
    }
    await rewrite(STATUSES, records);
  } catch (error) {
    warnOnce("save statuses", error);
  }
}

/** 清空待翻译列表时同步清掉 entries + statuses(画廊另由 clearSavedResults 处理) */
export async function clearSavedSession(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([ENTRIES, STATUSES], "readwrite");
      tx.objectStore(ENTRIES).clear();
      tx.objectStore(STATUSES).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    warnOnce("clear session", error);
  }
}
