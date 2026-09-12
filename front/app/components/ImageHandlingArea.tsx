import React, { useState, useEffect, useMemo } from "react";
import { Icon } from "@iconify/react";
import { fetchStatusText } from "@/utils/fetchStatusText";
import { downloadBlob } from "@/utils/download";
import {
  toPickedFiles,
  filesFromDataTransfer,
  type PickedFile,
} from "@/utils/files";
import { processingStatuses, type FileEntry, type FileStatus } from "@/types";

export interface ImageHandlingAreaProps {
  entries: FileEntry[];
  fileStatuses: Map<string, FileStatus>;
  isProcessing: boolean;
  isProcessingAllFinished: boolean;

  addPickedFiles: (picked: PickedFile[]) => void;
  removeEntry: (id: string) => void;
  /** 不传 ids = 翻译全部;传 ids = 只翻译选中的(文件夹视图用) */
  handleSubmit: (ids?: string[]) => void;
  clearForm: () => void;
}

/** 相对路径的顶层目录名;散图返回 "" */
const rootOf = (relativePath: string): string =>
  relativePath.includes("/")
    ? relativePath.slice(0, relativePath.indexOf("/"))
    : "";

/** 小缩略图:挂载时创建 objectURL、卸载时释放;懒加载,避免大批量时卡顿 */
const Thumb = React.memo(({ blob, alt }: { blob: Blob; alt: string }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return (
    <img
      src={url ?? undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="w-full h-full object-cover"
    />
  );
});

/** 详情弹窗里的大图:有结果时默认显示译文,可切换查看原图 */
const DetailImage = React.memo(
  ({ entry, result }: { entry: FileEntry; result: Blob | null }) => {
    const [showOriginal, setShowOriginal] = useState(false);
    const displayBlob: Blob = showOriginal || !result ? entry.file : result;
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
      const objectUrl = URL.createObjectURL(displayBlob);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }, [displayBlob]);
    return (
      <div className="relative">
        <img
          src={url ?? undefined}
          alt={entry.relativePath}
          className="max-w-full max-h-[70vh] object-contain rounded"
        />
        {result && (
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="absolute bottom-2 right-2 px-3 py-1 text-sm bg-black/60 text-white rounded-md hover:bg-black/80 transition-colors"
          >
            {showOriginal ? "查看译文" : "查看原图"}
          </button>
        )}
      </div>
    );
  }
);

/** 文件夹卡片上的聚合进度 */
const FolderCard: React.FC<{
  name: string;
  count: number;
  done: number;
  failed: number;
  running: boolean;
  allFinished: boolean;
  canTranslate: boolean;
  onOpen: () => void;
  onTranslate: () => void;
}> = ({ name, count, done, failed, running, allFinished, canTranslate, onOpen, onTranslate }) => {
  const pct = Math.round((done / Math.max(count, 1)) * 100);
  return (
    <div
      className="relative group cursor-pointer bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all p-4"
      onDoubleClick={onOpen}
      title="双击进入文件夹"
    >
      <div className="flex items-center gap-3">
        <Icon
          icon={name ? "carbon:folder" : "carbon:image"}
          className="w-10 h-10 text-blue-500 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-800 truncate" title={name}>
            {name || "散装图片"}
          </div>
          <div className="text-xs text-gray-500">{count} 张</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onTranslate}
            disabled={!canTranslate || running}
            title="直接翻译此文件夹"
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? "翻译中…" : "翻译"}
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-md shrink-0"
          >
            打开
          </button>
        </div>
      </div>
      {/* 聚合进度:仅汇总,不展示单张 */}
      <div className="mt-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>
            {running ? (
              <span className="text-blue-600">翻译中…</span>
            ) : allFinished ? (
              failed > 0 ? (
                <span className="text-orange-500">完成({failed} 失败)</span>
              ) : (
                <span className="text-green-600">已完成</span>
              )
            ) : (
              "未开始"
            )}
            {failed > 0 && !allFinished && (
              <span className="text-red-500 ml-1">{failed} 失败</span>
            )}
          </span>
          <span>
            {done}/{count}
          </span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              allFinished
                ? failed > 0
                  ? "bg-orange-400"
                  : "bg-green-500"
                : "bg-blue-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * 文件/文件夹上传、文件夹导航(双击进入)、缩略图列表、详情弹窗与翻译开始按钮
 */
