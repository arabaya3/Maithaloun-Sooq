const allowedTargets = [
  "/account",
  "/account/orders",
  "/favorites",
  "/checkout",
];

export function safeAccountNext(value: string | undefined): string {
  return value && allowedTargets.includes(value) ? value : "/account";
}
