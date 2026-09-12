import type { TranslationSettings } from '@/types';

const SETTINGS_KEY = 'manga-translator-settings-v3';
const LEGACY_FINISHED_IMAGES_KEY = 'manga-translator-finished-images';

export const loadSettings = (): Partial<TranslationSettings> => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn('Failed to load settings from localStorage:', error);
    return {};
  }
};

export const saveSettings = (settings: TranslationSettings): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save settings to localStorage:', error);
  }
};

/**
 * 旧版本曾把结果图 Blob 直接 JSON.stringify 进 localStorage(Blob 会序列化成
 * 空对象,刷新后画廊崩溃),这里清掉这批坏数据。
 */
export const clearLegacyFinishedImages = (): void => {
  try {
    localStorage.removeItem(LEGACY_FINISHED_IMAGES_KEY);
  } catch (error) {
    console.warn('Failed to clean legacy gallery data:', error);
  }
};
