/**
 * The look of the «today's category» scene for each category: the colour of the text panel, the
 * light on the wall, the countertop the products stand on and one quiet decorative motif. Only
 * light, surfaces and plant shadows are drawn, never anything that could pass for a product.
 * Unknown category codes get the default theme, so a new category never breaks the banner.
 */
export type DailySceneMotif = "leaves" | "tiles" | "arch";

export interface DailySceneTheme {
  /** Solid colour behind the text; it fades into the scene. */
  panel: string;
  /** Wall gradient, top to bottom. */
  wallTop: string;
  wallBottom: string;
  /** Warm or cool tint of the window light. */
  light: string;
  /** Countertop base colour and its terrazzo specks. */
  counter: string;
  counterEdge: string;
  speck: string;
  /** Round pedestals the products stand on. */
  pedestal: string;
  /** Plant shadows and motif lines. */
  shade: string;
  motif: DailySceneMotif;
}

const DEFAULT_THEME: DailySceneTheme = {
  panel: "#0a4524",
  wallTop: "#eef1e8",
  wallBottom: "#dfe6d6",
  light: "#fff8e6",
  counter: "#ece9e1",
  counterEdge: "#d6d1c5",
  speck: "#9fa797",
  pedestal: "#f6f4ee",
  shade: "#4b6a45",
  motif: "leaves",
};

const THEMES: Record<string, DailySceneTheme> = {
  laundry: {
    ...DEFAULT_THEME,
    panel: "#123f4a",
    wallTop: "#edf2f4",
    wallBottom: "#d9e4e8",
    light: "#f6fbff",
    counter: "#eceff0",
    counterEdge: "#cfd7da",
    speck: "#8fa3ab",
    shade: "#3f6670",
    motif: "arch",
  },
  kitchen: {
    ...DEFAULT_THEME,
    wallTop: "#f4f1e8",
    wallBottom: "#e7e1d2",
    light: "#fff4da",
    counter: "#efebe3",
    counterEdge: "#d9d1c2",
    speck: "#a89c86",
    motif: "tiles",
  },
  bathroom: {
    ...DEFAULT_THEME,
    panel: "#0f4a48",
    wallTop: "#eef4f2",
    wallBottom: "#d8e6e2",
    light: "#f4fffb",
    counter: "#eaefed",
    counterEdge: "#cad8d4",
    speck: "#8aa49e",
    shade: "#3d6b63",
    motif: "tiles",
  },
  tools: {
    ...DEFAULT_THEME,
    wallTop: "#f3efe6",
    wallBottom: "#e4ddcd",
    light: "#fff1d6",
    counter: "#e9e4da",
    counterEdge: "#d3cab8",
    speck: "#a1937a",
    shade: "#5a6a3f",
    motif: "arch",
  },
  home: { ...DEFAULT_THEME },
};

export function dailySceneTheme(code: string | null | undefined): DailySceneTheme {
  return code && Object.hasOwn(THEMES, code) ? THEMES[code]! : DEFAULT_THEME;
}
