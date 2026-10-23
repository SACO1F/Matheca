export const guideLinks = {
  privacyContact: "https://github.com/SACO1F/Matheca/issues",
  home: "https://www.deepseek.com/",
  platform: "https://platform.deepseek.com/",
  balance: "https://platform.deepseek.com/balance",
  keys: "https://platform.deepseek.com/api_keys",
  docs: "https://api-docs.deepseek.com/",
  vision: "https://api-docs.deepseek.com/guides/vision/",
  faq: "https://api-docs.deepseek.com/faq/",
} as const;
export type GuideLink = keyof typeof guideLinks;
export const guideValues = {
  address: "https://api.deepseek.com",
  model: "deepseek-flash",
} as const;
export type GuideValue = keyof typeof guideValues;
export const guideVerifiedDate = "2026-10-15";
