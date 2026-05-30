import { db, aiTasksTable, teamMembersTable } from "@workspace/db";
import { eq, and, ne, count, sql } from "drizzle-orm";
import { openai } from "./openai";
import { logger } from "./logger";

// ─── Kategori → Divisi/Role mapping ─────────────────────────────────────────
const CATEGORY_DIVISION_MAP: Record<string, string[]> = {
  "Import":             ["Import", "CS Import", "Freight"],
  "Import FCL":         ["Import", "CS Import", "Freight"],
  "Import LCL":         ["Import", "CS Import", "Freight"],
  "Export":             ["Export", "CS Export", "Freight"],
  "Export FCL":         ["Export", "CS Export"],
  "Trucking":           ["Trucking", "Operasional", "Driver"],
  "Customs Clearance":  ["Customs", "PPJK", "Bea Cukai"],
  "Customs":            ["Customs", "PPJK"],
  "Air Freight":        ["Air Freight", "Export", "Import"],
  "Forwarding":         ["Forwarding", "CS", "Operasional"],
};

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high:     3,
  medium:   2,
  low:      1,
};

const SLA_URGENCY_WEIGHT: Record<string, number> = {
  overdue:   4,
  due_soon:  3,
  on_track:  1,
  completed: 0,
};

// ─── Types ───────────────────────────────────────────────────────────────────
export interface CandidateScore {
  memberId:   number;
  memberName: string;
  role:       string;
  division:   string | null;
  activeTaskCount: number;

  workloadScore:     number;  // 0–40
  skillScore:        number;  // 0–30
  urgencyScore:      number;  // 0–20
  availabilityScore: number;  // 0–10
  totalScore:        number;  // 0–100

  reasons: string[];
}

export interface DispatchSuggestion {
  taskId:        number;
  taskTitle:     string;
  taskCategory:  string | null;
  taskPriority:  string;
  taskSlaStatus: string;
  candidates:    CandidateScore[];
  topCandidate:  CandidateScore | null;
  explanation:   string;
  confidence:    number;
  fallbackMode:  boolean;
}

// ─── Workload snapshot ───────────────────────────────────────────────────────
async function getWorkloadMap(companyId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ assignedTo: aiTasksTable.assignedTo, cnt: count(aiTasksTable.id) })
    .from(aiTasksTable)
    .where(and(
      eq(aiTasksTable.companyId, companyId),
      ne(aiTasksTable.status, "completed"),
      ne(aiTasksTable.status, "cancelled"),
    ))
    .groupBy(aiTasksTable.assignedTo);

  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.assignedTo) map.set(r.assignedTo.toLowerCase(), Number(r.cnt));
  }
  return map;
}

