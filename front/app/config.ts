export const languageOptions = [  
  { value: "CHS", label: "简体中文" },  
  { value: "CHT", label: "繁體中文" },  
  { value: "CSY", label: "čeština" },  
  { value: "NLD", label: "Nederlands" },  
  { value: "ENG", label: "English" },  
  { value: "FRA", label: "français" },  
  { value: "DEU", label: "Deutsch" },  
  { value: "HUN", label: "magyar nyelv" },  
  { value: "ITA", label: "italiano" },  
  { value: "JPN", label: "日本語" },  
  { value: "KOR", label: "한국어" },  
  { value: "POL", label: "polski" },  
  { value: "PTB", label: "português" },  
  { value: "ROM", label: "limba română" },  
  { value: "RUS", label: "русский язык" },  
  { value: "ESP", label: "español" },  
  { value: "TRK", label: "Türk dili" },  
  { value: "UKR", label: "українська мова" },  
  { value: "VIN", label: "Tiếng Việt" },  
  { value: "ARA", label: "العربية" },  
  { value: "CNR", label: "crnogorski jezik" },  
  { value: "SRP", label: "српски језик" },  
  { value: "HRV", label: "hrvatski jezik" },  
  { value: "THA", label: "ภาษาไทย" },  
  { value: "IND", label: "Indonesia" },  
  { value: "FIL", label: "Wikang Filipino" }  
];  

export const detectionResolutions = [1024, 1536, 2048, 2560];

export const inpaintingSizes = [516, 1024, 2048, 2560];

export const textDetectorOptions = [
  { value: "default", label: "默认" },
  { value: "ctd", label: "CTD" },
  { value: "paddle", label: "Paddle" },
];

export const inpainterOptions = [
  { value: "default", label: "默认" },
  { value: "lama_large", label: "Lama Large" },
  { value: "lama_mpe", label: "Lama MPE" },
  { value: "sd", label: "Stable Diffusion" },
  { value: "none", label: "无(不修复)" },
  { value: "original", label: "使用原图" },
];

export const ocrModelOptions = [
  { value: "48px", label: "48px(默认,批量快)" },
  { value: "32px", label: "32px(更快,精度低)" },
  { value: "48px_ctc", label: "48px CTC" },
  { value: "mocr", label: "MangaOCR(日文漫画,较慢)" },
  { value: "hayai", label: "Hayai OCR v2(日/中/韩/英,竖排优)" },
];

export const imageMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/bmp",
  "image/webp",
];
