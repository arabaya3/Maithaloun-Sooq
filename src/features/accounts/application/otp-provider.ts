import "server-only";

import { createClient } from "@supabase/supabase-js";

export interface PhoneOtpProvider {
  send(phoneE164: string): Promise<boolean>;
  verify(phoneE164: string, code: string): Promise<boolean>;
}

// Codes are generated, stored and checked by Supabase Auth; this app never stores them.
function supabasePhoneOtp(url: string, secret: string): PhoneOtpProvider {
  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async send(phone) {
      const { error } = await client.auth.signInWithOtp({ phone });
      return !error;
    },
    async verify(phone, token) {
      const { data, error } = await client.auth.verifyOtp({
        phone,
        token,
        type: "sms",
      });
      return !error && data.user?.phone === phone.slice(1);
    },
  };
}

// Local development and automated tests only; refused in any production build.
function developmentPhoneOtp(code: string): PhoneOtpProvider {
  return {
    send: async () => true,
    verify: async (_phone, token) => token === code,
  };
}

export function createPhoneOtpProvider(): PhoneOtpProvider | null {
  const kind = process.env.CUSTOMER_OTP_PROVIDER;
  if (kind === "supabase") {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    return url && secret ? supabasePhoneOtp(url, secret) : null;
  }
  if (kind === "development") {
    const code = process.env.CUSTOMER_OTP_DEV_CODE;
    const production =
      process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
    return !production && code && /^\d{6}$/.test(code)
      ? developmentPhoneOtp(code)
      : null;
  }
  return null;
}
