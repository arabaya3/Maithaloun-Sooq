import { describe, expect, it } from "vitest";

import manifest from "./manifest";

describe("web app manifest", () => {
  it("uses the official Arabic identity and RTL direction", () => {
    const value = manifest();

    expect(value.name).toBe("سوق ميثلون");
    expect(value.short_name).toBe("سوق ميثلون");
    expect(value.lang).toBe("ar");
    expect(value.dir).toBe("rtl");
  });
});
