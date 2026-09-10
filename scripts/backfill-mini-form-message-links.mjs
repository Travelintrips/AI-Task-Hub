/**
 * Link recent inbound WhatsApp messages to a task created by a mini-form.
 *
 * Usage:
 *   node scripts/backfill-mini-form-message-links.mjs --production
 *   node scripts/backfill-mini-form-message-links.mjs --development
 *
 * The update is deliberately narrow: same company and phone, inbound
 * messages only, no existing task link, and no more than 24 hours before the
 * intake session through task creation. This avoids pulling old conversations
 * from the same phone number into a new task.
 */
import pg from "pg";

const { Pool } = pg;
const target = process.argv.includes("--production")
  ? "production"
  : process.argv.includes("--development")
    ? "development"
    : null;
const taskNumber = process.argv
  .find((arg) => arg.startsWith("--task-number="))
  ?.slice("--task-number=".length) ?? "WA-20260908-F265";

if (!target) {
  console.error("Specify --production or --development");
  process.exit(1);
}

const connectionString =
  target === "production"
    ? process.env.SUPABASE_DATABASE_URL
    : process.env.SUPABASE_DATABASE_URL_DEV;

if (!connectionString) {
  console.error(`SUPABASE database URL for ${target} is not configured`);
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 10000,
});

const client = await pool.connect();

try {
  await client.query("BEGIN");

  const taskResult = await client.query(
    `SELECT id, task_number, company_id, customer_phone, created_at
       FROM public.ai_tasks
      WHERE task_number = $1
      LIMIT 1`,
    [taskNumber],
  );
  const task = taskResult.rows[0];

  if (!task) {
    await client.query("COMMIT");
    console.log(`[${target}] Task ${taskNumber} tidak ditemukan; tidak ada perubahan.`);
    process.exitCode = 0;
  } else {
    const sessionResult = await client.query(
      `SELECT id, phone, created_at
         FROM public.conversation_intake_sessions
        WHERE task_id = $1::text
          AND status = 'submitted'
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [task.id],
    );
    const session = sessionResult.rows[0];

    if (!session) {
      await client.query("COMMIT");
      console.log(
        `[${target}] Task ${taskNumber} tidak memiliki intake session submitted; tidak ada perubahan.`,
      );
      process.exitCode = 0;
    } else {
      const linkedResult = await client.query(
        `UPDATE public.whatsapp_messages
            SET task_id = $1
          WHERE company_id = $2
            AND task_id IS NULL
            AND direction = 'inbound'
            AND regexp_replace(
                  COALESCE(sender_phone, "from"),
                  '[^0-9]', '', 'g'
                ) = regexp_replace($3, '[^0-9]', '', 'g')
            AND created_at >= $4::timestamptz - INTERVAL '24 hours'
            AND created_at <= $5::timestamptz
        RETURNING id`,
        [
          task.id,
          task.company_id,
          session.phone ?? task.customer_phone,
          session.created_at,
          task.created_at,
        ],
      );

      await client.query("COMMIT");
      console.log(
        `[${target}] Task ${taskNumber}: ${linkedResult.rowCount ?? 0} pesan dihubungkan.`,
      );
      if (linkedResult.rows.length > 0) {
        console.log(`[${target}] Message IDs: ${linkedResult.rows.map((row) => row.id).join(", ")}`);
      }
      process.exitCode = 0;
    }
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error(`[${target}] Backfill gagal:`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}