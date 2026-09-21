import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

import { config } from "dotenv";

import { assertOwnerBootstrapDatabase } from "../src/features/admin/auth/owner-bootstrap-guard";
import {
  OwnerBootstrapError,
  OwnerService,
} from "../src/features/admin/auth/owner-service";
import { createDatabaseConnection } from "../src/server/db/database";
import { parseServerEnv } from "../src/server/env/env-schema";

config({ path: ".env.local", quiet: true });

if (process.argv.some((argument) => argument.startsWith("--password"))) {
  throw new Error("Passwords cannot be passed as command-line arguments.");
}

const environment = parseServerEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
  TRUST_PROXY: process.env.TRUST_PROXY,
});
const databaseName = assertOwnerBootstrapDatabase(environment.DATABASE_URL);
const connection = createDatabaseConnection(environment.DATABASE_URL, 1);
const ownerService = new OwnerService(connection.db);

try {
  const username = await promptVisible("اسم المستخدم: ");
  const displayName = await promptVisible("الاسم الظاهر: ");
  const password = await promptHidden("كلمة المرور: ");
  const confirmation = await promptHidden("تأكيد كلمة المرور: ");
  if (password !== confirmation) {
    throw new OwnerBootstrapError("PASSWORD_MISMATCH");
  }

  const result = await ownerService.createOrRotate({
    username,
    displayName,
    password,
    databaseName,
  });
  console.log(
    result.created ? "Owner account created." : "Owner password rotated.",
  );
} catch (error) {
  if (error instanceof OwnerBootstrapError) {
    console.error("Owner bootstrap refused.");
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await connection.client.end();
}

function promptVisible(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    output.write(question);
    const wasRaw = input.isRaw;
    input.setRawMode?.(true);
    input.resume();
    let value = "";

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        cleanup();
        reject(new Error("cancelled"));
        return;
      }
      if (text === "\r" || text === "\n") {
        cleanup();
        output.write("\n");
        resolve(value);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if (text === "\u0015") {
        value = "";
        return;
      }
      value += text;
    };

    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode?.(Boolean(wasRaw));
      input.pause();
    };

    input.on("data", onData);
  });
}
