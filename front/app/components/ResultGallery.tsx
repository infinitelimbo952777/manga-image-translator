import React, { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import type { FinishedImage } from "@/types";
import { downloadBlob } from "@/utils/download";
import { getTranslatorName } from "@/utils/getTranslatorName";
import {
  saveResultsToDisk,
  downloadResultsSequentially,
  supportsDirectoryPicker,
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
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  /** 保存到磁盘:写入源文件夹同级目录,文件名加 _translated 后缀 */
  const handleSaveToDisk = async () => {
    if (saving || finishedImages.length === 0) return;
    setSaving(true);
    setSaveMsg("正在保存…");
    try {
      const res = await saveResultsToDisk(finishedImages, (done, total) =>
        setSaveMsg(`正在保存 ${done}/${total}…`)
      );
      if (res === "saved") {
        setSaveMsg("已保存到所选目录");
      } else if (res === "fallback") {
        await downloadResultsSequentially(finishedImages, (done, total) =>
          setSaveMsg(`正在下载 ${done}/${total}…`)
        );
        setSaveMsg("浏览器不支持目录选择,已逐张下载");
      } else {
        setSaveMsg(null); // 用户取消
      }
    } catch (err) {
      console.error(err);
      setSaveMsg("保存失败:" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 5000);
    }
  };

  /** 打包下载全部结果(ZIP,保留文件夹结构) */
  const handleDownloadAllZip = async () => {
    if (zipping || finishedImages.length === 0) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const image of finishedImages) {
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

    const currentIndex = finishedImages.findIndex(
      (img) => img.id === selectedImage.id
    );
    if (currentIndex === -1) return;

    let newIndex: number;
    if (direction === "prev") {
      newIndex =
        currentIndex === 0 ? finishedImages.length - 1 : currentIndex - 1;
    } else {
      newIndex =
        currentIndex === finishedImages.length - 1 ? 0 : currentIndex + 1;
    }

    setSelectedImage(finishedImages[newIndex]);
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

  const handleClearGallery = () => {
    if (
      window.confirm(`确定要清空全部 ${finishedImages.length} 张翻译结果吗?`)
    ) {
      onClearGallery();
    }
  };

  if (finishedImages.length === 0) {
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
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-800">
          翻译结果({finishedImages.length})
        </h3>
        <div className="flex items-center gap-2">
          {saveMsg && (
            <span className="text-xs text-gray-500">{saveMsg}</span>
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
        {finishedImages.map((image) => (
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
