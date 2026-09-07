/**
 * Sprint 10A-1.1 — Startup Schema Validation
 *
 * Runs a lightweight schema drift check at startup.
 * NEVER fails startup — only logs warnings.
 * Reads the pre-generated drift data from docs/schema-drift-data.json
 * or runs a quick inline check if the file is missing.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../");
const DRIFT_FILE = join(ROOT, "docs/schema-drift-data.json");

interface DriftEntry {
  table: string;
  col: string;
  issue: string;
  drizzle?: string;
  actual?: string;
  severity?: string;
}

interface DriftData {
  tableMissing: DriftEntry[];
  missing: DriftEntry[];
  typeMismatch: DriftEntry[];
  extra: DriftEntry[];
  generatedAt?: string;
}

export async function runSchemaStartupCheck(): Promise<void> {
  try {
    if (!existsSync(DRIFT_FILE)) {
      logger.info("SCHEMA CHECK: drift data not found — run scripts/schema-drift-check.mjs to generate");
      return;
    }

    const raw = readFileSync(DRIFT_FILE, "utf8");
    const data: DriftData = JSON.parse(raw);

    const critical = data.typeMismatch.filter((d) => d.col === "company_id");
    const totalMissing = data.missing.length;
    const totalTypeMismatch = data.typeMismatch.length;
    const totalTableMissing = data.tableMissing.length;

    if (critical.length === 0 && totalMissing === 0 && totalTypeMismatch === 0) {
      logger.info("SCHEMA OK — no drift detected");
      return;
    }

    logger.warn(
      {
        criticalCompanyIdMismatches: critical.length,
        typeMismatches: totalTypeMismatch,
        missingColumns: totalMissing,
        missingTables: totalTableMissing,
        generatedAt: data.generatedAt,
        criticalTables: critical.map((d) => `${d.table}.${d.col}(${d.drizzle}→${d.actual})`),
      },
      `SCHEMA DRIFT DETECTED — ${totalTypeMismatch} type mismatches, ${totalMissing} missing columns, ${totalTableMissing} missing tables`,
    );

    if (critical.length > 0) {
      for (const d of critical) {
        logger.error(
          { table: d.table, col: d.col, drizzle: d.drizzle, actual: d.actual },
          `SCHEMA CRITICAL: ${d.table}.company_id is ${d.actual} in DB but ${d.drizzle} in Drizzle schema — use companyFilter() helper`,
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "SCHEMA CHECK: failed to read drift data — skipping");
  }
}
