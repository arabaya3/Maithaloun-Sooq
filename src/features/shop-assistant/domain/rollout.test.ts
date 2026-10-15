import { describe, expect, it } from "vitest";

import { assistantAnswers, assistantAudience } from "./rollout";

const OWNER = "+970591234567";
const CUSTOMER = "+970599999999";

function answers(
  environment: Parameters<typeof assistantAudience>[0],
  from: string,
) {
  return assistantAnswers(from, assistantAudience(environment));
}

describe("assistant audience fails closed", () => {
  it.each([
    ["missing", {}],
    ["blank allowlist", { SHOP_ASSISTANT_ALLOWLIST: "" }],
    ["whitespace allowlist", { SHOP_ASSISTANT_ALLOWLIST: "   " }],
    [
      "malformed allowlist",
      { SHOP_ASSISTANT_ALLOWLIST: "owner-phone, 0591234567" },
    ],
    ["separators only", { SHOP_ASSISTANT_ALLOWLIST: ",,," }],
    ["open-to-all blank", { SHOP_ASSISTANT_OPEN_TO_ALL: "" }],
    ["open-to-all not exactly true", { SHOP_ASSISTANT_OPEN_TO_ALL: "yes" }],
    ["open-to-all 1", { SHOP_ASSISTANT_OPEN_TO_ALL: "1" }],
    ["open-to-all TRUE", { SHOP_ASSISTANT_OPEN_TO_ALL: "TRUE" }],
    ["open-to-all false", { SHOP_ASSISTANT_OPEN_TO_ALL: "false" }],
  ])("answers nobody when the configuration is %s", (_case, environment) => {
    expect(answers(environment, OWNER)).toBe(false);
    expect(answers(environment, CUSTOMER)).toBe(false);
  });

  it("answers only valid allowlisted numbers during activation", () => {
    const environment = {
      SHOP_ASSISTANT_ALLOWLIST: "+970 59-123-4567, not-a-number, +97059",
    };
    expect(answers(environment, OWNER)).toBe(true);
    expect(answers(environment, CUSTOMER)).toBe(false);
  });

  it("keeps the allowlist when open-to-all is not exactly true", () => {
    const environment = {
      SHOP_ASSISTANT_ALLOWLIST: OWNER,
      SHOP_ASSISTANT_OPEN_TO_ALL: "on",
    };
    expect(answers(environment, OWNER)).toBe(true);
    expect(answers(environment, CUSTOMER)).toBe(false);
  });

  it("answers everyone only with the explicit full-rollout switch", () => {
    expect(answers({ SHOP_ASSISTANT_OPEN_TO_ALL: "true" }, CUSTOMER)).toBe(
      true,
    );
    expect(
      answers(
        { SHOP_ASSISTANT_OPEN_TO_ALL: " true ", SHOP_ASSISTANT_ALLOWLIST: "" },
        CUSTOMER,
      ),
    ).toBe(true);
  });
});
