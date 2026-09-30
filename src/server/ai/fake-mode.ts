import "server-only";

// Test doubles for AI calls are opt-in and can never be switched on in production.
export function isFakeAiEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" && process.env.AI_FAKE_MODE === "1"
  );
}
