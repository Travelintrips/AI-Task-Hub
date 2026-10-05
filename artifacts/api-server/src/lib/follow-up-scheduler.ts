import { db, aiTasksTable, followUpLogsTable, taskCommentsTable, auditLogsTable, getAiTaskStatusVariants, type AiTaskStatus } from "@workspace/db";
import { eq, and, lt, lte, isNull, gte, inArray } from "drizzle-orm";
import { sendFonnte } from "./fonnte";
import { logger } from "./logger";

const FOLLOW_UP_STATUSES: AiTaskStatus[] = [
  "waiting_documents",
  "waiting_customer",
  "missing_data",
];

const FOLLOW_UP_STATUS_VALUES = Array.from(new Set(
  FOLLOW_UP_STATUSES.flatMap((status) => getAiTaskStatusVariants(status)),
));

function buildFollowUpMessage(task: { taskNumber: string | null; title: string; customerName: string | null; missingData: string | null }, round: number): string {
  const name = task.customerName ? `*${task.customerName}*` : "Bapak/Ibu";
  let missing = "";
  try { missing = task.missingData ? JSON.parse(task.missingData).join(", ") : ""; } catch { missing = ""; }

  const intros = [
    `Halo ${name} 👋\n\nKami ingin mengingatkan bahwa task Anda *${task.taskNumber ?? task.title}* masih menunggu kelengkapan.`,
    `Halo ${name},\n\nIni adalah pengingat kedua untuk task *${task.taskNumber ?? task.title}*. Mohon segera lengkapi dokumen yang diperlukan.`,
    `Halo ${name},\n\n⚠️ *Pengingat Terakhir*\nTask *${task.taskNumber ?? task.title}* belum mendapatkan respons selama 7 hari.`,
  ];

  let msg = intros[Math.min(round - 1, 2)];
  if (missing) msg += `\n\n📋 Dokumen yang dibutuhkan:\n${missing}`;
  msg += `\n\nSilakan hubungi kami jika ada pertanyaan.\n\n_AI Task Center_`;
  return msg;
}

async function runFollowUps(): Promise<void> {
  const now = new Date();

  const tasks = await db
    .select()
    .from(aiTasksTable)
    .where(inArray(aiTasksTable.status, FOLLOW_UP_STATUS_VALUES))
    .limit(200);

  for (const task of tasks) {
    if (!task.customerPhone) continue;
    const lastReply = task.lastCustomerReplyAt ?? task.createdAt;
    const hoursSince = (now.getTime() - lastReply.getTime()) / (1000 * 60 * 60);

    const count = task.followUpCount ?? 0;

    let shouldSend = false;
    let round = 0;
    if (count === 0 && hoursSince >= 24) { shouldSend = true; round = 1; }
    else if (count === 1 && hoursSince >= 72) { shouldSend = true; round = 2; }
    else if (count === 2 && hoursSince >= 168) { shouldSend = true; round = 3; }

    if (!shouldSend) continue;

    const message = buildFollowUpMessage(task, round);

    const result = await sendFonnte(task.customerPhone, message);

    await db.insert(followUpLogsTable).values({
      taskId: task.id,
      companyId: task.companyId,
      customerPhone: task.customerPhone,
      customerName: task.customerName,
      followUpNumber: round,
      message,
      channel: "whatsapp",
      isSuccess: result.success,
      errorMessage: result.error ?? null,
    });

    await db.update(aiTasksTable).set({ followUpCount: round }).where(eq(aiTasksTable.id, task.id));

    await db.insert(taskCommentsTable).values({
      taskId: task.id,
      senderName: "AI System",
      comment: `📤 Follow-up otomatis #${round} dikirim ke ${task.customerPhone}${result.success ? " ✅" : " ❌ gagal"}`,
      senderType: "system",
    });

    await db.insert(auditLogsTable).values({
      action: "follow_up_sent",
      module: "follow_up",
      before: `Follow-up #${round} dikirim untuk task ${task.taskNumber ?? task.id}`,
      entityId: task.id,
    });

    logger.info({ taskId: task.id, round, success: result.success }, "Follow-up sent");
  }
}

let schedulerRunning = false;

export function startFollowUpScheduler(): void {
  if (schedulerRunning) return;
  schedulerRunning = true;

  setInterval(async () => {
    try {
      await runFollowUps();
    } catch (err) {
      logger.error({ err }, "Follow-up scheduler error");
    }
  }, 60 * 60 * 1000);

  logger.info("Follow-up scheduler started (interval: 1 hour)");
}
