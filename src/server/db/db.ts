import "server-only";

import { createDatabaseConnection } from "./database";
import { getServerEnv } from "../env/env";

const connection = createDatabaseConnection(getServerEnv().DATABASE_URL);

export const db = connection.db;
