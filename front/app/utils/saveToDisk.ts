import type { FinishedImage } from "@/types";
import { downloadBlob } from "@/utils/download";

/* eslint-disable @typescript-eslint/no-explicit-any */
// File System Access API 的类型不在标准 lib.dom 里,统一用 any 处理

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp)$/i;

/** 03_002.webp -> 03_002_translated.png(统一存成 PNG,与后端输出一致) */
export const translatedFileName = (originalName: string): string => {
  const base = originalName.split("/").pop() ?? originalName;
  const noExt = base.replace(IMAGE_EXT_RE, "");
  return `${noExt}_translated.png`;
};

export const supportsDirectoryPicker = (): boolean =>
  typeof (window as any).showDirectoryPicker === "function";

async function ensureDir(dir: any, name: string): Promise<any> {
  return dir.getDirectoryHandle(name, { create: true });
}

/** (已完成数, 总数, 当前文件名) */
export type SaveProgressCallback = (done: number, total: number, current?: string) => void;

/**
 * 把翻译结果写到磁盘:
 *  - 弹出目录选择器,用户选择"源文件夹所在目录"即可 —— 译文会写入同级的
 *    `<源文件夹名>_translated` 子文件夹(散图则写入 `translated`),内部目录结构保持不变
 *  - 文件名统一加 `_translated` 后缀,便于区分译文版本
 * 返回 "saved" | "cancelled" | "fallback"(浏览器不支持目录选择器)
 */
export async function saveResultsToDisk(
  images: FinishedImage[],
  onProgress?: SaveProgressCallback
): Promise<"saved" | "cancelled" | "fallback"> {
  if (!supportsDirectoryPicker()) return "fallback";

  let root: any;
  try {
    root = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return "cancelled"; // 用户取消(Esc/关闭)或无权限
  }
  try {
    // 旧版 Chrome 需要手动申请写权限
    if (root.queryPermission) {
      const opts = { mode: "readwrite" };
      if ((await root.queryPermission(opts)) !== "granted") {
        if ((await root.requestPermission(opts)) !== "granted") return "cancelled";
      }
    }

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const segs = image.originalName.split("/");
      const hasFolder = segs.length > 1;
      let dir = root;
      if (hasFolder) {
        // 源文件夹的同级: 所选目录/<源文件夹名>_translated/
        dir = await ensureDir(dir, `${segs[0]}_translated`);
      } else {
        dir = await ensureDir(dir, "translated");
      }
      const inner = hasFolder ? segs.slice(1) : segs;
      for (let j = 0; j < inner.length - 1; j++) {
        dir = await ensureDir(dir, inner[j]);
      }
      const fileHandle = await dir.getFileHandle(translatedFileName(image.originalName), {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(image.result);
      await writable.close();
      onProgress?.(i + 1, images.length, translatedFileName(image.originalName));
    }
    return "saved";
  } catch (err) {
    console.error("saveResultsToDisk failed:", err);
    throw err;
  }
}

/** 浏览器不支持目录选择器时,退化为逐张下载(文件名同样加后缀) */
export async function downloadResultsSequentially(
  images: FinishedImage[],
  onProgress?: SaveProgressCallback
): Promise<void> {
  for (let i = 0; i < images.length; i++) {
    const name = translatedFileName(images[i].originalName);
    downloadBlob(images[i].result, name);
    onProgress?.(i + 1, images.length, name);
    // 间隔一点,避免浏览器拦截连续多文件下载
    await new Promise((r) => setTimeout(r, 300));
  }
}
