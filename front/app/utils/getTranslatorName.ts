import type { TranslatorKey } from "@/types";

const translatorNames: Record<TranslatorKey, string> = {
  youdao: "有道翻译",
  baidu: "百度翻译",
  deepl: "DeepL",
  papago: "Papago",
  caiyun: "彩云小译",
  sakura: "Sakura",
  offline: "本地离线模型",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  groq: "Groq",
  gemini: "Gemini",
  custom_openai: "自定义 OpenAI",
  nllb: "NLLB",
  nllb_big: "NLLB(Large)",
  sugoi: "Sugoi",
  jparacrawl: "JParaCrawl",
  jparacrawl_big: "JParaCrawl(Large)",
  m2m100: "M2M100",
  m2m100_big: "M2M100(Large)",
  mbart50: "mBART-50",
  qwen2: "Qwen2",
  qwen2_big: "Qwen2(Large)",
  none: "不翻译(仅抹除文字)",
};

export function getTranslatorName(key: TranslatorKey): string {
  return translatorNames[key];
}
