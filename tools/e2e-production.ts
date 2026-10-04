// Full e2e gate against a production build: one fresh test database, one `next start`, one Playwright run.
// Usage: pnpm test:e2e:production [playwright args]
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { config as loadEnvironment } from "dotenv";

import { parseTestEnv } from "../src/server/env/env-schema";
import { e2eServerEnvironment } from "../tests/e2e/server-env";

loadEnvironment({ path: ".env.local", quiet: true });
const testEnvironment = parseTestEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  ORDER_RATE_LIMIT_PEPPER: process.env.ORDER_RATE_LIMIT_PEPPER,
  APP_ORIGIN: process.env.APP_ORIGIN,
});

const port = Number(process.env.E2E_PRODUCTION_PORT ?? 3300);
const origin = `http://localhost:${port}`;
// Outside test-results/, which Playwright empties when it starts.
const logDirectory = path.resolve("artifacts", "e2e-production");
const logFile = path.join(logDirectory, "server.log");
const READY_DEADLINE_MS = 60_000;
const next = path.resolve("node_modules/next/dist/bin/next");
const isWindows = process.platform === "win32";

const serverEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  ...e2eServerEnvironment(testEnvironment, origin),
  NODE_ENV: "production" as const,
  // Lets the production build use test doubles; only honoured for the local maithalun_test database.
  E2E_ISOLATED_TEST_SERVER: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

function run(command: string, args: string[], environment = process.env) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: environment,
    // pnpm is a .cmd shim on Windows; node runs directly so paths with spaces stay intact.
    shell: isWindows && command === "pnpm",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}`,
    );
  }
}

function portIsFree(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

async function waitUntilReady(server: ChildProcess) {
  const deadline = Date.now() + READY_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`next start exited with ${server.exitCode}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok && (await response.json()).ok === true) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`/api/health was not ready within ${READY_DEADLINE_MS} ms`);
}

function stop(server: ChildProcess | null) {
  if (!server?.pid || server.exitCode !== null) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}

async function main(): Promise<number> {
  if (!(await portIsFree())) {
    throw new Error(
      `Port ${port} is in use. Stop the other server first; this gate never reuses one.`,
    );
  }
  rmSync(logDirectory, { recursive: true, force: true });
  mkdirSync(logDirectory, { recursive: true });

  run("pnpm", ["db:test:up"]);
  run("pnpm", ["db:test:prepare"]);
  run(process.execPath, [next, "build", "--webpack"], serverEnvironment);

  let server: ChildProcess | null = null;
  const cleanup = () => stop(server);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  try {
    const log = createWriteStream(logFile);
    const started = spawn(
      process.execPath,
      [next, "start", "-p", String(port)],
      {
        env: serverEnvironment,
        detached: !isWindows,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server = started;
    started.stdout?.pipe(log);
    started.stderr?.pipe(log);
    await waitUntilReady(started);
    console.log(`\nProduction server ready at ${origin}`);

    const result = spawnSync(
      process.execPath,
      [
        path.resolve("node_modules/@playwright/test/cli.js"),
        "test",
        ...process.argv.slice(2),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          E2E_EXTERNAL_SERVER: "1",
          E2E_PORT: String(port),
        },
      },
    );
    return result.status ?? 1;
  } finally {
    cleanup();
  }
}

main()
  .then((status) => {
    if (status === 0) {
      rmSync(logDirectory, { recursive: true, force: true });
      console.log("\nProduction e2e gate passed.");
    } else {
      console.error(`\nProduction e2e gate failed. Server log: ${logFile}`);
    }
    process.exit(status);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(`Server log (if started): ${logFile}`);
    process.exit(1);
  });
