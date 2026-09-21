import {
  resetTestDatabase,
  testDatabaseConnection,
} from "../src/test/test-database";

try {
  await resetTestDatabase();
} finally {
  await testDatabaseConnection.client.end();
}
