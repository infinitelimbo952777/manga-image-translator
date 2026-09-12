import { imageMimeTypes } from "@/config";

export interface PickedFile {
  file: File;
  /** 相对路径(含文件名);文件夹批处理时形如 "漫画/第1话/p001.png" */
  relativePath: string;
}

const IMAGE_EXT = /\.(png|jpe?g|bmp|webp)$/i;

const isImage = (f: File) =>
  imageMimeTypes.includes(f.type) || IMAGE_EXT.test(f.name);

/** 普通文件选择/文件夹选择(webkitdirectory)的结果转成带相对路径的列表 */
export function toPickedFiles(list: FileList | File[]): PickedFile[] {
  return Array.from(list)
    .filter(isImage)
    .map((f) => ({ file: f, relativePath: f.webkitRelativePath || f.name }));
}

/** 拖拽落下的内容转成文件列表;支持直接拖入文件夹(递归遍历) */
export async function filesFromDataTransfer(
  dt: DataTransfer
): Promise<PickedFile[]> {
  const entries = Array.from(dt.items || [])
    .map((item) =>
      typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null
    )
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 0) {
    return toPickedFiles(dt.files || []);
  }

  const out: PickedFile[] = [];
  for (const entry of entries) {
    await walkEntry(entry, "", out);
  }
  return out;
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: PickedFile[]
): Promise<void> {
  if (entry.isFile) {
    const file = await entryToFile(entry as FileSystemFileEntry);
    if (file && isImage(file)) {
      out.push({ file, relativePath: prefix + file.name });
    }
    return;
  }
  if (entry.isDirectory) {
    const dir = entry as FileSystemDirectoryEntry;
    const children = await readAllEntries(dir.createReader());
    for (const child of children) {
      await walkEntry(child, `${prefix}${dir.name}/`, out);
    }
  }
}

function entryToFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (f) => resolve(f),
      () => resolve(null)
    );
  });
}

/** readEntries 每次最多返回 100 条,必须循环读到空为止 */
function readAllEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
          } else {
            all.push(...batch);
            readBatch();
          }
        },
        (err) => reject(err)
      );
    };
    readBatch();
  });
}
