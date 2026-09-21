import {
  resetTestDatabase,
  testDatabaseConnection,
} from "../src/test/test-database";
import { parseTestAdminEnv } from "../src/test/test-admin";
import { OwnerService } from "../src/features/admin/auth/owner-service";

try {
  await resetTestDatabase();
  const admin = parseTestAdminEnv({
    TEST_ADMIN_USERNAME: process.env.TEST_ADMIN_USERNAME,
    TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD,
    TEST_ADMIN_DISPLAY_NAME: process.env.TEST_ADMIN_DISPLAY_NAME,
  });
  const ownerService = new OwnerService(testDatabaseConnection.db);
  await ownerService.createTestOwner({
    username: admin.TEST_ADMIN_USERNAME,
    displayName: admin.TEST_ADMIN_DISPLAY_NAME,
    password: admin.TEST_ADMIN_PASSWORD,
    databaseName: "maithalun_test",
  });
} finally {
  await testDatabaseConnection.client.end();
}
