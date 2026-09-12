export type StatusKey =
  | "upload"
  | "pending"
  | "detection"
  | "ocr"
  | "textline_merge"
  | "mask-generation"
  | "inpainting"
  | "upscaling"
  | "translating"
  | "rendering"
  | "finished"
  | "error"
  | "error-upload"
  | "error-lang"
  | "error-translating"
  | "error-too-large"
  | "error-disconnect"
  | null;

export interface ChunkProcessingResult {
  updatedBuffer: Uint8Array;
}

export const processingStatuses = [
  "upload",
  "pending",
  "detection",
  "ocr",
  "textline_merge",
  "mask-generation",
  "inpainting",
  "upscaling",
  "translating",
  "rendering",
];

export type TranslatorKey =  
  | "youdao"  
  | "baidu"  
  | "deepl"  
  | "papago"  
  | "caiyun"  
  | "sakura"  
  | "offline"  
  | "openai"  
  | "deepseek"  
  | "groq"  
  | "gemini"  
  | "custom_openai"  
  | "nllb"  
  | "nllb_big"  
  | "sugoi"  
  | "jparacrawl"  
  | "jparacrawl_big"  
  | "m2m100"  
  | "m2m100_big"  
  | "mbart50"  
  | "qwen2"  
  | "qwen2_big"  
  | "none";  

export const validTranslators: TranslatorKey[] = [  
  "youdao",  
  "baidu",  
  "deepl",  
  "papago",  
  "caiyun",  
  "sakura",  
  "offline",  
  "openai",  
  "deepseek",  
  "groq",  
  "gemini",  
  "custom_openai",  
  "nllb",  
  "nllb_big",  
  "sugoi",  
  "jparacrawl",  
  "jparacrawl_big",  
  "m2m100",  
  "m2m100_big",  
  "mbart50",  
  "qwen2",  
  "qwen2_big",  
  "none",  
];  

export interface FileStatus {
  status: StatusKey | null;
  progress: string | null;
  queuePos: string | null;
  result: Blob | null;
  error: string | null;
}

/** 待翻译文件(id 由相对路径+修改时间+大小唯一确定,用于状态索引与去重) */
export interface FileEntry {
  id: string;
  file: File;
  relativePath: string;
}

export interface TranslationSettings {
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
  /** 批量翻译时同时请求的图片数(web 模式下 --batch-size 的等价物) */
  concurrency: number;
  /** 渲染字号偏移(像素),正数放大 */
  fontOffset: number;
}

export interface FinishedImage {
  id: string;
  originalName: string;
  result: Blob;
  finishedAt: Date;
  settings: TranslationSettings;
}
