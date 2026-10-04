import "server-only";

import { testDoublesAllowed } from "@/server/env/isolated-test-server";

// Test doubles for AI calls are opt-in and can never be switched on in a deployed production server.
export function isFakeAiEnabled(): boolean {
  return testDoublesAllowed() && process.env.AI_FAKE_MODE === "1";
}
