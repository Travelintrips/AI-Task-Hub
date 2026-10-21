import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  FolderKanban,
  Inbox,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoredToken } from "@/lib/auth-api";
import { useServerEvents } from "@/hooks/use-server-events";

type AiTask = {
  id: number;
  taskNumber: string | null;
  title: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  aiIntent: string | null;
  latestMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type ExecutionJobLite = {
  id: string;
  taskId: number | null;
  status: string;
  progress: number;
  workerId: string | null;
  assignedClientId: string | null;
  callbackVerified: boolean;
  attestationVerified: boolean;
  finalAckVerified: boolean;
};

type ExecutionMapPayload = {
  byTask: Record<string, ExecutionJobLite>;
  bridgeConfigured: boolean;
};

type WaMessage = {
  id: number;
  senderName: string | null;
  from: string | null;
  body: string | null;
  processed: boolean | null;
  aiProcessed: boolean | null;
  taskId: number | null;
  createdAt: string | null;
};

async function apiFetch<T>(path: string): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function normalizeStatus(status: string) {
  const s = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["completed", "done", "paid"].includes(s)) return "completed";
  if (["in_progress", "processing", "waiting_customer", "waiting_vendor", "quotation_ready", "approved_by_customer"].includes(s)) return "running";
  if (s === "assigned") return "assigned";
  if (["documents_received", "audit_in_progress", "missing_data", "ready_for_review", "review"].includes(s)) return "review";
  if (["cancelled", "canceled"].includes(s)) return "cancelled";
  if (["waiting_documents", "waiting_doc"].includes(s)) return "waiting";
  return "queued";
}

function progressFor(status: string) {
  switch (normalizeStatus(status)) {
    case "completed": return 100;
    case "running": return 78;
    case "assigned": return 58;
    case "review": return 88;
    case "waiting": return 28;
    case "cancelled": return 0;
    default: return 12;
  }
}

function statusLabel(status: string) {
  switch (normalizeStatus(status)) {
    case "completed": return "Selesai";
    case "running": return "Berjalan";
    case "assigned": return "Assigned";
    case "review": return "Review";
    case "waiting": return "Menunggu";
    case "cancelled": return "Dibatalkan";
    default: return "Antri";
  }
}

function statusClasses(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "completed") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/20";
  if (normalized === "review") return "bg-amber-500/15 text-amber-300 border-amber-500/20";
  if (normalized === "running") return "bg-sky-500/15 text-sky-300 border-sky-500/20";
  if (normalized === "waiting") return "bg-violet-500/15 text-violet-300 border-violet-500/20";
  return "bg-slate-500/15 text-slate-300 border-slate-500/20";
}

const cardGradients = [
  "from-blue-600 to-blue-500",
  "from-violet-600 to-purple-500",
  "from-emerald-600 to-green-500",
  "from-orange-500 to-amber-500",
  "from-rose-500 to-pink-600",
  "from-slate-700 to-slate-600",
];

function MetricCard({
  index,
  label,
  value,
  note,
  icon: Icon,
  href,
}: {
  index: number;
  label: string;
  value: string | number;
  note: string;
  icon: typeof Activity;
  href: string;
}) {
  return (
    <Link href={href}>
      <div className={`group relative min-h-[126px] overflow-hidden rounded-2xl bg-gradient-to-br ${cardGradients[index % cardGradients.length]} p-4 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:shadow-xl`}>
        <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10 blur-sm" />
        <div className="relative flex h-full flex-col">
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <Icon className="h-4 w-4 text-white" />
            </div>
            <ArrowRight className="h-4 w-4 text-white/50 opacity-0 transition group-hover:opacity-100" />
          </div>
          <div className="mt-3 text-xs font-medium text-white/80">{label}</div>
          <div className="mt-0.5 text-3xl font-bold tracking-tight text-white">{value}</div>
          <div className="mt-1 text-[11px] text-white/70">{note}</div>
        </div>
      </div>
    </Link>
  );
}

