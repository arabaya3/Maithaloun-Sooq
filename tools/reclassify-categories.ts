/**
 * Applies the committed category plan (tools/data/category-reclassification-plan.json).
 *
 *   tsx tools/reclassify-categories.ts                      dry run (default): prints the changes only
 *   tsx tools/reclassify-categories.ts --apply --backup-dir <dir>
 *                                                           writes a backup of every product it will touch,
 *                                                           then applies the plan in one transaction
 *   tsx tools/reclassify-categories.ts --rollback <backup>  puts those products back exactly as in the backup
 *
 * Options: --plan <file> to use another plan. It reads DATABASE_URL. Only primary categories and category
 * listings change: names, prices, stock, photos and updated_at are never written. Running it again after
 * --apply finds nothing to do. It needs migration 0031 (product_category_links).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";

import { createDatabaseConnection } from "../src/server/db/database";
import * as schema from "../src/server/db/schema";
import {
  backupSchema,
  planReclassification,
  reclassificationPlanSchema,
  type CategoryBackup,
  type CurrentAssignment,
} from "./reclassify-categories-plan";

config({ path: ".env.local", quiet: true });

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const apply = process.argv.includes("--apply");
const rollbackFile = argument("--rollback");
const planFile =
  argument("--plan") ?? "tools/data/category-reclassification-plan.json";
const backupDir = argument("--backup-dir") ?? "category-backups";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const target = new URL(databaseUrl);
const targetLabel = `${target.hostname}:${target.port || "5432"}${target.pathname}`;
const mode = rollbackFile ? "ROLLBACK" : apply ? "APPLY" : "DRY RUN";
console.log(`${mode} against ${targetLabel}`);

const connection = createDatabaseConnection(databaseUrl, 1);
const { db } = connection;

async function loadCurrent(
  productIds: readonly string[],
): Promise<Map<string, CurrentAssignment & { uuid: string }>> {
  const rows = await db
    .select({
      uuid: schema.products.id,
      productId: schema.products.domainId,
      primary: schema.products.categoryId,
    })
    .from(schema.products)
    .where(inArray(schema.products.domainId, [...productIds]));
  const links = rows.length
    ? await db
        .select()
        .from(schema.productCategoryLinks)
        .where(
          inArray(
            schema.productCategoryLinks.productId,
            rows.map((row) => row.uuid),
          ),
        )
    : [];
  return new Map(
    rows.map((row) => [
      row.productId,
      {
        ...row,
        links: links
          .filter((link) => link.productId === row.uuid)
          .map((link) => link.categoryCode)
          .sort(),
      },
    ]),
  );
}

/** Sets one product's primary and its exact set of category listings. */
async function setAssignment(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  uuid: string,
  primary: string,
  links: readonly string[],
) {
  const all = [...new Set([primary, ...links])];
  // Only category_id: the trigger keeps the primary among the listings.
  await transaction
    .update(schema.products)
    .set({ categoryId: primary })
    .where(eq(schema.products.id, uuid));
  await transaction
    .delete(schema.productCategoryLinks)
    .where(
      and(
        eq(schema.productCategoryLinks.productId, uuid),
        notInArray(schema.productCategoryLinks.categoryCode, all),
      ),
    );
  await transaction
    .insert(schema.productCategoryLinks)
    .values(all.map((categoryCode) => ({ productId: uuid, categoryCode })))
    .onConflictDoNothing();
}

async function assertLinksTable() {
  const [row] = await connection.client<{ exists: string | null }[]>`
    select to_regclass('public.product_category_links') as exists`;
  if (!row?.exists) {
    throw new Error(
      "product_category_links is missing: apply migration 0031 first.",
    );
  }
}

async function rollback(file: string) {
  const backup = backupSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const current = await loadCurrent(
    backup.products.map((row) => row.productId),
  );
  let restored = 0;
  await db.transaction(async (transaction) => {
    for (const saved of backup.products) {
      const now = current.get(saved.productId);
      if (!now) {
        console.log(`  skip ${saved.productId}: product not found`);
        continue;
      }
      const same =
        now.primary === saved.primary &&
        now.links.join(",") === [...saved.links].sort().join(",");
      if (same) continue;
      console.log(
        `  ${saved.productId}: ${now.primary} [${now.links.join(", ")}] -> ${saved.primary} [${saved.links.join(", ")}]`,
      );
      await setAssignment(transaction, now.uuid, saved.primary, saved.links);
      restored += 1;
    }
  });
  console.log(`Restored ${restored} product(s) from ${file}.`);
}

async function main() {
  await assertLinksTable();
  if (rollbackFile) return rollback(rollbackFile);

  const plan = reclassificationPlanSchema.parse(
    JSON.parse(readFileSync(planFile, "utf8")),
  );
  const current = await loadCurrent(
    plan.entries.map((entry) => entry.productId),
  );
  const categories = await db
    .select({ code: schema.productCategories.code })
    .from(schema.productCategories)
    .where(isNull(schema.productCategories.archivedAt));
  const changes = planReclassification(
    plan,
    current,
    new Set(categories.map((row) => row.code)),
  );

  for (const change of changes) {
    if (change.kind === "unchanged") {
      console.log(`  = ${change.productId}: already as planned`);
    } else if (change.kind === "skipped") {
      console.log(`  ! ${change.productId}: skipped (${change.why})`);
    } else {
      const primary =
        change.fromPrimary === change.toPrimary
          ? `primary ${change.toPrimary}`
          : `primary ${change.fromPrimary} -> ${change.toPrimary}`;
      console.log(
        `  ~ ${change.productId} ${change.name ?? ""}\n      ${primary}; add [${change.addLinks.join(", ")}]; remove [${change.removeLinks.join(", ")}]\n      ${change.reason}`,
      );
    }
  }
  const pending = changes.filter((change) => change.kind === "change");
  console.log(
    `${pending.length} to change, ${changes.filter((c) => c.kind === "unchanged").length} already done, ${changes.filter((c) => c.kind === "skipped").length} skipped.`,
  );
  if (!apply) {
    console.log("Dry run: nothing was written. Add --apply to apply.");
    return;
  }
  if (!pending.length) {
    console.log("Nothing to apply.");
    return;
  }

  // The backup is on disk before anything changes.
  const backup: CategoryBackup = {
    kind: "maytha-category-backup",
    createdAt: new Date().toISOString(),
    database: targetLabel,
    products: pending.map((change) => {
      const now = current.get(change.productId)!;
      return {
        productId: change.productId,
        primary: now.primary,
        links: [...now.links],
      };
    }),
  };
  mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `categories-${backup.createdAt.replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(backupFile, `${JSON.stringify(backup, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(`Backup written: ${backupFile}`);

  const plannedById = new Map(
    plan.entries.map((entry) => [entry.productId, entry]),
  );
  await db.transaction(async (transaction) => {
    for (const change of pending) {
      const entry = plannedById.get(change.productId)!;
      await setAssignment(
        transaction,
        current.get(change.productId)!.uuid,
        entry.primary,
        entry.extras,
      );
    }
  });
  console.log(
    `Applied ${pending.length} change(s). Undo with: --rollback ${backupFile}`,
  );
  console.log(
    "The storefront shows them after its next refresh: any catalog save, the storefront-day cron, or GET /api/cron/storefront-day with the cron secret.",
  );
}

try {
  await main();
} finally {
  await connection.client.end();
}