export const ImageHandlingArea: React.FC<ImageHandlingAreaProps> = ({
  entries,
  fileStatuses,
  isProcessing,
  isProcessingAllFinished,
  addPickedFiles,
  removeEntry,
  handleSubmit,
  clearForm,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // null = 文件夹总览;"" = 散装图片;其他 = 顶层文件夹名
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  /** 按顶层目录分组 */
  const groups = useMemo(() => {
    const m = new Map<string, FileEntry[]>();
    for (const e of entries) {
      const k = rootOf(e.relativePath);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [entries]);

  const hasFolders = useMemo(
    () => Array.from(groups.keys()).some((k) => k !== ""),
    [groups]
  );
  // 只有散图时不需要文件夹导航,直接平铺
  const showOverview = hasFolders && activeFolder === null;
  const activeEntries =
    activeFolder !== null ? groups.get(activeFolder) ?? [] : entries;

  // 分组变化时兜底:当前文件夹被清空/清空表单后退回总览
  useEffect(() => {
    if (activeFolder !== null && !groups.has(activeFolder)) {
      setActiveFolder(null);
    }
    if (entries.length === 0) {
      setActiveFolder(null);
      setSelectedId(null);
    }
  }, [groups, entries.length, activeFolder]);

  const total = entries.length;
  const finishedCount = entries.filter(
    (e) => fileStatuses.get(e.id)?.status === "finished"
  ).length;
  const failedCount = entries.filter((e) => fileStatuses.get(e.id)?.error)
    .length;
  const doneCount = finishedCount + failedCount;

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;
  const selectedStatus = selectedEntry
    ? fileStatuses.get(selectedEntry.id) ?? null
    : null;

  const navigateSelected = (direction: "prev" | "next") => {
    if (!selectedId || activeEntries.length === 0) return;
    const index = activeEntries.findIndex((e) => e.id === selectedId);
    if (index === -1) return;
    const next =
      direction === "prev"
        ? index === 0
          ? activeEntries.length - 1
          : index - 1
        : index === activeEntries.length - 1
        ? 0
        : index + 1;
    setSelectedId(activeEntries[next].id);
  };

  // 键盘导航(挂在 window 上,无需手动聚焦)
  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          setSelectedId(null);
          break;
        case "ArrowLeft":
          navigateSelected("prev");
          break;
        case "ArrowRight":
          navigateSelected("next");
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    addPickedFiles(await filesFromDataTransfer(e.dataTransfer));
  };

  /** 单张缩略图卡片(文件夹视图内使用);状态用底部细条,不再全卡片黑遮罩 */
  const renderEntryCard = (entry: FileEntry) => {
    const status = fileStatuses.get(entry.id);
    const dir = entry.relativePath.includes("/")
      ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/"))
      : "";
    const base = entry.relativePath.split("/").pop() ?? entry.relativePath;
    const isProcessingEntry =
      status?.status !== null &&
      status?.status !== undefined &&
      status.status !== "finished";
    return (
      <div key={entry.id} className="min-w-0">
        <div
          className="relative w-full aspect-square rounded-lg border border-gray-200 overflow-hidden bg-gray-100 group cursor-pointer hover:border-blue-400 hover:shadow transition-all"
          onClick={() => setSelectedId(entry.id)}
          title={entry.relativePath}
        >
          <Thumb blob={entry.file} alt={entry.relativePath} />

          {/* 处理中:底部细条状态,不再遮住整张缩略图 */}
          {isProcessingEntry && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
              <div className="text-white text-[10px] leading-tight text-center truncate">
                {fetchStatusText(
                  status?.status ?? null,
                  status?.progress ?? null,
                  status?.queuePos ?? null,
                  status?.error ?? null
                )}
              </div>
            </div>
          )}

          {/* 完成角标 */}
          {status?.status === "finished" && (
            <div className="absolute bottom-1 right-1 w-5 h-5 bg-green-500 text-white rounded-full flex items-center justify-center">
              <Icon icon="carbon:checkmark" className="w-3.5 h-3.5" />
            </div>
          )}
          {/* 失败角标 */}
          {status?.error && (
            <div className="absolute bottom-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center">
              <Icon icon="carbon:warning" className="w-3.5 h-3.5" />
            </div>
          )}

          {/* 删除按钮(悬停显示) */}
          {!isProcessing && !isProcessingAllFinished && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeEntry(entry.id);
              }}
              title="移除"
              className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
            >
              <Icon icon="carbon:close" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div
          className="mt-1 text-xs text-gray-700 truncate text-center"
          title={entry.relativePath}
        >
          {dir && <span className="text-gray-400">{dir}/</span>}
          {base}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 max-w-[1200px] mx-auto">
      {!isProcessing && !isProcessingAllFinished && (
        <div
          className={`block p-4 border-2 border-dashed rounded-lg transition-colors ${
            isDragOver
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 hover:border-blue-400"
          }`}
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragOver(false);
          }}
        >
          <div className="text-center p-6">
            <Icon
              icon="carbon:cloud-upload"
              className="w-8 h-8 mx-auto text-gray-500"
            />
            <div className="mt-2 text-gray-600">
              拖拽图片或整个文件夹到此处(可多选)
            </div>
            <div className="mt-1 text-xs text-gray-400">
              支持 PNG / JPG / WebP / BMP,也可以直接 Ctrl+V 粘贴截图
            </div>
            <div className="mt-4 flex justify-center gap-3">
              <label
                htmlFor="file"
                className="cursor-pointer px-4 py-2 text-sm border border-gray-300 rounded-md hover:border-blue-400 hover:text-blue-600 transition-colors"
              >
                选择文件
              </label>
              <label
                htmlFor="folder"
                className="cursor-pointer px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                选择文件夹
              </label>
            </div>
          </div>
          <input
            id="file"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/bmp,image/webp"
            className="hidden"
            onChange={(e) => {
              addPickedFiles(toPickedFiles(e.target.files || []));
              e.target.value = "";
            }}
          />
          <input
            id="folder"
            type="file"
            multiple
            className="hidden"
            ref={(el) => {
              if (el) el.setAttribute("webkitdirectory", "");
            }}
            onChange={(e) => {
              addPickedFiles(toPickedFiles(e.target.files || []));
              e.target.value = "";
            }}
          />
        </div>
      )}
      {/* 总体进度:总览/文件夹视图都只显示汇总 */}
      {entries.length > 0 && (isProcessing || isProcessingAllFinished) && (
        <div className="px-2">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>
              总进度:{doneCount}/{total}
              {failedCount > 0 && (
                <span className="text-red-500 ml-2">失败 {failedCount}</span>
              )}
            </span>
            <span>{Math.round((doneCount / Math.max(total, 1)) * 100)}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${(doneCount / Math.max(total, 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* ===== 文件夹总览:只显示文件夹卡片,双击进入 ===== */}
      {showOverview && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from(groups.entries()).map(([name, list]) => {
            const done = list.filter((e) => {
              const s = fileStatuses.get(e.id);
              return s?.status === "finished" || s?.error;
            }).length;
            const failed = list.filter((e) => fileStatuses.get(e.id)?.error)
              .length;
            const running = list.some((e) => {
              const s = fileStatuses.get(e.id);
              return !!s?.status && processingStatuses.includes(s.status);
            });
            const allFinished = list.every((e) => {
              const s = fileStatuses.get(e.id);
              return s?.status === "finished" || s?.error;
            });
            return (
              <FolderCard
                key={name}
                name={name}
                count={list.length}
                done={done}
                failed={failed}
                running={running}
                allFinished={allFinished}
                canTranslate={!isProcessing && !isProcessingAllFinished}
                onOpen={() => setActiveFolder(name)}
                onTranslate={() => handleSubmit(list.map((e) => e.id))}
              />
            );
          })}
        </div>
      )}

      {/* ===== 文件夹视图:该文件夹内的缩略图 ===== */}
      {!showOverview && activeFolder !== null && (
        <div className="flex items-center gap-3 px-2">
          <button
            type="button"
            onClick={() => setActiveFolder(null)}
            className="flex items-center px-3 py-1.5 text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
          >
            <Icon icon="carbon:arrow-left" className="w-4 h-4 mr-1" />
            返回文件夹列表
          </button>
          <span
            className="text-sm font-medium text-gray-800 truncate"
            title={activeFolder}
          >
            {activeFolder || "散装图片"}({activeEntries.length} 张)
          </span>
          {!isProcessing && !isProcessingAllFinished && (
            <button
              type="button"
              onClick={() => handleSubmit(activeEntries.map((e) => e.id))}
              className="ml-auto px-3 py-1.5 text-sm border border-blue-500 text-blue-600 hover:bg-blue-50 rounded-md transition-colors shrink-0"
            >
              只翻译此文件夹
            </button>
          )}
        </div>
      )}

      {/* Thumbnail grid */}
      {entries.length > 0 && !showOverview && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {activeEntries.map(renderEntryCard)}
          </div>

          {/* Submit button */}
          {!isProcessing && !isProcessingAllFinished && (
            <button
              type="button"
              className="w-full mt-6 py-4 px-6 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-lg"
              disabled={entries.length === 0}
              onClick={() => handleSubmit()}
            >
              {hasFolders && activeFolder !== null
                ? `开始翻译(全部 ${entries.length} 张)`
                : `开始翻译(${entries.length} 张)`}
            </button>
          )}
          {isProcessingAllFinished && (
            <button
              onClick={clearForm}
              className="w-full mt-6 py-4 px-6 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-lg"
            >
              清空,重新开始
            </button>
          )}
        </>
      )}

      {/* Detail modal */}
      {selectedEntry && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="bg-white rounded-lg max-w-[90vw] max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-gray-200">
              <div
                className="text-sm text-gray-700 truncate"
                title={selectedEntry.relativePath}
              >
                {selectedEntry.relativePath}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedStatus?.status === "finished" &&
                  selectedStatus.result && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadBlob(
                          selectedStatus.result as Blob,
                          `translated-${
                            selectedEntry.relativePath.split("/").pop() ??
                            selectedEntry.relativePath
                          }`
                        )
                      }
                      className="flex items-center px-2 py-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                    >
                      <Icon icon="carbon:download" className="w-4 h-4 mr-1" />
                      下载
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                >
                  <Icon icon="carbon:close" className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="relative flex-1 flex items-center justify-center p-4 overflow-auto">
              <DetailImage
                key={selectedEntry.id}
                entry={selectedEntry}
                result={selectedStatus?.result ?? null}
              />

              {/* Navigation arrows */}
              {activeEntries.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => navigateSelected("prev")}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-all"
                  >
                    <Icon icon="carbon:chevron-left" className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateSelected("next")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-all"
                  >
                    <Icon icon="carbon:chevron-right" className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {/* Status bar */}
            {selectedStatus && selectedStatus.status !== "finished" && (
              <div
                className={`px-4 py-2 text-sm text-center rounded-b-lg ${
                  selectedStatus.error
                    ? "bg-red-50 text-red-600"
                    : "bg-gray-50 text-gray-600"
                }`}
              >
                {fetchStatusText(
                  selectedStatus.status,
                  selectedStatus.progress,
                  selectedStatus.queuePos,
                  selectedStatus.error
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