// ─── Rule-Engine Scoring ─────────────────────────────────────────────────────
function scoreCandidate(
  member: { id: number; name: string; role: string; division: string | null },
  task:   { category: string | null; priority: string; slaStatus: string },
  activeCount: number,
  maxWorkload: number,
): CandidateScore {
  const reasons: string[] = [];

  // ── 1. Workload Score (0–40) ─────────────────────────────────────────────
  // Fewer tasks = higher score; max 6 tasks = completely penalized
  const capWorkload = Math.min(activeCount, 8);
  const workloadScore = Math.round(40 * (1 - capWorkload / 8));
  if (activeCount === 0) {
    reasons.push("Tidak ada task aktif — tersedia penuh");
  } else if (activeCount <= 2) {
    reasons.push(`Workload ringan (${activeCount} task aktif)`);
  } else if (activeCount <= 4) {
    reasons.push(`Workload sedang (${activeCount} task aktif)`);
  } else {
    reasons.push(`⚠️ Workload berat (${activeCount} task aktif)`);
  }

  // ── 2. Skill / Division Match (0–30) ─────────────────────────────────────
  let skillScore = 0;
  const matchedDivisions = task.category ? (CATEGORY_DIVISION_MAP[task.category] ?? []) : [];
  const memberDiv = (member.division ?? "").toLowerCase();
  const memberRole = (member.role ?? "").toLowerCase();

  if (matchedDivisions.length > 0) {
    const exactDivMatch = matchedDivisions.some((d) => memberDiv.includes(d.toLowerCase()));
    const roleMatch = matchedDivisions.some((d) => memberRole.includes(d.toLowerCase()) || d.toLowerCase().includes(memberRole));

    if (exactDivMatch) {
      skillScore = 30;
      reasons.push(`✅ Divisi cocok: ${member.division} ↔ ${task.category}`);
    } else if (roleMatch) {
      skillScore = 18;
      reasons.push(`✅ Role relevan: ${member.role} untuk ${task.category}`);
    } else {
      skillScore = 5;
      reasons.push(`Divisi/role tidak spesifik untuk kategori ${task.category ?? "ini"}`);
    }
  } else {
    skillScore = 15;
    reasons.push("Kategori task umum — semua tim bisa handle");
  }

  // ── 3. SLA Urgency Score (0–20) ──────────────────────────────────────────
  // High urgency → assign to most AVAILABLE person (low workload)
  const urgencyWeight = SLA_URGENCY_WEIGHT[task.slaStatus] ?? 1;
  const availabilityRatio = maxWorkload > 0 ? 1 - (activeCount / (maxWorkload + 1)) : 1;
  const urgencyScore = Math.round(20 * availabilityRatio * (urgencyWeight / 4));

  if (task.slaStatus === "overdue") {
    reasons.push("⚡ Task OVERDUE — prioritaskan yang paling tersedia");
  } else if (task.slaStatus === "due_soon") {
    reasons.push("⏰ SLA hampir habis — butuh respons cepat");
  }

  // ── 4. Availability Bonus (0–10) ─────────────────────────────────────────
  // Small bonus for members who handle this type of task (via role seniority)
  const priorityWeight = PRIORITY_WEIGHT[task.priority] ?? 2;
  const isHighPriority = priorityWeight >= 3;
  const isSenior = memberRole.includes("senior") || memberRole.includes("manager") || memberRole.includes("head") || memberRole.includes("supervisor");

  let availabilityScore = 0;
  if (isHighPriority && isSenior) {
    availabilityScore = 10;
    reasons.push(`⭐ Senior member untuk task ${task.priority} priority`);
  } else if (activeCount === 0) {
    availabilityScore = 8;
    reasons.push("Siap menerima task baru");
  } else {
    availabilityScore = Math.max(0, 5 - activeCount);
  }

  const totalScore = workloadScore + skillScore + urgencyScore + availabilityScore;

  return {
    memberId: member.id,
    memberName: member.name,
    role: member.role,
    division: member.division,
    activeTaskCount: activeCount,
    workloadScore,
    skillScore,
    urgencyScore,
    availabilityScore,
    totalScore,
    reasons,
  };
}

// ─── GPT Explanation ─────────────────────────────────────────────────────────
async function generateGptExplanation(
  task: { title: string; category: string | null; priority: string; slaStatus: string; customerName?: string | null },
  top: CandidateScore,
  candidates: CandidateScore[],
): Promise<string> {
  const runnerUp = candidates[1];
  const prompt = `
Kamu adalah AI Dispatcher sistem freight forwarding & logistik. Jelaskan keputusan penugasan berikut dalam Bahasa Indonesia, maksimal 3 kalimat, ringkas dan profesional.

Task: "${task.title}"
Kategori: ${task.category ?? "Umum"}
Prioritas: ${task.priority}
Status SLA: ${task.slaStatus}
${task.customerName ? `Customer: ${task.customerName}` : ""}

Kandidat terpilih: ${top.memberName} (${top.role}${top.division ? `, ${top.division}` : ""})
Alasan utama sistem: ${top.reasons.slice(0, 2).join("; ")}
Skor total: ${top.totalScore.toFixed(0)}/100
${runnerUp ? `Runner-up: ${runnerUp.memberName} (skor ${runnerUp.totalScore.toFixed(0)})` : ""}

Tulis penjelasan singkat yang meyakinkan mengapa ${top.memberName} adalah pilihan terbaik untuk task ini.
`.trim();

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 180,
      temperature: 0.4,
    });
    return resp.choices[0]?.message?.content?.trim() ?? fallbackExplanation(top, task);
  } catch (err) {
    logger.warn({ err }, "GPT dispatcher explanation failed, using fallback");
    return fallbackExplanation(top, task);
  }
}

