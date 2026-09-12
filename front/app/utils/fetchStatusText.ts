import type { StatusKey } from "@/types";

export const fetchStatusText = (
  status: StatusKey | null,
  progress: string | null,
  queuePos: string | null,
  error: string | null
) => {
  switch (status) {
    case "upload":
      return progress ? `上传中(${progress})` : "上传中";
    case "pending":
      return queuePos ? `排队等待中,当前第 ${queuePos} 位` : "处理中";
    case "detection":
      return "正在检测文字区域";
    case "ocr":
      return "正在识别文字(OCR)";
    case "textline_merge":
      return "正在合并文本行";
    case "mask-generation":
      return "正在生成文字遮罩";
    case "inpainting":
      return "正在抹除原文字(图像修复)";
    case "upscaling":
      return "正在放大图像";
    case "translating":
      return "正在翻译";
    case "rendering":
      return "正在渲染译文";
    case "finished":
      return "正在下载图像";
    case "error":
      return error || "出错了,请重试";
    case "error-upload":
      return "上传失败,请重试";
    case "error-lang":
      return "所选翻译引擎不支持目标语言";
    case "error-translating":
      return "翻译服务未返回文本";
    case "error-too-large":
      return "图片尺寸过大(超过 8000x8000 像素)";
    case "error-disconnect":
      return "与服务器的连接已断开";
    default:
      return "";
  }
};
