export const LOGIN_FAILURE_MESSAGE =
  "تعذّر تسجيل الدخول. تحقق من البيانات وحاول مجدداً.";
export const MAX_LOGIN_REQUEST_BYTES = 4_000;
export const LOGIN_USERNAME_MAX_LENGTH = 32;
export const LOGIN_PASSWORD_MAX_LENGTH = 128;
export const LOGIN_HONEYPOT_MAX_LENGTH = 200;
export const LOGIN_RATE_LIMIT = 8;
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_GLOBAL_LIMIT = 100;

export interface LoginInput {
  username: string;
  password: string;
  honeypot: string;
  requestSize: number;
}
