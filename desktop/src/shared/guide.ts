import guide from "./guide-data.json";
export const guideLinks = guide.links;
export type GuideLink = keyof typeof guideLinks;
export const guideValues = guide.values;
export type GuideValue = keyof typeof guideValues;
export const guideVerifiedDate = guide.verifiedDate;
