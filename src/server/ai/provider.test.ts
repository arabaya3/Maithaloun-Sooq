import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { aiProvider, agentCallSettings, claudeModelId, outputBudget } =
  await import("./provider");
const { toClaudeSchema } = await import("./openai-client");

afterEach(() => vi.unstubAllEnvs());

describe("AI provider selection", () => {
  it("prefers Claude when its key is set", () => {
    vi.stubEnv("OPENAI_API_KEY", "x");
    vi.stubEnv("ANTHROPIC_API_KEY", "y");
    expect(aiProvider()).toBe("anthropic");
    expect(claudeModelId()).toBe("claude-opus-5-5");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5-5");
    expect(claudeModelId()).toBe("claude-sonnet-5-5");
  });

  it("falls back to OpenAI, then to none", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "x");
    expect(aiProvider()).toBe("openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(aiProvider()).toBeNull();
  });

  it("never sends sampling settings to Claude and leaves room for thinking", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "y");
    const settings = agentCallSettings("claude-opus-5-5", 900);
    expect(settings).not.toHaveProperty("temperature");
    expect(settings.maxOutputTokens).toBeGreaterThanOrEqual(8_000);
    expect(outputBudget(600)).toMatchObject({
      providerOptions: { anthropic: { effort: "low" } },
    });
  });

  it("keeps OpenAI settings unchanged", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "x");
    expect(agentCallSettings("gpt-4.1-mini", 900)).toEqual({
      maxOutputTokens: 900,
      temperature: 0,
    });
    expect(outputBudget(600)).toEqual({ maxOutputTokens: 600 });
  });
});

describe("toClaudeSchema", () => {
  it("drops numeric and length constraints but keeps property names", () => {
    expect(
      toClaudeSchema({
        type: "object",
        additionalProperties: false,
        required: ["minimum", "confidence"],
        properties: {
          minimum: { type: "string", maxLength: 10 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          kind: { enum: ["minimum"] },
        },
      }),
    ).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["minimum", "confidence"],
      properties: {
        minimum: { type: "string" },
        confidence: { type: "number" },
        kind: { enum: ["minimum"] },
      },
    });
  });
});
