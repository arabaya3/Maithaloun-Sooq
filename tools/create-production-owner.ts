import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

import { assertProductionOwnerBootstrapDatabase } from "../src/features/admin/auth/owner-bootstrap-guard";
import {
  OwnerBootstrapError,
  OwnerService,
} from "../src/features/admin/auth/owner-service";
import { createDatabaseConnection } from "../src/server/db/database";

if (process.argv.some((argument) => argument.startsWith("--password"))) {
  throw new Error("Passwords cannot be passed as command-line arguments.");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const databaseName = assertProductionOwnerBootstrapDatabase(
  databaseUrl,
  process.env.ALLOW_PRODUCTION_OWNER_BOOTSTRAP,
);
const connection = createDatabaseConnection(databaseUrl, 1);
const ownerService = new OwnerService(connection.db);

try {
  output.write(
    "إنشاء مالك إنتاج لمرة واحدة فقط لـ سوق ميثلون. لن تُطبع كلمة المرور.\n",
  );
  const username = await promptVisible("اسم المستخدم: ");
  const displayName = await promptVisible("الاسم الظاهر: ");
  const password = await promptHidden("كلمة المرور: ");
  const confirmation = await promptHidden("تأكيد كلمة المرور: ");
  if (password !== confirmation) {
    throw new OwnerBootstrapError("PASSWORD_MISMATCH");
  }

  const result = await ownerService.createFirstProductionOwner({
    username,
    displayName,
    password,
    databaseName,
  });
  console.log(
    result.created
      ? "Production owner account created."
      : "Production owner unchanged.",
  );
} catch (error) {
  if (error instanceof OwnerBootstrapError) {
    console.error("Production owner bootstrap refused.");
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
