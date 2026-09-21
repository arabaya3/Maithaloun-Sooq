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
});

const testEnvSchema = serverEnvSchema.extend({
  TEST_DATABASE_URL: databaseUrlSchema,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type TestEnv = z.infer<typeof testEnvSchema>;

function formatEnvironmentError(error: z.ZodError): Error {
  const fields = [...new Set(error.issues.map((issue) => issue.path[0]))]
    .filter((field): field is string => typeof field === "string")
    .sort()
    .join(", ");
  return new Error(`Invalid server configuration: ${fields}`);
}

export function parseServerEnv(input: unknown): ServerEnv {
  const parsed = serverEnvSchema.safeParse(input);
  if (!parsed.success) throw formatEnvironmentError(parsed.error);
  return parsed.data;
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

  return parsed.data;
}
