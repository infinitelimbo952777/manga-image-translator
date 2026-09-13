import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  type StatusKey,
  processingStatuses,
  type TranslatorKey,
  type FileStatus,
  type ChunkProcessingResult,
  type FileEntry,
  type TranslationSettings,
  type FinishedImage,
} from "@/types";
import { OptionsPanel } from "@/components/OptionsPanel";
import { ImageHandlingArea } from "@/components/ImageHandlingArea";
import { ResultGallery } from "@/components/ResultGallery";
import { Header } from "@/components/Header";
import { loadSettings, saveSettings, clearLegacyFinishedImages } from "@/utils/localStorage";
import {
  loadSavedResults,
  saveResult,
  clearSavedResults,
  loadSavedEntries,
  saveEntries,
  loadSavedStatuses,
  saveStatuses,
  clearSavedSession,
} from "@/utils/resultStore";
import { toPickedFiles, type PickedFile } from "@/utils/files";

// 批量翻译默认并发数(web 模式没有 --batch-size,这是它的等价物;
// worker 端每个请求是独立 asyncio task,GPU 算子仍会串行排队)
const DEFAULT_CONCURRENCY = 4;

export const App: React.FC = () => {
  // State Hooks
  const [fileStatuses, setFileStatuses] = useState<Map<string, FileStatus>>(
    new Map()
  );
  const [shouldTranslate, setShouldTranslate] = useState(false);
  // 本次要翻译的 entry id;null = 全部
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);

  // 翻译结果画廊(IndexedDB 持久化,刷新页面自动恢复)
  const [finishedImages, setFinishedImages] = useState<FinishedImage[]>([]);

  // Translation Options State Hooks
  // 默认值以 start.txt 的 config.json 为基线;检测器实测 CTD 对竖排日文明显更好
  const [detectionResolution, setDetectionResolution] = useState("1536");
  const [textDetector, setTextDetector] = useState("ctd");
  const [renderTextDirection, setRenderTextDirection] = useState("auto");
  // 默认值与 start.txt 所用 ./config.json 保持一致
  const [translator, setTranslator] = useState<TranslatorKey>("custom_openai");
  const [targetLanguage, setTargetLanguage] = useState("CHS");

  const [inpaintingSize, setInpaintingSize] = useState("1536");
  const [customUnclipRatio, setCustomUnclipRatio] = useState<number>(2.3);
  const [customBoxThreshold, setCustomBoxThreshold] = useState<number>(0.7);
  const [maskDilationOffset, setMaskDilationOffset] = useState<number>(20);
  const [inpainter, setInpainter] = useState("lama_large");

  // 检测/OCR 增强选项(竖排日文:detAutoRotate 默认开启)
  // OCR 默认 MangaOCR:实测对竖排日文覆盖更好(48px 会丢低置信度行),稳态仅慢约 35%
  const [ocrModel, setOcrModel] = useState("hayai");
  const [detRotate, setDetRotate] = useState(false);
  const [detAutoRotate, setDetAutoRotate] = useState(true);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  // 渲染字号偏移:该字体竖排步进/墨迹偏小,+3 约等于原漫画字号
  const [fontOffset, setFontOffset] = useState(3);

  // Computed State (useMemo)
  const isProcessing = useMemo(() => {
    // If there are no entries or no statuses, we're not processing
    if (entries.length === 0 || fileStatuses.size === 0) return false;

    // Check if any file has a processing status
    return Array.from(fileStatuses.values()).some((fileStatus) => {
      if (!fileStatus || fileStatus.status === null) return false;
      return processingStatuses.includes(fileStatus.status);
    });
  }, [entries, fileStatuses]);

  const isProcessingAllFinished = useMemo(() => {
    if (entries.length === 0 || fileStatuses.size === 0) return false;

    // Check if all files are finished
    return Array.from(fileStatuses.values()).every((status) => {
      if (!status || status.status === null) return false;
      return status.status === "finished";
    });
  }, [entries, fileStatuses]);

  // Effects
  /** Load saved settings from localStorage */
  useEffect(() => {
    const savedSettings = loadSettings();
    if (savedSettings.detectionResolution) setDetectionResolution(savedSettings.detectionResolution);
    if (savedSettings.textDetector) setTextDetector(savedSettings.textDetector);
    if (savedSettings.renderTextDirection) setRenderTextDirection(savedSettings.renderTextDirection);
    if (savedSettings.translator) setTranslator(savedSettings.translator);
    if (savedSettings.targetLanguage) setTargetLanguage(savedSettings.targetLanguage);
    if (savedSettings.inpaintingSize) setInpaintingSize(savedSettings.inpaintingSize);
    if (savedSettings.customUnclipRatio) setCustomUnclipRatio(savedSettings.customUnclipRatio);
    if (savedSettings.customBoxThreshold) setCustomBoxThreshold(savedSettings.customBoxThreshold);
    if (savedSettings.maskDilationOffset) setMaskDilationOffset(savedSettings.maskDilationOffset);
    if (savedSettings.inpainter) setInpainter(savedSettings.inpainter);
    if (savedSettings.ocrModel) setOcrModel(savedSettings.ocrModel);
    if (savedSettings.detRotate !== undefined) setDetRotate(savedSettings.detRotate);
    if (savedSettings.detAutoRotate !== undefined) setDetAutoRotate(savedSettings.detAutoRotate);
    if (savedSettings.concurrency) setConcurrency(savedSettings.concurrency);
    if (savedSettings.fontOffset !== undefined) setFontOffset(savedSettings.fontOffset);

    // 清理旧版本遗留的坏数据(见 clearLegacyFinishedImages 注释)
    clearLegacyFinishedImages();
  }, []);

  /** 挂载时从 IndexedDB 恢复上次的翻译结果(失败则静默降级为空画廊) */
  useEffect(() => {
    let cancelled = false;
    loadSavedResults().then((saved) => {
      if (!cancelled && saved.length > 0) setFinishedImages(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 挂载时恢复待翻译文件列表与各自状态;恢复完成前禁止持久化写回 */
  const hydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedEntries = await loadSavedEntries();
      if (cancelled || savedEntries.length === 0) {
        hydratedRef.current = true;
        return;
      }
      const savedStatuses = await loadSavedStatuses(savedEntries);
      if (cancelled) return;
      setEntries(savedEntries);
      if (savedStatuses.size > 0) setFileStatuses(savedStatuses);
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 文件列表变化(选文件夹/增删)防抖写回;挂载初期空列表不覆盖库 */
  useEffect(() => {
    if (!hydratedRef.current) return;
    const t = setTimeout(() => void saveEntries(entries), 300);
    return () => clearTimeout(t);
  }, [entries]);

  /** 状态变化防抖写回(状态记录不含 Blob,体量很小) */
  useEffect(() => {
    if (!hydratedRef.current) return;
    const t = setTimeout(() => void saveStatuses(entries, fileStatuses), 500);
    return () => clearTimeout(t);
  }, [entries, fileStatuses]);

  /** 当前翻译设置(保存到 localStorage,并随每张结果一起记录) */
  const settings: TranslationSettings = useMemo(
    () => ({
      detectionResolution,
      textDetector,
      renderTextDirection,
      translator,
      targetLanguage,
      inpaintingSize,
      customUnclipRatio,
      customBoxThreshold,
      maskDilationOffset,
      inpainter,
      ocrModel,
      detRotate,
      detAutoRotate,
      concurrency,
      fontOffset,
    }),
    [
      detectionResolution,
      textDetector,
      renderTextDirection,
      translator,
      targetLanguage,
      inpaintingSize,
      customUnclipRatio,
      customBoxThreshold,
      maskDilationOffset,
      inpainter,
      ocrModel,
      detRotate,
      detAutoRotate,
      concurrency,
      fontOffset,
    ]
  );

  /** Save settings to localStorage whenever they change */
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  /** クリップボード ペースト対応 */
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.kind === "file") {
          const pastedFile = item.getAsFile();
          if (pastedFile) {
            addPickedFiles(toPickedFiles([pastedFile]));
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste as EventListener);
    return () =>
      window.removeEventListener("paste", handlePaste as EventListener);
  }, []);

  useEffect(() => {
    if (shouldTranslate) {
      processTranslation(pendingIds);
      setPendingIds(null);
      setShouldTranslate(false);
    }
  }, [fileStatuses]);

  // Event Handlers
  /** 追加待翻译文件(按 id 去重,可跨多次选择/拖拽累积) */
  const addPickedFiles = (picked: PickedFile[]) => {
    if (picked.length === 0) return;
    setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const next = [...prev];
      for (const p of picked) {
        const id = `${p.relativePath}-${p.file.lastModified}-${p.file.size}`;
        if (!seen.has(id)) {
          seen.add(id);
          next.push({ id, file: p.file, relativePath: p.relativePath });
        }
      }
      return next;
    });
  };

  /** フォーム再セット */
  const clearForm = () => {
    setEntries([]);
    setFileStatuses(() => new Map());
    void clearSavedSession();
  };

  /** 移除单个待翻译文件 */
  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    setFileStatuses((prev) => {
      const newStatuses = new Map(prev);
      newStatuses.delete(id);
      return newStatuses;
    });
  };

  const clearGallery = () => {
    setFinishedImages([]);
    void clearSavedResults();
  };

  /**
   * フォーム送信 (翻訳リクエスト)
   * @param ids 可选;只翻译这些 entry(文件夹视图里"翻译此文件夹"用)
   */
  const handleSubmit = (ids?: string[]) => {
    const list = ids ? entries.filter((e) => ids.includes(e.id)) : entries;
    if (list.length === 0) return;

    resetFileStatuses(list.map((e) => e.id));
    setPendingIds(list.map((e) => e.id));
    setShouldTranslate(true);
  };

  // Translation Processing - Configeration
  const buildTranslationConfig = (): string => {
    return JSON.stringify({
      detector: {
        detector: textDetector,
        detection_size: detectionResolution,
        text_threshold: 0.5,
        det_rotate: detRotate,
        det_auto_rotate: detAutoRotate,
        box_threshold: customBoxThreshold,
        unclip_ratio: customUnclipRatio,
      },
      ocr: {
        ocr: ocrModel,
      },
      render: {
        direction: renderTextDirection,
        font_size_offset: fontOffset,
      },
      translator: {
        translator: translator,
        target_lang: targetLanguage,
        // custom_openai 等引擎的模型/密钥配置在 gpt_config.yaml,后端默认不加载,需显式传入
        gpt_config: "gpt_config.yaml",
      },
      inpainter: {
        inpainter: inpainter,
        inpainting_size: inpaintingSize,
      },
      mask_dilation_offset: maskDilationOffset,
    });
  };

  // Translation Processing - Network Request
  const requestTranslation = async (file: File, config: string) => {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("config", config);

    const response = await fetch(`/api/translate/with-form/image/stream`, {
      method: "POST",
      body: formData,
    });

    if (response.status !== 200) {
      throw new Error("Upload failed");
    }

    return response;
  };

  // Translation Processing - Chunk Processing
  const processChunk = async (
    value: Uint8Array,
    entry: FileEntry,
    currentBuffer: Uint8Array
  ): Promise<ChunkProcessingResult> => {
    // Check for existing errors first
    if (fileStatuses.get(entry.id)?.error) {
      throw new Error(
        `Processing stopped due to previous error for file ${entry.relativePath}`
      );
    }

    // Combine buffers
    const newBuffer = new Uint8Array(currentBuffer.length + value.length);
    newBuffer.set(currentBuffer);
    newBuffer.set(value, currentBuffer.length);
    let processedBuffer = newBuffer;

    // Process all complete messages in buffer
    while (processedBuffer.length >= 5) {
      const dataSize = new DataView(processedBuffer.buffer).getUint32(1, false);
      const totalSize = 5 + dataSize;
      if (processedBuffer.length < totalSize) break;

      const statusCode = processedBuffer[0];
      const data = processedBuffer.slice(5, totalSize);
      const decodedData = new TextDecoder("utf-8").decode(data);

      processStatusUpdate(statusCode, decodedData, entry, data);
      processedBuffer = processedBuffer.slice(totalSize);
    }

    return { updatedBuffer: processedBuffer };
  };

  // Translation Processing - Single File Stream Processing
  const processSingleFileStream = async (entry: FileEntry, config: string) => {
    try {
      const response = await requestTranslation(entry.file, config);
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to get stream reader");
      }

      let fileBuffer = new Uint8Array();

      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;

        try {
          const result = await processChunk(value, entry, fileBuffer);
          fileBuffer = result.updatedBuffer;
        } catch (error) {
          console.error(`Error processing chunk for ${entry.relativePath}:`, error);
          updateFileStatus(entry.id, {
            status: "error",
            error:
              error instanceof Error ? error.message : "Error processing chunk",
          });
        }
      }
    } catch (err) {
      console.error("Error processing file: ", entry.relativePath, err);
      updateFileStatus(entry.id, {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  // Translation Processing - Overall Translation Batch Process
  const processTranslation = async (idFilter: string[] | null = null) => {
    const config = buildTranslationConfig();
    const queue = entries.filter((e) => !idFilter || idFilter.includes(e.id));

    // 固定并发数的批量处理,避免一次向上百张图同时发起请求
    const workers = Array.from(
      { length: Math.min(concurrency, queue.length) },
      async () => {
        while (queue.length > 0) {
          const entry = queue.shift()!;
          await processSingleFileStream(entry, config);
        }
      }
    );

    try {
      await Promise.all(workers);
    } catch (err) {
      console.error("Translation process failed:", err);
    }
  };

  // Helper to reset file statuses
  const resetFileStatuses = (forIds?: string[]) => {
    // Initialize status for all files;"upload" 让总进度条与状态立即可见,
    // 否则点击翻译后到后端首个事件之间 UI 完全无反馈
    const newStatuses = new Map();
    entries.forEach((entry) => {
      if (forIds && !forIds.includes(entry.id)) return;
      newStatuses.set(entry.id, {
        status: "upload",
        progress: null,
        queuePos: null,
        result: null,
        error: null,
      });
    });
    setFileStatuses(newStatuses);
  };

  // Helper to update status for a specific file
  const updateFileStatus = (fileId: string, update: Partial<FileStatus>) => {
    setFileStatuses((prev) => {
      const newStatuses = new Map(prev);
      const currentStatus = newStatuses.get(fileId) || {
        status: null,
        progress: null,
        queuePos: null,
        result: null,
        error: null,
      };
      const updatedStatus = { ...currentStatus, ...update };
      newStatuses.set(fileId, updatedStatus);
      return newStatuses;
    });
  };

  // Helper to process status updates
  const processStatusUpdate = (
    statusCode: number,
    decodedData: string,
    entry: FileEntry,
    data: Uint8Array
  ): void => {
    switch (statusCode) {
      case 0: // 結果が返ってきた
        const resultBlob = new Blob([data], { type: "image/png" });
        updateFileStatus(entry.id, {
          status: "finished",
          result: resultBlob,
        });

        const finishedImage: FinishedImage = {
          id: `${entry.id}-${Date.now()}`,
          originalName: entry.relativePath,
          result: resultBlob,
          finishedAt: new Date(),
          settings,
        };

        // 同一文件重新翻译时替换旧结果,避免画廊里出现同名重复条目
        // (重复条目会让"保存到磁盘"的进度计数与实际落盘文件数对不上)
        setFinishedImages(prev => [
          finishedImage,
          ...prev.filter(img => img.originalName !== finishedImage.originalName),
        ]);
        // 同步写入 IndexedDB(按 originalName 覆盖),刷新后可恢复
        void saveResult(finishedImage);
        break;
      case 1: // 翻訳中
        const newStatus = decodedData as StatusKey;
        updateFileStatus(entry.id, { status: newStatus });
        break;
      case 2: // エラー
        updateFileStatus(entry.id, {
          status: "error",
          error: decodedData,
        });
        break;
      case 3: // キューに追加された
        updateFileStatus(entry.id, {
          status: "pending",
          queuePos: decodedData,
        });
        break;
      case 4: // キューがクリアされた
        updateFileStatus(entry.id, {
          status: "pending",
          queuePos: null,
        });
        break;
      default: // 未知のステータスコード
        console.warn(`Unknown status code ${statusCode} for file ${entry.relativePath}`);
        break;
    }
  };

  return (
    <div>
      <Header />
      <div className="bg-gray-100 min-h-screen flex flex-col pt-10 items-center">
        <div className="bg-white shadow-md rounded-lg p-6 w-full max-w-6xl space-y-6">
          <OptionsPanel
            detectionResolution={detectionResolution}
            textDetector={textDetector}
            renderTextDirection={renderTextDirection}
            translator={translator}
            targetLanguage={targetLanguage}
            inpaintingSize={inpaintingSize}
            customUnclipRatio={customUnclipRatio}
            customBoxThreshold={customBoxThreshold}
            maskDilationOffset={maskDilationOffset}
            inpainter={inpainter}
            ocrModel={ocrModel}
            detRotate={detRotate}
            detAutoRotate={detAutoRotate}
            concurrency={concurrency}
            fontOffset={fontOffset}
            setDetectionResolution={setDetectionResolution}
            setTextDetector={setTextDetector}
            setRenderTextDirection={setRenderTextDirection}
            setTranslator={setTranslator}
            setTargetLanguage={setTargetLanguage}
            setInpaintingSize={setInpaintingSize}
            setCustomUnclipRatio={setCustomUnclipRatio}
            setCustomBoxThreshold={setCustomBoxThreshold}
            setMaskDilationOffset={setMaskDilationOffset}
            setInpainter={setInpainter}
            setOcrModel={setOcrModel}
            setDetRotate={setDetRotate}
            setDetAutoRotate={setDetAutoRotate}
            setConcurrency={setConcurrency}
            setFontOffset={setFontOffset}
          />

          {/* Main Image Handling Area */}
          <div className="border-t pt-6">
            <ImageHandlingArea
              entries={entries}
              fileStatuses={fileStatuses}
              isProcessing={isProcessing}
              isProcessingAllFinished={isProcessingAllFinished}
              addPickedFiles={addPickedFiles}
              removeEntry={removeEntry}
              handleSubmit={handleSubmit}
              clearForm={clearForm}
            />
          </div>

          {/* Results Gallery */}
          <div className="border-t pt-6">
            <ResultGallery
              finishedImages={finishedImages}
              onClearGallery={clearGallery}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