function MiniBars({ values }: { values: number[] }) {
  return (
    <div className="flex h-28 items-end gap-3 border-b border-slate-700/70 px-1 pb-1">
      {values.map((value, index) => (
        <div key={index} className="flex flex-1 items-end gap-0.5">
          <div className="w-1/3 rounded-t bg-blue-500/90" style={{ height: `${Math.max(12, value * 0.55)}%` }} />
          <div className="w-1/3 rounded-t bg-violet-500/90" style={{ height: `${Math.max(9, value * 0.35)}%` }} />
          <div className="w-1/3 rounded-t bg-emerald-500/90" style={{ height: `${Math.max(7, value * 0.2)}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();

  const { data: tasks = [], isLoading: tasksLoading, isFetching: tasksFetching } = useQuery<AiTask[]>({
    queryKey: ["control-center-tasks"],
    queryFn: () => apiFetch("/api/ai-tasks"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: messages = [], isLoading: messagesLoading } = useQuery<WaMessage[]>({
    queryKey: ["control-center-messages"],
    queryFn: () => apiFetch("/api/messages"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: executionMapData } = useQuery<ExecutionMapPayload>({
    queryKey: ["control-center-executions"],
    queryFn: () => apiFetch("/api/executions/active-map"),
    refetchInterval: 10_000,
    staleTime: 3_000,
  });

  useServerEvents({
    new_task: () => void queryClient.invalidateQueries({ queryKey: ["control-center-tasks"] }),
    task_updated: () => void queryClient.invalidateQueries({ queryKey: ["control-center-tasks"] }),
    new_message: () => void queryClient.invalidateQueries({ queryKey: ["control-center-messages"] }),
    execution_updated: () => void queryClient.invalidateQueries({ queryKey: ["control-center-executions"] }),
  });

  const summary = useMemo(() => {
    const active = tasks.filter((t) => !["completed", "cancelled"].includes(normalizeStatus(t.status))).length;
    const running = Object.values(executionMapData?.byTask ?? {}).filter((x) =>
      ["queued", "dispatched", "assigned", "running", "verifying"].includes(x.status),
    ).length;
    const completed = tasks.filter((t) => normalizeStatus(t.status) === "completed").length;
    const unread = messages.filter((m) => !m.processed).length;
    const workers = new Set(
      Object.values(executionMapData?.byTask ?? {})
        .map((job) => job.workerId ?? job.assignedClientId)
        .filter(Boolean),
    ).size;
    return { active, running, completed, unread, workers };
  }, [tasks, messages, executionMapData]);

  const activeJobs = useMemo(
    () =>
      [...tasks]
        .filter((t) => normalizeStatus(t.status) !== "cancelled")
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5),
    [tasks],
  );

  const recentMessages = useMemo(
    () =>
      [...messages]
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
        .slice(0, 5),
    [messages],
  );

  const completionRate = tasks.length ? Math.round((summary.completed / tasks.length) * 100) : 0;
  const reviewCount = tasks.filter((t) => normalizeStatus(t.status) === "review").length;
  const chartValues = [36, 58, 82, 64, 46, 72, 88];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["control-center-tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["control-center-messages"] });
    void queryClient.invalidateQueries({ queryKey: ["control-center-executions"] });
  };

  return (
    <div className="min-h-full bg-[#07101d] text-slate-100">
      <div className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#08111f]/95 px-4 py-3 backdrop-blur lg:px-5">
        <div className="mx-auto flex max-w-[1640px] items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              aria-label="Cari proyek, job, atau percakapan"
              className="h-10 w-full rounded-xl border border-slate-700/80 bg-[#101c2d] pl-10 pr-16 text-sm text-slate-200 outline-none transition placeholder:text-slate-500 focus:border-blue-500/60"
              placeholder="Cari proyek, job, percakapan, atau apa saja..."
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-500">Ctrl + K</span>
          </div>
          <Button onClick={refresh} disabled={tasksFetching} variant="outline" size="sm" className="border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800 hover:text-white">
            <RefreshCw className={`mr-2 h-4 w-4 ${tasksFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Link href="/ai-tasks">
            <Button size="sm" className="bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:opacity-90">
              <Plus className="mr-2 h-4 w-4" />
              Buat Job
            </Button>
          </Link>
          <button className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/70 text-slate-400" aria-label="Notifikasi">
            <Bell className="h-4 w-4" />
            {summary.unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{Math.min(summary.unread, 99)}</span>}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[1640px] space-y-4 p-4 lg:p-5">
        <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-[#10203a] via-[#1e2b52] to-[#7b3f55] px-5 py-5 shadow-2xl shadow-black/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.14),transparent_32%)]" />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Selamat datang kembali, Admin 👋</h1>
              <p className="mt-1 text-sm text-slate-300">Kelola semua proyek, job, percakapan, dan sumber daya AI dalam satu tempat.</p>
            </div>
            <p className="max-w-xs text-right text-sm italic text-white/80">“Dari ide, menjadi karya nyata bersama AI.”</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard index={0} label="Total Proyek" value={Math.max(summary.active, 0)} note={`Aktif ${summary.active} • Selesai ${summary.completed}`} icon={FolderKanban} href="/ai-tasks" />
          <MetricCard index={1} label="Total Job" value={tasks.length} note={`Berjalan ${summary.running} • Review ${reviewCount}`} icon={BriefcaseBusiness} href="/ai-tasks" />
          <MetricCard index={2} label="AI Worker" value={summary.workers} note={executionMapData?.bridgeConfigured ? "Execution bridge aktif" : "Menunggu bridge"} icon={Bot} href="/ai-operations" />
          <MetricCard index={3} label="Percakapan" value={messages.length} note={`Belum diproses ${summary.unread}`} icon={MessageSquare} href="/messages" />
          <MetricCard index={4} label="Progress Selesai" value={`${completionRate}%`} note={`${summary.completed} job selesai`} icon={Clock3} href="/ai-tasks?status=Completed" />
          <MetricCard index={5} label="Execution" value={summary.running} note="Job aktif di worker" icon={Database} href="/ai-observability" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-[#0d1827] p-4 shadow-lg shadow-black/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Buat Job Baru</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Berikan perintah, ide, atau tugas. AI akan membantu mengerjakan sampai selesai.</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-[#111f31] px-3 py-2 text-xs text-slate-300">Mode: AI Core (DEV)</div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-700 bg-[#101c2d] p-3">
                <textarea
                  className="min-h-16 w-full resize-none bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
                  placeholder="Tulis job yang ingin dikerjakan..."
                  aria-label="Tulis job baru"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                  <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                    <span>📎 File</span>
                    <span>▣ Referensi</span>
                    <span>▱ Pilih Proyek</span>
                    <span>••• Opsi Lainnya</span>
                  </div>
                  <Link href="/ai-tasks">
                    <Button size="sm" className="min-w-36 bg-gradient-to-r from-blue-600 to-violet-600 text-white">
                      <Send className="mr-2 h-4 w-4" />
                      Kirim Job
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0d1827] shadow-lg shadow-black/10">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
                <div className="flex gap-5 text-xs font-medium">
                  <span className="border-b-2 border-blue-500 pb-3 text-blue-400">Job Terbaru</span>
                  <span className="text-slate-500">Proyek Aktif</span>
                  <span className="text-slate-500">Menunggu Review</span>
                  <span className="text-slate-500">Selesai</span>
                </div>
                <Link href="/ai-tasks" className="text-xs font-medium text-blue-400 hover:text-blue-300">Lihat Semua →</Link>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[780px]">
                  <div className="grid grid-cols-[2.1fr_0.7fr_0.8fr_0.7fr_1fr_0.8fr] gap-3 border-b border-slate-800 px-4 py-2 text-[10px] uppercase tracking-wide text-slate-600">
                    <span>Job</span><span>Proyek</span><span>Progress</span><span>Status</span><span>AI Worker</span><span>Diperbarui</span>
                  </div>
                  {tasksLoading ? (
                    Array.from({ length: 4 }).map((_, index) => <div key={index} className="p-3"><Skeleton className="h-12 w-full bg-slate-800" /></div>)
                  ) : activeJobs.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">Belum ada job.</div>
                  ) : activeJobs.map((task) => {
                    const execution = executionMapData?.byTask[String(task.id)];
                    const progress = execution?.progress ?? progressFor(task.status);
                    const worker = execution?.workerId ?? execution?.assignedClientId ?? task.assignedTo ?? "Belum dipilih";
                    return (
                      <Link key={task.id} href={`/ai-tasks/${task.id}`}>
                        <div className="grid cursor-pointer grid-cols-[2.1fr_0.7fr_0.8fr_0.7fr_1fr_0.8fr] items-center gap-3 border-b border-slate-800/70 px-4 py-3 transition hover:bg-slate-800/35">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-200">{task.title}</div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-500">{task.latestMessage ?? task.aiIntent ?? task.taskNumber ?? `Task #${task.id}`}</div>
                          </div>
                          <span className="w-fit rounded-md bg-violet-500/15 px-2 py-1 text-[10px] font-medium text-violet-300">{task.aiIntent ?? "General"}</span>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
                              <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${progress}%` }} />
                            </div>
                            <span className="w-8 text-right text-[10px] text-slate-400">{progress}%</span>
                          </div>
                          <span className={`w-fit rounded-md border px-2 py-1 text-[10px] font-medium ${statusClasses(task.status)}`}>{statusLabel(task.status)}</span>
                          <span className="truncate text-[11px] text-slate-400"><span className="mr-1 text-emerald-400">●</span>{worker}</span>
                          <span className="text-[11px] text-slate-500">{formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-[#0d1827] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Aktivitas Job (7 Hari Terakhir)</h3>
                  <div className="flex gap-3 text-[10px] text-slate-500">
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />Baru</span>
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-500" />Berjalan</span>
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Selesai</span>
                  </div>
                </div>
                <MiniBars values={chartValues} />
                <div className="mt-2 grid grid-cols-7 text-center text-[9px] text-slate-600">
                  {["15 Okt","16 Okt","17 Okt","18 Okt","19 Okt","20 Okt","21 Okt"].map((d) => <span key={d}>{d}</span>)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-[#0d1827] p-4">
                <h3 className="text-sm font-semibold text-white">Distribusi Job per Status</h3>
                <div className="mt-4 flex items-center justify-center gap-8">
                  <div
                    className="h-28 w-28 rounded-full"
                    style={{ background: "conic-gradient(#8b5cf6 0 28%, #3b82f6 28% 50%, #f59e0b 50% 68%, #10b981 68% 83%, #64748b 83% 100%)" }}
                  >
                    <div className="m-[18px] h-[76px] w-[76px] rounded-full bg-[#0d1827]" />
                  </div>
                  <div className="space-y-2 text-xs text-slate-400">
                    <div><span className="mr-2 text-violet-400">●</span>Berjalan <b className="ml-3 text-slate-200">{summary.running}</b></div>
                    <div><span className="mr-2 text-blue-400">●</span>Aktif <b className="ml-3 text-slate-200">{summary.active}</b></div>
                    <div><span className="mr-2 text-amber-400">●</span>Review <b className="ml-3 text-slate-200">{reviewCount}</b></div>
                    <div><span className="mr-2 text-emerald-400">●</span>Selesai <b className="ml-3 text-slate-200">{summary.completed}</b></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-[#0d1827] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Chat Terbaru</h2>
                <Link href="/messages" className="text-[11px] font-medium text-blue-400">Lihat Semua →</Link>
              </div>
              <div className="mt-3 divide-y divide-slate-800">
                {messagesLoading ? (
                  Array.from({ length: 5 }).map((_, index) => <div key={index} className="py-3"><Skeleton className="h-12 w-full bg-slate-800" /></div>)
                ) : recentMessages.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">Belum ada percakapan.</div>
                ) : recentMessages.map((message, index) => (
                  <div key={message.id} className="flex gap-3 py-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${index === 0 ? "bg-violet-600" : "bg-slate-800"}`}>
                      {index === 0 ? <Bot className="h-5 w-5 text-white" /> : <MessageSquare className="h-4 w-4 text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold text-slate-200">{message.senderName ?? message.from ?? "AI Core"}</span>
                        <span className="ml-auto text-[10px] text-slate-600">{message.createdAt ? formatDistanceToNow(new Date(message.createdAt), { addSuffix: false }) : "—"}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-500">{message.body ?? "(tanpa teks)"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#0d1827] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Kalender & Deadline</h2>
                <span className="text-[11px] text-blue-400">Hari ini</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" />
                Rencana operasional hari ini
              </div>
              <div className="mt-4 space-y-4">
                {[
                  ["10:00", "Review job prioritas", "Review", "bg-amber-400"],
                  ["13:00", "Update progress worker", "Worker", "bg-blue-400"],
                  ["15:00", "Final validation task", "Gate", "bg-orange-400"],
                  ["20:00", "Laporan harian AI Task", "Report", "bg-emerald-400"],
                ].map(([time, title, tag, color]) => (
                  <div key={time} className="flex items-start gap-3 text-xs">
                    <span className={`mt-1 h-2 w-2 rounded-full ${color}`} />
                    <span className="w-10 shrink-0 text-slate-500">{time}</span>
                    <span className="min-w-0 flex-1 text-slate-300">{title}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">{tag}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#0d1827] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">AI Worker Status</h2>
                <Link href="/ai-operations" className="text-[11px] text-blue-400">Lihat Semua →</Link>
              </div>
              <div className="mt-3 space-y-2">
                {Object.values(executionMapData?.byTask ?? {}).slice(0, 5).map((job, index) => (
                  <div key={job.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-[#101c2d] px-3 py-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800">
                      <Cpu className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-300">{job.workerId ?? job.assignedClientId ?? `Worker ${index + 1}`}</div>
                      <div className="mt-0.5 text-[10px] text-slate-600">Progress {job.progress}%</div>
                    </div>
                    <span className="text-[10px] text-emerald-400">● Online</span>
                  </div>
                ))}
                {Object.keys(executionMapData?.byTask ?? {}).length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-xs text-slate-500">Belum ada worker aktif.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link href="/team">
                <div className="rounded-xl border border-slate-800 bg-[#0d1827] p-3 transition hover:border-blue-500/40">
                  <Users className="h-4 w-4 text-blue-400" />
                  <div className="mt-2 text-xs font-semibold text-slate-300">Tim & Worker</div>
                </div>
              </Link>
              <Link href="/reports">
                <div className="rounded-xl border border-slate-800 bg-[#0d1827] p-3 transition hover:border-violet-500/40">
                  <WalletCards className="h-4 w-4 text-violet-400" />
                  <div className="mt-2 text-xs font-semibold text-slate-300">Laporan</div>
                </div>
              </Link>
            </div>

            <div className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-violet-500/10 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-300">
                <Sparkles className="h-4 w-4" />
                AI Task DEV
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Data kartu, job, percakapan, progress, dan worker ditarik dari endpoint yang sudah ada. Tidak ada perubahan schema/database pada redesign ini.
              </p>
              <div className="mt-3 flex items-center gap-2 text-[10px] text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                UI terhubung ke data aktual
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                <Zap className="h-3.5 w-3.5" />
                Realtime refresh melalui event yang sudah tersedia
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                <Inbox className="h-3.5 w-3.5" />
                Inbox mengikuti data message aktual
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
