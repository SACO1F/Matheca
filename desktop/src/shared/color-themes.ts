export const colorThemes = [
  { id: "GRAPHITE", name: "石墨" },
  { id: "BLUE", name: "雾蓝" },
  { id: "CLAY", name: "陶土" },
  { id: "PLUM", name: "梅紫" },
] as const;
export type ColorTheme = (typeof colorThemes)[number]["id"];
export function isColorTheme(value: unknown): value is ColorTheme {
  return colorThemes.some((theme) => theme.id === value);
}
