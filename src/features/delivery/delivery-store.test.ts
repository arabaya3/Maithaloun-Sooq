import { describe, expect, it } from "vitest";

import {
  parsePersistedDeliveryLocation,
  serializeDeliveryLocation,
} from "./delivery-store";

describe("delivery location persistence", () => {
  it("restores a validated location ID", () => {
    expect(
      parsePersistedDeliveryLocation(serializeDeliveryLocation("maythalun")),
    ).toBe("maythalun");
  });

  it("rejects malformed and unsupported persisted locations", () => {
    expect(parsePersistedDeliveryLocation("not-json")).toBeNull();
    expect(
      parsePersistedDeliveryLocation(
        JSON.stringify({ version: 1, locationId: "unknown" }),
      ),
    ).toBeNull();
    expect(
      parsePersistedDeliveryLocation(
        JSON.stringify({
          version: 1,
          locationId: "ramallah",
          fee: 10,
        }),
      ),
    ).toBeNull();
  });
});
