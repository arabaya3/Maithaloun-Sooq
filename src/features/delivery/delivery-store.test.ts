import { describe, expect, it } from "vitest";

import {
  parsePersistedDeliveryLocation,
  serializeDeliveryLocation,
} from "./delivery-store";

describe("delivery location persistence", () => {
  const locationIds = new Set(["ramallah", "al-bireh", "maythalun", "other"]);

  it("restores a validated location ID", () => {
    expect(
      parsePersistedDeliveryLocation(
        serializeDeliveryLocation("maythalun"),
        locationIds,
      ),
    ).toBe("maythalun");
  });

  it("rejects malformed and unsupported persisted locations", () => {
    expect(parsePersistedDeliveryLocation("not-json", locationIds)).toBeNull();
    expect(
      parsePersistedDeliveryLocation(
        JSON.stringify({ version: 1, locationId: "unknown" }),
        locationIds,
      ),
    ).toBeNull();
    expect(
      parsePersistedDeliveryLocation(
        JSON.stringify({
          version: 1,
          locationId: "ramallah",
          fee: 10,
        }),
        locationIds,
      ),
    ).toBeNull();
  });
});
