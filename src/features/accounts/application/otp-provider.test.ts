import { afterEach, describe, expect, it, vi } from "vitest";

import { createPhoneOtpProvider } from "./otp-provider";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPhoneOtpProvider", () => {
  it("stays disabled until a provider is configured", () => {
    vi.stubEnv("CUSTOMER_OTP_PROVIDER", "");
    expect(createPhoneOtpProvider()).toBeNull();
    vi.stubEnv("CUSTOMER_OTP_PROVIDER", "supabase");
    vi.stubEnv("SUPABASE_URL", "");
    expect(createPhoneOtpProvider()).toBeNull();
  });

  it("refuses the development provider in production builds", () => {
    vi.stubEnv("CUSTOMER_OTP_PROVIDER", "development");
    vi.stubEnv("CUSTOMER_OTP_DEV_CODE", "246810");
    vi.stubEnv("NODE_ENV", "production");
    expect(createPhoneOtpProvider()).toBeNull();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "1");
    expect(createPhoneOtpProvider()).toBeNull();
  });

  it("accepts only the configured development code locally", async () => {
    vi.stubEnv("CUSTOMER_OTP_PROVIDER", "development");
    vi.stubEnv("CUSTOMER_OTP_DEV_CODE", "246810");
    vi.stubEnv("VERCEL", "");
    const provider = createPhoneOtpProvider();
    expect(await provider?.verify("+970591234567", "246810")).toBe(true);
    expect(await provider?.verify("+970591234567", "000000")).toBe(false);
  });
});
