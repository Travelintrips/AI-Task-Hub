import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock3,
  Cpu,
  Inbox,
  ListChecks,
  MessageSquare,
  Network,
  Radio,
  RefreshCw,
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
    case "running": return 80;
    case "assigned": return 60;
    case "review": return 45;
    case "waiting": return 25;
    case "cancelled": return 0;
    default: return 10;
  }
}

function stageLabel(status: string) {
  switch (normalizeStatus(status)) {
    case "completed": return "Completed";
    case "running": return "Running";
    case "assigned": return "Assigned";
    case "review": return "Review";
    case "waiting": return "Waiting";
    case "cancelled": return "Cancelled";
    default: return "Queued";
  }
}

function StatCard({
  label,
  value,
  note,
  icon: Icon,
  href,
}: {
  label: string;
  value: number | string;
  note: string;
  icon: typeof Activity;
  href: string;
}) {
  return (
    <Link href={href}>
      <div
        className="group cursor-pointer rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
        role="link"
        aria-label={`${label}: ${value}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 group-hover:text-blue-700">{label}</span>
          <Icon className="h-4 w-4 text-gray-400 transition-colors group-hover:text-blue-600" />
        </div>
        <div className="mt-3 text-3xl font-bold tabular-nums text-gray-950">{value}</div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">{note}</p>
          <ArrowUpRight className="h-3.5 w-3.5 text-gray-300 transition-colors group-hover:text-blue-600" />
        </div>
      </div>
    </Link>
  );
}

function PipelineStep({
  label,
  value,
  detail,
  active,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  active?: boolean;
  href: string;
}) {
  return (
    <Link href={href}>
      <div
        className={`group cursor-pointer rounded-xl border p-3 transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm ${active ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-gray-50"}`}
        role="link"
        aria-label={`${label}: ${value}`}
      >
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-blue-500" : "bg-gray-300"}`} />
          <span className="text-xs font-semibold text-gray-700 group-hover:text-blue-700">{label}</span>
          <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-gray-300 transition-colors group-hover:text-blue-600" />
        </div>
        <div className="mt-2 text-sm font-semibold text-gray-900">{value}</div>
        <p className="mt-1 text-[11px] leading-snug text-gray-500">{detail}</p>
      </div>
    </Link>
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

  useServerEvents({
    new_task: () => void queryClient.invalidateQueries({ queryKey: ["control-center-tasks"] }),
    task_updated: () => void queryClient.invalidateQueries({ queryKey: ["control-center-tasks"] }),
    new_message: () => void queryClient.invalidateQueries({ queryKey: ["control-center-messages"] }),
  });

  const summary = useMemo(() => {
    const active = tasks.filter((t) => !["completed", "cancelled"].includes(normalizeStatus(t.status))).length;
    const running = tasks.filter((t) => normalizeStatus(t.status) === "running").length;
    const assigned = tasks.filter((t) => !!t.assignedTo).length;
    const completed = tasks.filter((t) => normalizeStatus(t.status) === "completed").length;
    const unread = messages.filter((m) => !m.processed).length;
    return { active, running, assigned, completed, unread };
  }, [tasks, messages]);

  const activeJobs = useMemo(
    () =>
      [...tasks]
        .filter((t) => !["completed", "cancelled"].includes(normalizeStatus(t.status)))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 8),
    [tasks],
  );

  const recentMessages = useMemo(
    () =>
      [...messages]
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
        .slice(0, 5),
    [messages],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["control-center-tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["control-center-messages"] });
  };

  return (
    <div className="min-h-full bg-[#f6f7fb] p-4 lg:p-6">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                <Radio className="h-3.5 w-3.5" />
                AI Task Control Center
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">Operations & Execution Workspace</h1>
              <p className="mt-1 max-w-3xl text-sm text-gray-500">
                Satu halaman untuk melihat job aktif, percakapan masuk, assignment, dan progress lifecycle task.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/ai-tasks">
                <Button size="sm" className="gap-2">
                  <ListChecks className="h-4 w-4" />
                  Semua Job
                </Button>
              </Link>
              <Link href="/messages">
                <Button size="sm" variant="outline" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Messages
                </Button>
              </Link>
              <Button size="sm" variant="outline" className="gap-2" onClick={refresh} disabled={tasksFetching}>
                <RefreshCw className={`h-4 w-4 ${tasksFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Active Jobs" value={summary.active} note="Belum terminal" icon={Activity} href="/ai-tasks?view=active" />
          <StatCard label="Running" value={summary.running} note="Sedang dikerjakan" icon={Zap} href="/ai-tasks?status=In%20Progress" />
          <StatCard label="Assigned" value={summary.assigned} note="Punya assignee" icon={Cpu} href="/ai-tasks?status=Assigned" />
          <StatCard label="Completed" value={summary.completed} note="Task selesai" icon={CheckCircle2} href="/ai-tasks?status=Completed" />
          <StatCard label="Inbox" value={summary.unread} note="Belum diproses" icon={Inbox} href="/messages?filter=unread" />
          <StatCard label="Total Tasks" value={tasks.length} note="Data task aktif" icon={Network} href="/ai-tasks" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Active Jobs</h2>
                <p className="mt-0.5 text-xs text-gray-500">Job terbaru berdasarkan update terakhir.</p>
              </div>
              <Link href="/ai-tasks" className="text-xs font-medium text-blue-600 hover:underline">
                Buka board <ArrowUpRight className="inline h-3 w-3" />
              </Link>
            </div>

            <div className="divide-y divide-gray-100">
              {tasksLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-4">
                    <Skeleton className="h-16 w-full rounded-xl" />
                  </div>
                ))
              ) : activeJobs.length === 0 ? (
                <div className="p-10 text-center text-sm text-gray-400">Tidak ada job aktif.</div>
              ) : (
                activeJobs.map((task) => {
                  const pct = progressFor(task.status);
                  return (
                    <Link key={task.id} href={`/ai-tasks/${task.id}`}>
                      <div className="cursor-pointer px-5 py-4 transition-colors hover:bg-gray-50">
                        <div className="flex items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] text-blue-600">{task.taskNumber ?? `#${task.id}`}</span>
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                                {stageLabel(task.status)}
                              </span>
                              {task.priority && (
                                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{task.priority}</span>
                              )}
                            </div>
                            <h3 className="mt-1 truncate text-sm font-semibold text-gray-900">{task.title}</h3>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                              <span>Worker/Assignee: {task.assignedTo ?? "Belum dipilih"}</span>
                              <span>Intent: {task.aiIntent ?? "—"}</span>
                              <span>{formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}</span>
                            </div>
                            <div className="mt-3 flex items-center gap-3">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                                <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-gray-500">{pct}%</span>
                            </div>
                          </div>
                          <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" />
                        </div>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-gray-900">Execution Pipeline</h2>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Ringkasan lifecycle task. Evidence callback/ACK tetap harus berasal dari event integrasi yang terverifikasi.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <PipelineStep label="1. Intake" value={`${tasks.length} tasks`} detail="Job masuk ke AI Task." active href="/ai-tasks" />
                <PipelineStep label="2. Assign" value={`${summary.assigned} assigned`} detail="Worker/assignee dipilih." active={summary.assigned > 0} href="/ai-tasks?status=Assigned" />
                <PipelineStep label="3. Execute" value={`${summary.running} running`} detail="Pekerjaan sedang berlangsung." active={summary.running > 0} href="/ai-tasks?status=In%20Progress" />
                <PipelineStep label="4. Verify" value="Task evidence" detail="Review, audit, callback, atau ACK bila tersedia." href="/ai-tasks?status=Ready%20for%20Review" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link href="/ai-operations">
                  <Button variant="outline" size="sm" className="w-full gap-2">
                    <Cpu className="h-3.5 w-3.5" />
                    AI Operations
                  </Button>
                </Link>
                <Link href="/ai-observability">
                  <Button variant="outline" size="sm" className="w-full gap-2">
                    <Activity className="h-3.5 w-3.5" />
                    Observability
                  </Button>
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Live Inbox</h2>
                  <p className="text-xs text-gray-500">Pesan terbaru yang masuk.</p>
                </div>
                <Link href="/messages" className="text-xs font-medium text-blue-600 hover:underline">Lihat semua</Link>
              </div>
              <div className="divide-y divide-gray-100">
                {messagesLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4"><Skeleton className="h-12 w-full" /></div>
                  ))
                ) : recentMessages.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">Belum ada pesan.</div>
                ) : (
                  recentMessages.map((msg) => (
                    <div key={msg.id} className="px-5 py-3.5">
                      <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100">
                          <MessageSquare className="h-3.5 w-3.5 text-green-700" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-semibold text-gray-800">{msg.senderName ?? msg.from ?? "Unknown"}</span>
                            {!msg.processed && <span className="h-2 w-2 rounded-full bg-amber-500" />}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{msg.body ?? "(tanpa teks)"}</p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                            <Clock3 className="h-3 w-3" />
                            {msg.createdAt ? formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true }) : "—"}
                            {msg.aiProcessed && <span>• AI processed</span>}
                            {msg.taskId && <span>• Task #{msg.taskId}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="text-xs font-semibold text-amber-900">Execution evidence</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                    Dashboard tidak menganggap worker callback, attestation, atau final ACK berhasil hanya dari status task.
                    Evidence tersebut harus berasal dari integrasi AI Core/OpenClaw yang terverifikasi.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
