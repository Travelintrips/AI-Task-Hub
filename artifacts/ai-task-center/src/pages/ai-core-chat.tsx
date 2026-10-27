import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStoredToken } from "@/lib/auth-api";
import { useServerEvents } from "@/hooks/use-server-events";

type AiTask = {
  id: number;
  taskNumber: string | null;
  title: string;
  description: string | null;
  status: string;
  updatedAt: string;
};

type ExecutionEvent = {
  id: string;
  eventType: string;
  status: string | null;
  message: string | null;
  createdAt: string;
};

type Execution = {
  id: string;
  taskId: number | null;
  status: string;
  progress: number;
  workerId: string | null;
  assignedClientId: string | null;
  callbackVerified: boolean;
  attestationVerified: boolean;
  finalAckVerified: boolean;
  resultSummary: string | null;
  errorMessage: string | null;
};

type ExecutionPayload = {
  execution: Execution | null;
  events: ExecutionEvent[];
  bridgeConfigured: boolean;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body.message === "string" ? body.message :
      body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (clean.length <= 72) return clean;
  return `${clean.slice(0, 69)}...`;
}

function eventTone(event: ExecutionEvent) {
  const kind = event.eventType.toUpperCase();
  if (kind.includes("FAILED") || kind.includes("BLOCKER")) return "border-red-500/20 bg-red-500/10";
  if (kind.includes("COMPLETED")) return "border-emerald-500/20 bg-emerald-500/10";
  if (kind.includes("PROGRESS") || kind.includes("CHECKPOINT")) return "border-blue-500/20 bg-blue-500/10";
  return "border-slate-700 bg-slate-900/60";
}

const wib = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date) + " WIB";
};
const duration = (start: string, end: string) => {
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return (hours ? hours + "j " : "") + (minutes ? minutes + "m " : "") + rest + "d";
};

