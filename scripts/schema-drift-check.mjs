/**
 * Sprint 10A-1.1 — Schema Drift Scanner
 * Compares Drizzle schema (expected) vs actual Supabase schema.
 * Usage: node scripts/schema-drift-check.mjs
 */
import pg from 'pg';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, connectionTimeoutMillis: 8000 });
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'lib/db/src/schema');

// ── 1. Parse Drizzle schema files to extract table → column → type mapping ──
function parseDrizzleSchema(dir) {
  const tables = {}; // tableName → { colName → { type, nullable, default } }
  const files = readdirSync(dir).filter(f => f.endsWith('.ts'));

  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');
    // Match pgTable("table_name", { ... })
    const tableMatches = src.matchAll(/pgTable\s*\(\s*["']([^"']+)["']\s*,\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g);
    for (const [, tableName, body] of tableMatches) {
      if (!tables[tableName]) tables[tableName] = {};
      // Match column definitions: colName: type("col_name")...
      const colMatches = body.matchAll(/(\w+)\s*:\s*(text|integer|serial|boolean|timestamp|real|numeric|varchar|uuid|pgEnum|json|jsonb)\s*\(\s*["']([^"']+)["']/g);
      for (const [, jsName, drizzleType, dbName] of colMatches) {
        tables[tableName][dbName] = { drizzleType, jsName };
      }
    }
  }
  return tables;
}

// ── 2. Get actual Supabase schema ──
async function getSupabaseSchema(tableNames) {
  const result = await pool.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1)
    ORDER BY table_name, ordinal_position
  `, [tableNames]);

  const tables = {};
  for (const row of result.rows) {
    if (!tables[row.table_name]) tables[row.table_name] = {};
    tables[row.table_name][row.column_name] = {
      dataType: row.data_type,
      isNullable: row.is_nullable === 'YES',
      default: row.column_default,
    };
  }
  return tables;
}

// ── 3. Compare ──
function compareSchemas(drizzle, supabase) {
  const drifts = [];

  for (const [tableName, drizzleCols] of Object.entries(drizzle)) {
    const supCols = supabase[tableName];
    if (!supCols) {
      drifts.push({ table: tableName, col: '*', issue: 'TABLE_MISSING_IN_DB', drizzle: 'exists', actual: 'MISSING' });
      continue;
    }

    for (const [colName, drizzleInfo] of Object.entries(drizzleCols)) {
      const supCol = supCols[colName];
      if (!supCol) {
        drifts.push({ table: tableName, col: colName, issue: 'COLUMN_MISSING_IN_DB', drizzle: drizzleInfo.drizzleType, actual: 'MISSING' });
        continue;
      }

      // Type mismatch check
      const typeMap = {
        text: ['text', 'character varying', 'varchar', 'name'],
        integer: ['integer', 'int4', 'int'],
        serial: ['integer', 'int4'],
        boolean: ['boolean'],
        timestamp: ['timestamp without time zone', 'timestamp with time zone', 'timestamptz'],
        real: ['real', 'double precision', 'float4', 'float8'],
        numeric: ['numeric', 'decimal'],
        uuid: ['uuid'],
        json: ['json', 'jsonb'],
        jsonb: ['json', 'jsonb'],
      };
      const expected = typeMap[drizzleInfo.drizzleType] ?? [drizzleInfo.drizzleType];
      if (!expected.includes(supCol.dataType)) {
        drifts.push({
          table: tableName, col: colName, issue: 'TYPE_MISMATCH',
          drizzle: drizzleInfo.drizzleType, actual: supCol.dataType,
          severity: 'HIGH',
        });
      }
    }

    // Extra columns in DB (not in Drizzle schema)
    for (const colName of Object.keys(supCols)) {
      if (!drizzleCols[colName]) {
        drifts.push({ table: tableName, col: colName, issue: 'COLUMN_EXTRA_IN_DB', drizzle: 'MISSING', actual: supCols[colName].dataType, severity: 'INFO' });
      }
    }
  }

  return drifts;
}

// ── Main ──
const drizzle = parseDrizzleSchema(SCHEMA_DIR);
const tableNames = Object.keys(drizzle);
console.log(`Parsed ${tableNames.length} Drizzle tables`);

const supabase = await getSupabaseSchema(tableNames);
console.log(`Fetched ${Object.keys(supabase).length} tables from Supabase`);

const drifts = compareSchemas(drizzle, supabase);
const missing = drifts.filter(d => d.issue === 'COLUMN_MISSING_IN_DB');
const typeMismatch = drifts.filter(d => d.issue === 'TYPE_MISMATCH');
const extra = drifts.filter(d => d.issue === 'COLUMN_EXTRA_IN_DB');
const tableMissing = drifts.filter(d => d.issue === 'TABLE_MISSING_IN_DB');

console.log(`\nDrift summary:`);
console.log(`  Tables missing in DB:  ${tableMissing.length}`);
console.log(`  Columns missing in DB: ${missing.length}`);
console.log(`  Type mismatches:       ${typeMismatch.length}`);
console.log(`  Extra cols in DB:      ${extra.length}`);

// Output JSON for startup check
const output = { tableMissing, missing, typeMismatch, extra, generatedAt: new Date().toISOString() };
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs/schema-drift-data.json'), JSON.stringify(output, null, 2));

// ── Generate Markdown Report ──
let md = `# Schema Drift Report\n_Generated: ${new Date().toISOString()}_\n\n`;
md += `## Summary\n`;
md += `| Issue | Count |\n|---|---|\n`;
md += `| Tables missing in DB | ${tableMissing.length} |\n`;
md += `| Columns missing in DB | ${missing.length} |\n`;
md += `| Type mismatches (HIGH) | ${typeMismatch.length} |\n`;
md += `| Extra cols in DB (INFO) | ${extra.length} |\n\n`;

if (typeMismatch.length > 0) {
  md += `## 🔴 Type Mismatches (HIGH Priority)\n`;
  md += `| Table | Column | Drizzle Type | Actual DB Type | Impact |\n|---|---|---|---|---|\n`;
  for (const d of typeMismatch) {
    const impact = d.col === 'company_id' ? '⚠️ Query will fail with type cast error' : '⚠️ Potential data issues';
    md += `| ${d.table} | ${d.col} | ${d.drizzle} | ${d.actual} | ${impact} |\n`;
  }
  md += '\n';
}

if (missing.length > 0) {
  md += `## 🟠 Columns Missing in DB (Schema Drift)\n`;
  md += `| Table | Column | Drizzle Type | Fix |\n|---|---|---|---|\n`;
  for (const d of missing.slice(0, 50)) {
    md += `| ${d.table} | ${d.col} | ${d.drizzle} | Run DB migration or remove from schema |\n`;
  }
  if (missing.length > 50) md += `\n_...and ${missing.length - 50} more_\n`;
  md += '\n';
}

if (tableMissing.length > 0) {
  md += `## 🔴 Tables Missing in DB\n`;
  for (const d of tableMissing) md += `- \`${d.table}\` — in Drizzle schema but not in Supabase DB\n`;
  md += '\n';
}

md += `## Company ID Type Audit\n`;
md += `Tables with \`company_id\` that DIFFER from Drizzle TEXT schema:\n\n`;
const companyMismatches = typeMismatch.filter(d => d.col === 'company_id');
if (companyMismatches.length > 0) {
  md += `| Table | DB Type | Drizzle Type |\n|---|---|---|\n`;
  for (const d of companyMismatches) md += `| ${d.table} | ${d.actual} | ${d.drizzle} |\n`;
} else {
  md += `_No company_id type mismatches detected in Drizzle-managed tables._\n`;
}

writeFileSync(join(ROOT, 'docs/schema-drift-report.md'), md);
console.log('\nReports written to docs/schema-drift-report.md and docs/schema-drift-data.json');

await pool.end();
