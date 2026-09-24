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
    "إنشاء أو إعادة تعيين مالك الإنتاج لـ سوق ميثلون. لن تُطبع كلمة المرور.\n",
  );
  output.write("كلمة المرور يجب أن تكون بين 12 و 128 حرفاً.\n");
  output.write(
    "اكتب كلمة المرور ببطء؛ سيظهر * لكل حرف، ثم طول الإدخال بعد Enter.\n",
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
      : "Production owner password rotated.",
  );
} catch (error) {
  if (error instanceof OwnerBootstrapError) {
    console.error(`Production owner bootstrap refused: ${error.message}`);
    if (error.message === "PASSWORD_POLICY") {
      console.error("Password must be 12–128 characters.");
    }
    if (error.message === "PASSWORD_MISMATCH") {
      console.error(
        "Password confirmation did not match. Type the same password twice; avoid Backspace if unsure—retype from scratch.",
      );
    }
    if (error.message === "OWNER_EXISTS") {
      console.error("Use the existing owner username to rotate the password.");
    }
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
      resolve(answer.trim());
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
    let settled = false;

    const redrawMask = () => {
      output.write(`\r${question}${"*".repeat(value.length)}`);
    };

    const onData = (chunk: Buffer | string) => {
      if (settled) return;
      const text = chunk.toString("utf8");

      for (const char of text) {
        if (char === "\u0003") {
          finish(() => reject(new Error("cancelled")));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish(() => {
            output.write(` (${value.length} حرفاً)\n`);
            resolve(value);
          });
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            redrawMask();
            output.write("\x1b[K");
          }
          continue;
        }
        if (char === "\u0015") {
          value = "";
          redrawMask();
          output.write("\x1b[K");
          continue;
        }
        // Ignore other control characters from Windows terminals.
        if (char < " " || char === "\u001b") {
          continue;
        }
        value += char;
        output.write("*");
      }
    };

    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      input.removeListener("data", onData);
      input.setRawMode?.(Boolean(wasRaw));
      input.pause();
      done();
    };

    input.on("data", onData);
  });
}