export default function AiCoreChatPage() {
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [accountAlias, setAccountAlias] = useState(() => localStorage.getItem("ai-task-chat-account") || "GPT02");

  const sseState = useServerEvents({
    new_task: () => void queryClient.invalidateQueries({ queryKey: ["ai-core-chat-tasks"] }),
    execution_updated: (event) => {
      const eventTaskId = typeof event.taskId === "number" ? event.taskId : Number(event.taskId);
      if (activeTaskId && eventTaskId === activeTaskId) {
        void queryClient.invalidateQueries({ queryKey: ["ai-core-chat-execution", activeTaskId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["ai-core-chat-tasks"] });
    },
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<AiTask[]>({
    queryKey: ["ai-core-chat-tasks"],
    queryFn: () => apiFetch("/api/ai-tasks?category=ai_chat"),
    refetchInterval: sseState === "connected" ? false : 30_000,
    staleTime: 5_000,
  });

  const { data: executionData, isFetching: executionRefreshing } = useQuery<ExecutionPayload>({
    queryKey: ["ai-core-chat-execution", activeTaskId],
    queryFn: () => apiFetch(`/api/ai-tasks/${activeTaskId}/execution`),
    enabled: Boolean(activeTaskId),
    refetchInterval: (query) => {
      const payload = query.state.data as ExecutionPayload | undefined;
      const status = payload?.execution?.status;
      if (status && ["completed", "failed", "blocked", "cancelled"].includes(status)) return false;
      // SSE can miss events across reconnects; reconcile active executions periodically.
      return sseState === "connected" ? 15_000 : 15_000;
    },
    staleTime: 1_000,
  });

  const recentTasks = useMemo(
    () => [...tasks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 30),
    [tasks],
  );

  const activeTask = useMemo(
    () => recentTasks.find((task) => task.id === activeTaskId) ?? null,
    [recentTasks, activeTaskId],
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      const instruction = prompt.trim();
      if (!instruction) throw new Error("Tulis pesan terlebih dahulu.");
      // Resume the selected job, never create an orphan chat task for continuation.
      // The server derives the next step only from AI Core signed checkpoint evidence.
      const isContinuation = /\bCONTINUE_JOB\b/i.test(instruction) ||
        /^(?:lanjut(?:kan)?(?: terus)?|continue(?: job)?|resume)[!.\s]*$/i.test(instruction);
      if (isContinuation) {
        if (!activeTaskId || !activeTask || !executionData?.execution?.id) {
          throw new Error("Pilih percakapan dengan job asal sebelum melanjutkan.");
        }
        await apiFetch(`/api/ai-tasks/${activeTaskId}/continue`, {
          method: "POST",
          body: JSON.stringify({ sourceExecutionId: executionData.execution.id }),
        });
        return activeTask;
      }

      const created = await apiFetch<AiTask>("/api/ai-tasks", {
        method: "POST",
        body: JSON.stringify({
          title: titleFromPrompt(instruction),
          description: instruction,
          category: "ai_chat",
          priority: "medium",
          status: "new_inquiry",
        }),
      });

      await apiFetch(`/api/ai-tasks/${created.id}/execution`, {
        method: "POST",
        body: JSON.stringify({
          mode: "chatgpt",
          accountAlias,
          instruction,
        }),
      });

      return created;
    },
    onSuccess: (created) => {
      setActiveTaskId(created.id);
      setPrompt("");
      localStorage.setItem("ai-task-chat-account", accountAlias);
      void queryClient.invalidateQueries({ queryKey: ["ai-core-chat-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-core-chat-execution", created.id] });
    },
  });

  const execution = executionData?.execution ?? null;
  const verified =
    Boolean(execution?.callbackVerified) &&
    Boolean(execution?.attestationVerified) &&
    Boolean(execution?.finalAckVerified);

  return (
    <div className="flex min-h-full bg-[#07101d] text-slate-100">
      <aside className="hidden w-72 shrink-0 border-r border-slate-800 bg-[#08111f] lg:flex lg:flex-col">
        <div className="border-b border-slate-800 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <MessageSquare className="h-4 w-4 text-blue-400" />
            Percakapan AI Core
          </div>
          <p className="mt-1 text-xs text-slate-500">Setiap pesan menjadi job yang dapat diaudit dan dipantau.</p>
        </div>
        <div className="flex-1 space-y-1 overflow-auto p-2">
          {tasksLoading ? (
            <div className="p-4 text-xs text-slate-500">Memuat percakapan...</div>
          ) : recentTasks.length === 0 ? (
            <div className="p-4 text-xs text-slate-500">Belum ada percakapan AI Core.</div>
          ) : (
            recentTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => setActiveTaskId(task.id)}
                className={`w-full rounded-xl px-3 py-3 text-left transition ${
                  activeTaskId === task.id
                    ? "bg-blue-600/15 text-blue-200"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                <div className="truncate text-xs font-semibold">{task.title}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-600">
                  <span>{task.taskNumber ?? `Task #${task.id}`}</span>
                  <span>{formatDistanceToNow(new Date(task.updatedAt), { addSuffix: false })}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-slate-800 bg-[#08111f]/95 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-violet-400" />
                <h1 className="text-lg font-bold text-white">Chat & AI Core</h1>
              </div>
              <p className="mt-1 text-xs text-slate-500">AI Task → AI Core → OpenClaw/ChatGPT → callback → AI Task</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={accountAlias}
                onChange={(event) => setAccountAlias(event.target.value)}
                className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300 outline-none"
                aria-label="Pilih akun ChatGPT"
              >
                <option value="GPT01">GPT01</option>
                <option value="GPT02">GPT02</option>
              </select>
              <div className={`rounded-lg border px-3 py-2 text-xs ${
                executionData?.bridgeConfigured === false
                  ? "border-red-500/20 bg-red-500/10 text-red-300"
                  : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              }`}>
                {executionData?.bridgeConfigured === false ? "Bridge tidak siap" : "AI Core DEV siap"}
              </div>
              <div className={`rounded-lg border px-3 py-2 text-xs ${
                sseState === "connected"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : sseState === "connecting"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                    : "border-slate-700 bg-slate-900 text-slate-400"
              }`}>
                {sseState === "connected" ? "Live SSE" : sseState === "connecting" ? "SSE menghubungkan" : "Fallback polling"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 lg:p-6">
          {!activeTask ? (
            <div className="mx-auto flex min-h-[55vh] max-w-2xl flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 shadow-xl shadow-blue-900/20">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <h2 className="mt-5 text-xl font-bold text-white">Mulai percakapan dengan AI Core</h2>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500">
                Pesan akan dibuat sebagai job AI Task, dikirim ke AI Core DEV, dan progress aktual akan kembali ke halaman ini.
              </p>
              <div className="mt-6 grid w-full max-w-xl gap-3 sm:grid-cols-3">
                {[
                  ["Buat pekerjaan", "Kirim instruksi baru ke AI Core."],
                  ["Pantau progress", "Lihat worker, status, dan checkpoint."],
                  ["Verifikasi hasil", "Callback, Ed25519, dan final ACK terlihat."],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-xl border border-slate-800 bg-[#0d1827] p-3 text-left">
                    <div className="text-xs font-semibold text-slate-300">{title}</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-600">{body}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-4">
              <div className="flex justify-end">
                <div className="max-w-[78%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 shadow-lg shadow-blue-950/20">
                  <div className="flex items-center gap-2 text-[10px] font-medium text-blue-100">
                    <User className="h-3 w-3" />
                    Anda
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white">
                    {activeTask.description ?? activeTask.title}
                  </p>
                </div>
              </div>

              {execution && (
                <div className="flex justify-start">
                  <div className="w-full max-w-[82%] rounded-2xl rounded-bl-md border border-blue-500/20 bg-[#101c2d] p-4" aria-live="polite">
                    <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-100">
                      <span className="flex items-center gap-2">
                        {execution.status === "completed"
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          : ["failed", "blocked", "cancelled"].includes(execution.status)
                            ? <span className="text-red-400" aria-label="Job terhenti">●</span>
                            : <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
                        Job: {execution.status}
                      </span>
                      <span className="tabular-nums text-blue-300">{Math.max(0, Math.min(100, execution.progress))}%</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={Math.max(0, Math.min(100, execution.progress))} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, execution.progress))}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>Worker: {execution.workerId ?? execution.assignedClientId ?? "menunggu assignment"}</span>
                      <span>{executionData?.events?.length ?? 0} aktivitas</span>
                    </div>
                    {executionData?.events?.length ? (
                      <p className="mt-2 text-xs text-slate-300">Terakhir: {executionData.events[executionData.events.length - 1]?.message ?? executionData.events[executionData.events.length - 1]?.eventType}</p>
                    ) : null}
                    {verified && execution.status === "completed" && <p className="mt-2 flex items-center gap-1 text-xs text-emerald-400"><ShieldCheck className="h-3.5 w-3.5" /> Callback, attestation, dan final ACK terverifikasi</p>}
                    {executionRefreshing && <span className="mt-2 block text-xs text-slate-500">Memperbarui status…</span>}
                  </div>
                </div>
              )}

              {executionData?.events?.map((event, index, events) => (
                <div key={event.id} className="flex justify-start">
                  <div className={`max-w-[82%] rounded-2xl rounded-bl-md border px-4 py-3 ${eventTone(event)}`}>
                    <div className="flex items-center gap-2 text-[10px] font-medium text-slate-400">
                      <Bot className="h-3 w-3 text-violet-400" />
                      AI Core · {event.eventType}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] tabular-nums text-slate-400">
                      <span title={event.createdAt}>{wib(event.createdAt)}</span>
                      {index > 0 && <span>Sejak tahap sebelumnya: {duration(events[index - 1].createdAt, event.createdAt)}</span>}
                      {index > 0 && <span>Total: {duration(events[0].createdAt, event.createdAt)}</span>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                      {event.message || event.status || "Update diterima"}
                    </p>
                  </div>
                </div>
              ))}

              {execution?.resultSummary && (
                <div className="flex justify-start">
                  <div className="max-w-[82%] rounded-2xl rounded-bl-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-medium text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      Hasil akhir
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{execution.resultSummary}</p>
                  </div>
                </div>
              )}

              {execution?.errorMessage && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                  {execution.errorMessage}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 bg-[#08111f] p-4 lg:px-6">
          <div className="mx-auto max-w-4xl">
            {execution && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {execution.status}</span>
                <span>{execution.progress}%</span>
                {executionData?.events?.length ? <span className="tabular-nums">Durasi {duration(executionData.events[0].createdAt, ["completed", "failed", "blocked", "cancelled"].includes(execution.status.toLowerCase()) ? executionData.events[executionData.events.length - 1].createdAt : new Date(clockNow).toISOString())}</span> : null}
                <span>{execution.workerId ?? execution.assignedClientId ?? "worker belum dipilih"}</span>
                {verified && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    callback + attestation + final ACK terverifikasi
                  </span>
                )}
                {executionRefreshing && <RefreshCw className="h-3 w-3 animate-spin" />}
              </div>
            )}

            <div className="rounded-2xl border border-slate-700 bg-[#101c2d] p-3">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (!sendMutation.isPending && prompt.trim()) sendMutation.mutate();
                  }
                }}
                className="min-h-20 w-full resize-none bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                placeholder="Ketik perintah untuk AI Core..."
                aria-label="Pesan ke AI Core"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                <div className="flex items-center gap-2 text-[11px] text-slate-600">
                  <Zap className="h-3.5 w-3.5" />
                  Enter untuk kirim · Shift+Enter untuk baris baru
                </div>
                <Button
                  onClick={() => sendMutation.mutate()}
                  disabled={!prompt.trim() || sendMutation.isPending}
                  className="min-w-32 bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                >
                  {sendMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mengirim</>
                  ) : (
                    <><Send className="mr-2 h-4 w-4" /> Kirim</>
                  )}
                </Button>
              </div>
            </div>

            {sendMutation.error && (
              <div className="mt-2 text-xs text-red-400">
                {sendMutation.error instanceof Error ? sendMutation.error.message : "Gagal mengirim ke AI Core."}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
