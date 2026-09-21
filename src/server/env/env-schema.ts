import { z } from "zod";

const databaseUrlSchema = z
  .url()
  .refine(
    (value) =>
      value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "must use PostgreSQL",
  );

const serverEnvSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  ORDER_RATE_LIMIT_PEPPER: z.string().min(32),
  APP_ORIGIN: z.url(),
  TRUST_PROXY: z.enum(["true", "false"]).optional(),
});

const testEnvSchema = serverEnvSchema.extend({
  TEST_DATABASE_URL: databaseUrlSchema,
});

export type ServerEnv = {
  DATABASE_URL: string;
  ORDER_RATE_LIMIT_PEPPER: string;
  APP_ORIGIN: string;
  trustProxy: boolean;
};
export type TestEnv = ServerEnv & { TEST_DATABASE_URL: string };

function formatEnvironmentError(error: z.ZodError): Error {
  const fields = [...new Set(error.issues.map((issue) => issue.path[0]))]
    .filter((field): field is string => typeof field === "string")
    .sort()
    .join(", ");
  return new Error(`Invalid server configuration: ${fields}`);
}

function toServerEnv(parsed: z.infer<typeof serverEnvSchema>): ServerEnv {
  return {
    DATABASE_URL: parsed.DATABASE_URL,
    ORDER_RATE_LIMIT_PEPPER: parsed.ORDER_RATE_LIMIT_PEPPER,
    APP_ORIGIN: parsed.APP_ORIGIN,
    trustProxy: parsed.TRUST_PROXY === "true",
  };
}

export function parseServerEnv(input: unknown): ServerEnv {
  const parsed = serverEnvSchema.safeParse(input);
  if (!parsed.success) throw formatEnvironmentError(parsed.error);
  return toServerEnv(parsed.data);
}

export function parseTestEnv(input: unknown): TestEnv {
  const parsed = testEnvSchema.safeParse(input);
  if (!parsed.success) throw formatEnvironmentError(parsed.error);

  const developmentUrl = new URL(parsed.data.DATABASE_URL);
  const testUrl = new URL(parsed.data.TEST_DATABASE_URL);
  if (
    parsed.data.DATABASE_URL === parsed.data.TEST_DATABASE_URL ||
    !["127.0.0.1", "localhost"].includes(testUrl.hostname) ||
    testUrl.pathname !== "/maithalun_test" ||
    developmentUrl.pathname === testUrl.pathname
  ) {
    throw new Error("Invalid server configuration: TEST_DATABASE_URL");
  }

  return {
    ...toServerEnv(parsed.data),
    TEST_DATABASE_URL: parsed.data.TEST_DATABASE_URL,
  };
}