function fallbackExplanation(top: CandidateScore, task: { category: string | null; priority: string; slaStatus: string }): string {
  const parts: string[] = [];
  if (top.skillScore >= 25) parts.push(`${top.memberName} memiliki divisi/keahlian yang sesuai dengan kategori ${task.category ?? "task ini"}`);
  if (top.activeTaskCount === 0) parts.push("saat ini tidak memiliki task aktif");
  else if (top.activeTaskCount <= 2) parts.push(`workload ringan dengan ${top.activeTaskCount} task aktif`);
  if (task.slaStatus === "overdue" || task.slaStatus === "due_soon") parts.push("serta paling tersedia untuk menangani task yang mendesak");
  return parts.length > 0
    ? `${top.memberName} direkomendasikan karena ${parts.join(", ")}.`
    : `${top.memberName} memiliki skor tertinggi (${top.totalScore.toFixed(0)}/100) berdasarkan workload dan kecocokan skill.`;
}

// ─── Main: Suggest Assignment ────────────────────────────────────────────────
export async function suggestAssignment(taskId: number, companyId: string): Promise<DispatchSuggestion | null> {
  const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, taskId)).limit(1);
  if (!task) return null;

  const members = await db.select().from(teamMembersTable);
  if (members.length === 0) {
    return {
      taskId, taskTitle: task.title, taskCategory: task.category,
      taskPriority: task.priority, taskSlaStatus: task.slaStatus ?? "on_track",
      candidates: [], topCandidate: null,
      explanation: "Belum ada anggota tim yang terdaftar. Tambahkan anggota tim terlebih dahulu.",
      confidence: 0, fallbackMode: true,
    };
  }

  const workloadMap = await getWorkloadMap(companyId);
  const maxWorkload = Math.max(...Array.from(workloadMap.values()), 1);

  const scored = members.map((m) => {
    const activeCount = workloadMap.get(m.name.toLowerCase()) ?? 0;
    return scoreCandidate(
      { id: m.id, name: m.name, role: m.role, division: m.division },
      { category: task.category, priority: task.priority, slaStatus: task.slaStatus ?? "on_track" },
      activeCount,
      maxWorkload,
    );
  });

  scored.sort((a, b) => b.totalScore - a.totalScore);
  const topCandidate = scored[0] ?? null;

  let explanation = "Tidak ada kandidat tersedia.";
  if (topCandidate) {
    explanation = await generateGptExplanation(
      { title: task.title, category: task.category, priority: task.priority, slaStatus: task.slaStatus ?? "on_track", customerName: task.customerName },
      topCandidate,
      scored,
    );
  }

  const maxPossible = 100;
  const confidence = topCandidate ? Math.round((topCandidate.totalScore / maxPossible) * 100) : 0;

  return {
    taskId, taskTitle: task.title, taskCategory: task.category,
    taskPriority: task.priority, taskSlaStatus: task.slaStatus ?? "on_track",
    candidates: scored.slice(0, 5),
    topCandidate,
    explanation,
    confidence,
    fallbackMode: false,
  };
}

// ─── Team Workload Snapshot ───────────────────────────────────────────────────
export interface MemberWorkload {
  id: number;
  name: string;
  role: string;
  division: string | null;
  activeCount: number;
  overdueCount: number;
  dueSoonCount: number;
  status: "available" | "normal" | "busy" | "overloaded";
}

export async function getTeamWorkload(companyId: string): Promise<MemberWorkload[]> {
  const members = await db.select().from(teamMembersTable);
  const activeTasks = await db
    .select({
      assignedTo: aiTasksTable.assignedTo,
      slaStatus: aiTasksTable.slaStatus,
    })
    .from(aiTasksTable)
    .where(and(
      eq(aiTasksTable.companyId, companyId),
      ne(aiTasksTable.status, "completed"),
      ne(aiTasksTable.status, "cancelled"),
    ));

  return members.map((m) => {
    const myTasks = activeTasks.filter((t) => t.assignedTo?.toLowerCase() === m.name.toLowerCase());
    const activeCount = myTasks.length;
    const overdueCount = myTasks.filter((t) => t.slaStatus === "overdue").length;
    const dueSoonCount = myTasks.filter((t) => t.slaStatus === "due_soon").length;

    const status: MemberWorkload["status"] =
      activeCount === 0 ? "available"
      : activeCount <= 2 ? "normal"
      : activeCount <= 5 ? "busy"
      : "overloaded";

    return { id: m.id, name: m.name, role: m.role, division: m.division, activeCount, overdueCount, dueSoonCount, status };
  });
}
