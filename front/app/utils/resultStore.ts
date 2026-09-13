import type { FinishedImage } from "@/types";

/**
 * 翻译结果持久化(IndexedDB)。
 *
 * 结果图是 Blob,localStorage 存不了(旧版曾 JSON.stringify 进去,Blob 变成
 * 空对象,刷新后画廊崩溃——见 localStorage.ts 的 clearLegacyFinishedImages)。
 * IndexedDB 原生支持 Blob 且配额远大于 localStorage,按 originalName 作为
 * 主键逐条写入:重新翻译同一文件时新结果直接覆盖旧记录。
 *
 * 所有操作失败(浏览器不支持/隐私模式/配额不足)只降级为"不持久化",
 * 不影响本次会话内的正常使用。
 */

const DB_NAME = "manga-translator-results";
const DB_VERSION = 1;
const STORE = "results";

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
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE); // key = originalName
        }
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
  console.warn(`resultStore: ${scene} failed, results will not persist this session:`, error);
}

/** 刷新后恢复画廊;按完成时间倒序,与内存中的插入顺序一致 */
export async function loadSavedResults(): Promise<FinishedImage[]> {
  try {
    const db = await openDB();
    const records = await new Promise<FinishedImage[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    return records
      .map((r) => ({ ...r, finishedAt: new Date(r.finishedAt) }))
      .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
  } catch (error) {
    warnOnce("load", error);
    return [];
  }
}

/** 单条写入(翻译完成时调用);重新翻译同一文件自动覆盖旧记录 */
export async function saveResult(image: FinishedImage): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(image, image.originalName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    warnOnce("save", error);
  }
}

export async function clearSavedResults(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    warnOnce("clear", error);
  }
}
