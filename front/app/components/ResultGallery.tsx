import React, { useState, useEffect, useMemo, useRef } from "react";
import { Icon } from "@iconify/react";
import type { FinishedImage } from "@/types";
import { downloadBlob } from "@/utils/download";
import { getTranslatorName } from "@/utils/getTranslatorName";
import {
  saveResultsToDisk,
  downloadResultsSequentially,
  supportsDirectoryPicker,
  type SaveProgressCallback,
} from "@/utils/saveToDisk";

interface ResultGalleryProps {
  finishedImages: FinishedImage[];
  onClearGallery: () => void;
}

/** 把 Blob 渲染成 <img>,挂载时创建 objectURL、卸载时释放,避免泄漏。 */
const BlobImage = React.memo(
  ({
    blob,
    alt,
    className,
  }: {
    blob: Blob;
    alt: string;
    className?: string;
  }) => {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }, [blob]);
    return <img src={url ?? undefined} alt={alt} className={className} />;
  }
);

export const ResultGallery: React.FC<ResultGalleryProps> = ({
  finishedImages,
  onClearGallery,
}) => {
  const [selectedImage, setSelectedImage] = useState<FinishedImage | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<{
    phase: "idle" | "picking" | "saving" | "downloading" | "done" | "error";
    done: number;
    total: number;
    current?: string;
    message?: string;
  }>({ phase: "idle", done: 0, total: 0 });
  const saveMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgressAt = useRef(0);

  // 同一文件重复翻译时只保留最新结果(数组是最新在前),
  // 否则保存时同名文件被重复写入,进度计数与磁盘上实际文件数对不上
  const uniqueImages = useMemo(() => {
    const seen = new Set<string>();
    return finishedImages.filter((img) => {
      if (seen.has(img.originalName)) return false;
      seen.add(img.originalName);
      return true;
    });
  }, [finishedImages]);

  const saveProgressCb: SaveProgressCallback = (done, total, current) => {
    // 小图写入很快,节流到 ~80ms 一次防止刷爆渲染;done===total 强制刷新,
    // 保证结束时进度条一定停在 100%
    const now = Date.now();
    if (now - lastProgressAt.current < 80 && done < total) return;
    lastProgressAt.current = now;
    setSaveState((s) => ({
      ...s,
      phase: s.phase === "picking" ? "saving" : s.phase,
      done,
      total,
      current,
    }));
  };

  /** 保存到磁盘:写入源文件夹同级目录,文件名加 _translated 后缀 */
  const handleSaveToDisk = async () => {
    if (saving || uniqueImages.length === 0) return;
    if (saveMsgTimer.current) {
      clearTimeout(saveMsgTimer.current);
      saveMsgTimer.current = null;
    }
    setSaving(true);
    lastProgressAt.current = 0;
    setSaveState({ phase: "picking", done: 0, total: uniqueImages.length });
    try {
      const res = await saveResultsToDisk(uniqueImages, saveProgressCb);
      if (res === "saved") {
        setSaveState({
          phase: "done",
          done: uniqueImages.length,
          total: uniqueImages.length,
          message: `已保存 ${uniqueImages.length} 张到所选目录`,
        });
      } else if (res === "fallback") {
        setSaveState({ phase: "downloading", done: 0, total: uniqueImages.length });
        await downloadResultsSequentially(uniqueImages, saveProgressCb);
        setSaveState({
          phase: "done",
          done: uniqueImages.length,
          total: uniqueImages.length,
          message: `已逐张下载 ${uniqueImages.length} 张(浏览器不支持目录选择)`,
        });
      } else {
        setSaveState({ phase: "idle", done: 0, total: 0 }); // 用户取消
      }
    } catch (err) {
      console.error(err);
      setSaveState({
        phase: "error",
        done: 0,
        total: 0,
        message: "保存失败:" + (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setSaving(false);
      saveMsgTimer.current = setTimeout(
        () => setSaveState({ phase: "idle", done: 0, total: 0 }),
        6000
      );
    }
  };

  const savePhase = saveState.phase;
  const savePct =
    saveState.total > 0
      ? Math.round((saveState.done / saveState.total) * 100)
      : 0;

  /** 打包下载全部结果(ZIP,保留文件夹结构) */
  const handleDownloadAllZip = async () => {
    if (zipping || uniqueImages.length === 0) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const image of uniqueImages) {
        zip.file(`translated/${image.originalName}`, image.result);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "translated-results.zip");
    } finally {
      setZipping(false);
    }
  };

  const openImageModal = (image: FinishedImage) => {
    setSelectedImage(image);
    setIsModalOpen(true);
  };

  const closeImageModal = () => {
    setIsModalOpen(false);
    setSelectedImage(null);
  };

  const navigateImage = (direction: "prev" | "next") => {
    if (!selectedImage) return;

    const currentIndex = uniqueImages.findIndex(
      (img) => img.id === selectedImage.id
    );
    if (currentIndex === -1) return;

    let newIndex: number;
    if (direction === "prev") {
      newIndex =
        currentIndex === 0 ? uniqueImages.length - 1 : currentIndex - 1;
    } else {
      newIndex =
        currentIndex === uniqueImages.length - 1 ? 0 : currentIndex + 1;
    }

    setSelectedImage(uniqueImages[newIndex]);
  };

  // 键盘导航(挂在 window 上,无需手动聚焦)
  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          closeImageModal();
          break;
        case "ArrowLeft":
          navigateImage("prev");
          break;
        case "ArrowRight":
          navigateImage("next");
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // 组件卸载时清掉保存提示的定时器,避免卸载后 setState
  useEffect(() => {
    return () => {
      if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
    };
  }, []);

  const handleClearGallery = () => {
    if (
      window.confirm(`确定要清空全部 ${uniqueImages.length} 张翻译结果吗?`)
    ) {
      onClearGallery();
    }
  };

  if (uniqueImages.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Icon
          icon="carbon:image"
          className="w-12 h-12 mx-auto mb-4 text-gray-300"
        />
        <p>还没有翻译结果</p>
        <p className="text-sm">翻译完成的图片会显示在这里</p>
      </div>
    );
  }

  return (
    <>
      {/* Gallery Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-6">
        <h3 className="text-lg font-semibold text-gray-800">
          翻译结果({uniqueImages.length})
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {(savePhase === "picking" ||
            savePhase === "saving" ||
            savePhase === "downloading") && (
            <div className="flex items-center gap-2 min-w-0">
              {savePhase === "picking" ? (
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  请在弹出的窗口中选择保存目录…
                </span>
              ) : (
                <>
                  <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-150 ${
                        savePhase === "downloading"
                          ? "bg-blue-500"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${savePct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 tabular-nums whitespace-nowrap">
                    {savePhase === "downloading" ? "下载" : "保存"}{" "}
                    {saveState.done}/{saveState.total}({savePct}%)
                  </span>
                  {saveState.current && (
                    <span
                      className="text-xs text-gray-400 max-w-[160px] truncate"
                      title={saveState.current}
                    >
                      {saveState.current}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {saveState.message && (
            <span
              className={`text-xs ${
                savePhase === "error" ? "text-red-600" : "text-green-600"
              }`}
            >
              {saveState.message}
            </span>
          )}
          <button
            onClick={handleSaveToDisk}
            disabled={saving}
            title={
              supportsDirectoryPicker()
                ? "选择源文件夹所在目录,译文将写入同级 <文件夹名>_translated 子文件夹,文件名加 _translated 后缀"
                : "当前浏览器不支持目录选择,将逐张下载到下载目录(文件名带 _translated 后缀);建议使用 Chrome/Edge"
            }
            className="px-3 py-1 text-sm text-green-700 hover:text-green-800 hover:bg-green-50 rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存到磁盘"}
          </button>
          <button
            onClick={handleDownloadAllZip}
            disabled={zipping}
            className="px-3 py-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
          >
            {zipping ? "正在打包…" : "打包下载 ZIP"}
          </button>
          <button
            onClick={handleClearGallery}
            className="px-3 py-1 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
          >
            全部清空
          </button>
        </div>
      </div>

      {/* Image Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {uniqueImages.map((image) => (
          <div
            key={image.id}
            className="group cursor-pointer bg-white rounded-lg border hover:border-blue-400 hover:shadow-md transition-all duration-200"
            onClick={() => openImageModal(image)}
          >
            {/* 缩略图用自然比例:整页可见。之前的正方形+object-cover 会把竖版
                漫画页裁成中间一块,深色页面看起来像黑色小方块 */}
            <div className="relative overflow-hidden rounded-t-lg bg-gray-100">
              <BlobImage
                blob={image.result}
                alt={`翻译结果:${image.originalName}`}
                className="w-full h-auto block group-hover:scale-105 transition-transform duration-200"
              />
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center">
                <Icon
                  icon="carbon:view"
                  className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                />
              </div>
            </div>
            <div className="p-2">
              <div
                className="text-xs text-gray-600 truncate"
                title={image.originalName}
              >
                {image.originalName}
              </div>
              <div className="text-xs text-gray-400">
                {image.finishedAt.toLocaleDateString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Image Modal */}
      {isModalOpen && selectedImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={closeImageModal}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Navigation Arrows */}
            <button
              onClick={() => navigateImage("prev")}
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-all z-10"
            >
              <Icon icon="carbon:chevron-left" className="w-6 h-6" />
            </button>

            <button
              onClick={() => navigateImage("next")}
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-all z-10"
            >
              <Icon icon="carbon:chevron-right" className="w-6 h-6" />
            </button>

            {/* Close Button */}
            <button
              onClick={closeImageModal}
              className="absolute top-4 right-4 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-all z-10"
            >
              <Icon icon="carbon:close" className="w-6 h-6" />
            </button>

            {/* Download Button */}
            <button
              onClick={() =>
                downloadBlob(
                  selectedImage.result,
                  `translated-${selectedImage.originalName}`
                )
              }
              title="下载图片"
              className="absolute top-4 right-16 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-all z-10"
            >
              <Icon icon="carbon:download" className="w-6 h-6" />
            </button>

            {/* Image */}
            <BlobImage
              blob={selectedImage.result}
              alt={`翻译结果:${selectedImage.originalName}`}
              className="max-w-full max-h-[85vh] object-contain"
            />

            {/* Image Info */}
            <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-50 text-white p-3 rounded-lg">
              <div className="text-sm font-medium">
                {selectedImage.originalName}
              </div>
              <div className="text-xs text-gray-300">
                完成时间:{selectedImage.finishedAt.toLocaleString()}
              </div>
              <div className="text-xs text-gray-300">
                翻译引擎:{getTranslatorName(selectedImage.settings.translator)}
              </div>
            </div>

            {/* Navigation Hint */}
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black bg-opacity-50 text-white px-3 py-1 rounded-full text-xs whitespace-nowrap">
              使用 ← → 方向键切换,Esc 关闭
            </div>
          </div>
        </div>
      )}
    </>
  );
};
