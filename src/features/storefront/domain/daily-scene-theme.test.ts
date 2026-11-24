import { describe, expect, it } from "vitest";

import { dailySceneTheme } from "./daily-scene-theme";

describe("dailySceneTheme", () => {
  it("gives each known category its own scene", () => {
    expect(dailySceneTheme("laundry")).not.toEqual(dailySceneTheme("kitchen"));
    expect(dailySceneTheme("bathroom").motif).toBe("tiles");
  });

  it("falls back to the default scene for unknown or missing codes", () => {
    const fallback = dailySceneTheme(null);
    expect(dailySceneTheme("garden-new")).toEqual(fallback);
    expect(dailySceneTheme("constructor")).toEqual(fallback);
    expect(fallback.panel).toMatch(/^#[0-9a-f]{6}$/);
  });
});
