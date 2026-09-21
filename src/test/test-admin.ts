import { z } from "zod";

const testAdminSchema = z.object({
  TEST_ADMIN_USERNAME: z.string().min(3).max(32),
  TEST_ADMIN_PASSWORD: z.string().min(12).max(128),
  TEST_ADMIN_DISPLAY_NAME: z.string().min(2).max(80).default("مدير الاختبار"),
});

export function parseTestAdminEnv(input: unknown) {
  const parsed = testAdminSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      "Invalid server configuration: TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD",
    );
  }
  return parsed.data;
}
