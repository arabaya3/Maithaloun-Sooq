export type EvalEnvironment = Readonly<Record<string, string | undefined>>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class EvalRefused extends Error {
  constructor(readonly reason: string) {
    super(`Model evaluation refused: ${reason}`);
  }
}

// Paid evaluation runs only on an isolated local test database, never on Vercel or anything that looks like Production.
export function assertEvaluationEnvironment(environment: EvalEnvironment) {
  if (environment.ASSISTANT_MODEL_EVAL !== "1") {
    throw new EvalRefused("ASSISTANT_MODEL_EVAL=1 is not set");
  }
  if (!environment.OPENAI_API_KEY?.trim()) {
    throw new EvalRefused("OPENAI_API_KEY is not set");
  }
  if (environment.VERCEL || environment.VERCEL_ENV) {
    throw new EvalRefused("running on Vercel");
  }
  if (environment.NODE_ENV === "production") {
    throw new EvalRefused("NODE_ENV is production");
  }
  if (environment.AI_FAKE_MODE === "1") {
    throw new EvalRefused("AI_FAKE_MODE would replace the real model");
  }
  let database: URL;
  try {
    database = new URL(environment.TEST_DATABASE_URL ?? "");
  } catch {
    throw new EvalRefused("TEST_DATABASE_URL is missing or invalid");
  }
  if (!LOCAL_HOSTS.has(database.hostname)) {
    throw new EvalRefused("TEST_DATABASE_URL is not a local database");
  }
  if (!/test/i.test(database.pathname)) {
    throw new EvalRefused("TEST_DATABASE_URL does not name a test database");
  }
  if (
    environment.DATABASE_URL &&
    environment.DATABASE_URL !== environment.TEST_DATABASE_URL &&
    !LOCAL_HOSTS.has(safeHost(environment.DATABASE_URL))
  ) {
    throw new EvalRefused("DATABASE_URL points at a remote database");
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
