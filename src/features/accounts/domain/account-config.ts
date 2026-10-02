export function customerAccountsEnabled(): boolean {
  return process.env.CUSTOMER_ACCOUNTS === "on";
}

export const OTP_CODE_PATTERN = /^\d{6}$/;
export const CUSTOMER_SESSION_ABSOLUTE_MS = 60 * 24 * 60 * 60 * 1_000;
export const CUSTOMER_SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_SAVED_ADDRESSES = 5;
export const MAX_ACCOUNT_FAVORITES = 100;
