import React from "react";
import type { TranslatorKey } from "@/types";
import { validTranslators } from "@/types";
import { getTranslatorName } from "@/utils/getTranslatorName";
import {
  languageOptions,
  detectionResolutions,
  textDetectorOptions,
  inpaintingSizes,
  inpainterOptions,
  ocrModelOptions,
} from "@/config";
import { LabeledInput } from "@/components/LabeledInput";
import { LabeledSelect } from "@/components/LabeledSelect";
import { LabeledToggle } from "@/components/LabeledToggle";

type Props = {
  detectionResolution: string;
  textDetector: string;
  renderTextDirection: string;
  translator: TranslatorKey;
  targetLanguage: string;
  inpaintingSize: string;
  customUnclipRatio: number;
  customBoxThreshold: number;
  maskDilationOffset: number;
  inpainter: string;
  ocrModel: string;
  detRotate: boolean;
  detAutoRotate: boolean;
  concurrency: number;
  fontOffset: number;

  setDetectionResolution: (val: string) => void;
  setTextDetector: (val: string) => void;
  setRenderTextDirection: (val: string) => void;
  setTranslator: (val: TranslatorKey) => void;
  setTargetLanguage: (val: string) => void;
  setInpaintingSize: (val: string) => void;
  setCustomUnclipRatio: (val: number) => void;
  setCustomBoxThreshold: (val: number) => void;
  setMaskDilationOffset: (val: number) => void;
  setInpainter: (val: string) => void;
  setOcrModel: (val: string) => void;
  setDetRotate: (val: boolean) => void;
  setDetAutoRotate: (val: boolean) => void;
  setConcurrency: (val: number) => void;
  setFontOffset: (val: number) => void;
};

export const OptionsPanel: React.FC<Props> = ({
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
  setDetectionResolution,
  setTextDetector,
  setRenderTextDirection,
  setTranslator,
  setTargetLanguage,
  setInpaintingSize,
  setCustomUnclipRatio,
  setCustomBoxThreshold,
  setMaskDilationOffset,
  setInpainter,
  setOcrModel,
  setDetRotate,
  setDetAutoRotate,
  setConcurrency,
  setFontOffset,
}) => {
  return (
    <>
      {/* 1段目のセクション */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* Detection Resolution */}
        <LabeledSelect
          id="detectionResolution"
          label="检测分辨率"
          icon="carbon:fit-to-screen"
          title="文本检测分辨率,越大越准也越慢"
          value={detectionResolution}
          onChange={setDetectionResolution}
          options={detectionResolutions.map((res) => ({
            label: `${res}px`,
            value: String(res),
          }))}
        />

        {/* Text Detector */}
        <LabeledSelect
          id="textDetector"
          label="文本检测器"
          icon="carbon:search-locate"
          title="文字区域检测算法"
          value={textDetector}
          onChange={setTextDetector}
          options={textDetectorOptions}
        />

        {/* Render text direction */}
        <LabeledSelect
          id="renderTextDirection"
          label="渲染方向"
          icon="carbon:text-align-left"
          title="译文排版方向"
          value={renderTextDirection}
          onChange={setRenderTextDirection}
          options={[
            { value: "auto", label: "自动" },
            { value: "horizontal", label: "横向" },
            { value: "vertical", label: "竖向" },
          ]}
        />

        {/* Translator */}
        <LabeledSelect
          id="translator"
          label="翻译引擎"
          icon="carbon:operations-record"
          title="翻译服务"
          value={translator}
          onChange={(val) => setTranslator(val as TranslatorKey)}
          options={validTranslators.map((key) => ({
            value: key,
            label: getTranslatorName(key),
          }))}
        />

        {/* Target Language */}
        <LabeledSelect
          id="targetLanguage"
          label="目标语言"
          icon="carbon:language"
          title="译文目标语言"
          value={targetLanguage}
          onChange={setTargetLanguage}
          options={languageOptions}
        />
      </div>

      {/* 2段目のセクション */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mt-4">
        {/* Inpainting Size */}
        <LabeledSelect
          id="inpaintingSize"
          label="修复分辨率"
          icon="carbon:paint-brush"
          title="图像修复的处理尺寸"
          value={inpaintingSize}
          onChange={setInpaintingSize}
          options={inpaintingSizes.map((size) => ({
            label: `${size}px`,
            value: String(size),
          }))}
        />

        {/* Unclip Ratio */}
        <LabeledInput
          id="unclipRatio"
          label="文本框外扩比例"
          icon="weui:max-window-filled"
          title="文字框向外扩展的比例"
          step={0.01}
          value={customUnclipRatio}
          onChange={setCustomUnclipRatio}
        />

        {/* Box Threshold */}
        <LabeledInput
          id="boxThreshold"
          label="检测阈值"
          icon="weui:photo-wall-outlined"
          title="文字检测置信度阈值"
          step={0.01}
          value={customBoxThreshold}
          onChange={setCustomBoxThreshold}
        />

        {/* Mask Dilation Offset */}
        <LabeledInput
          id="maskDilationOffset"
          label="遮罩膨胀偏移"
          icon="material-symbols:adjust-outline"
          title="抹字遮罩的膨胀程度"
          step={1}
          value={maskDilationOffset}
          onChange={setMaskDilationOffset}
        />

        {/* Inpainter */}
        <LabeledSelect
          id="inpainter"
          label="图像修复器"
          icon="carbon:paint-brush"
          title="抹除文字后填补背景的算法"
          value={inpainter}
          onChange={setInpainter}
          options={inpainterOptions}
        />
      </div>
      {/* 3段目のセクション:检测增强 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mt-4">
        {/* Vertical-friendly detection */}
        <LabeledToggle
          id="detAutoRotate"
          label="竖排文字增强"
          icon="carbon:rotate-counterclockwise"
          title="检测时旋转图像以优先识别竖排文字行(竖排日文漫画建议开启)"
          value={detAutoRotate}
          onChange={setDetAutoRotate}
        />

        {/* Rotate detection */}
        <LabeledToggle
          id="detRotate"
          label="旋转检测"
          icon="carbon:rotate-90"
          title="检测时旋转图像,对横竖混排可能提升检测效果"
          value={detRotate}
          onChange={setDetRotate}
        />

        {/* OCR model */}
        <LabeledSelect
          id="ocrModel"
          label="OCR 模型"
          icon="carbon:text-annotation"
          title="文字识别模型;Hayai 对竖排/彩字/多语言最稳,MangaOCR 仅日文"
          value={ocrModel}
          onChange={setOcrModel}
          options={ocrModelOptions}
        />

        {/* Font size offset */}
        <LabeledInput
          id="fontOffset"
          label="字体大小偏移"
          icon="carbon:text-font"
          title="译文渲染字号相对原文字号的偏移(像素)。译文偏小时调大"
          step={1}
          value={fontOffset}
          onChange={setFontOffset}
        />

        {/* Concurrency */}
        <LabeledSelect
          id="concurrency"
          label="同时翻译张数"
          icon="carbon:progress-bar"
          title="批量翻译时同时处理的图片数(相当于 CLI 的 --batch-size)。调大更快,但显存不足可能失败"
          value={String(concurrency)}
          onChange={(val) => setConcurrency(Number(val))}
          options={[
            { value: "1", label: "1(最稳)" },
            { value: "2", label: "2" },
            { value: "4", label: "4(推荐)" },
            { value: "8", label: "8(需大显存)" },
          ]}
        />
      </div>
    </>
  );
};
