import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";
import { OnboardingBanner } from "@/components/onboarding-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Search, Plus, ChevronDown, ChevronUp, ClipboardList, Network, Info } from "lucide-react";

type AiTask = {
  id: number; taskNumber: string | null; title: string; status: string;
  source?: string; assignedTo: string | null; customerName: string | null;
  companyId: string | null; priority: string; description: string | null;
  createdAt: string; updatedAt: string;
};
type BridgeJob = {
  id: string; source: string; external_id: string; title: string; status: string;
  owner: string | null; created_at: string; updated_at: string;
  callback_received_at: string | null; result_verified_at: string | null;
};
type Session = {
  source: string; session_id: string; state: string; owner: string | null;
  job_id: string | null; last_seen_at: string; heartbeat_recent: boolean;
};
type JobEvent = { event_id: string; kind: string; sender: string; received_at: string };
type SourceFilter = "all" | "task" | "bridge" | "session";
type StatusFilter = "all" | "new" | "running" | "completed" | "attention";

type WorkRow = {
  key: string; kind: "task" | "bridge"; rawId: string;
  title: string; sourceLabel: string; sourceType: string;
  owner: string; status: string; bucket: Exclude<StatusFilter, "all">;
  date: string; ack: boolean; task?: AiTask; job?: BridgeJob;
};
const stamp = (utc: string | null) => {
  if (!utc) return "—";
  const parsed = new Date(utc);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(parsed) + " WIB" : "—";
};

function bucket(status: string): Exclude<StatusFilter, "all"> {
  const normalized = status.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (["completed", "done", "paid"].includes(normalized)) return "completed";
  if (["failed", "blocked", "suspected_stall", "error"].includes(normalized)) return "attention";
  if (["running", "in_progress", "processing", "assigned", "waiting_for_ack", "claimed"].includes(normalized)) return "running";
  return "new";
}
const badgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  const type = bucket(status);
  return type === "attention" ? "destructive" :
    type === "completed" ? "default" : type === "running" ? "outline" : "secondary";
};
async function getJson<T>(endpoint: string): Promise<T> {
  const token = getStoredToken();
  const result = await fetch(endpoint, { headers: token ? { Authorization: "Bearer " + token } : {} });
  if (!result.ok) throw new Error("HTTP " + result.status);
  return result.json() as Promise<T>;
}

export default function UnifiedDashboard() {
  const { user } = useAuth();
  const canSeeBridge = user?.role === "super_admin";
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [openedJob, setOpenedJob] = useState<string | null>(null);
  const [openedSession, setOpenedSession] = useState<string | null>(null);
  const activeBridgeId = openedJob?.startsWith("bridge:") ? openedJob.slice("bridge:".length) : null;

  // Read both sources directly. Never create a mirror task or modify original records.
  const tasks = useQuery({
    queryKey: ["unified-dashboard", "ai-tasks"],
    queryFn: () => getJson<AiTask[]>("/api/ai-tasks"),
    retry: false, refetchInterval: false, refetchOnWindowFocus: false,
  });
  const bridge = useQuery({
    queryKey: ["bridge-admin-jobs"],
    queryFn: () => getJson<{ jobs: BridgeJob[] }>("/api/bridge/admin/jobs"),
    enabled: canSeeBridge, retry: false, refetchInterval: false, refetchOnWindowFocus: false,
  });
  const sessions = useQuery({
    queryKey: ["bridge-admin-sessions"],
    queryFn: () => getJson<{ sessions: Session[] }>("/api/bridge/admin/sessions"),
    enabled: canSeeBridge, retry: false, refetchInterval: false, refetchOnWindowFocus: false,
  });
  const events = useQuery({
    queryKey: ["bridge-admin-job-events", activeBridgeId],
    queryFn: () => getJson<{ events: JobEvent[] }>(
      "/api/bridge/admin/jobs/" + encodeURIComponent(activeBridgeId ?? "") + "/events"
    ),
    enabled: canSeeBridge && activeBridgeId !== null,
    retry: false, refetchInterval: false, refetchOnWindowFocus: false,
  });

  const rows = useMemo<WorkRow[]>(() => {
    const native = tasks.data ?? [];
    const nativeIds = new Set(native.map(t => String(t.id)));
    const nativeRows: WorkRow[] = native.map(t => ({
      key: "task:" + t.id, kind: "task", rawId: String(t.id),
      title: t.title, sourceLabel: "AI Tasks", sourceType: "AI Tasks",
      owner: t.assignedTo || "Belum ditugaskan", status: t.status,
      bucket: bucket(t.status), date: t.createdAt, ack: false, task: t,
    }));
    const bridgeRows: WorkRow[] = (canSeeBridge ? bridge.data?.jobs ?? [] : [])
      // Suppress only verifiable 1:1 references; do not guess cross-system identity.
      .filter(j => {
        const match = j.source === "AI_TASK" ? /^ai-task:(\d+)$/.exec(j.external_id) : null;
        return !match || !nativeIds.has(match[1]);
      })
      .map(j => ({
        key: "bridge:" + j.id, kind: "bridge", rawId: j.id,
        title: j.title, sourceLabel: j.source === "AI_CORE" ? "AI Core" : j.source,
        sourceType: j.source, owner: j.owner || "—", status: j.status,
        bucket: bucket(j.status), date: j.created_at,
        ack: Boolean(j.callback_received_at && j.result_verified_at), job: j,
      }));
    return [...nativeRows, ...bridgeRows].sort((a, b) =>
      (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)
    );
  }, [tasks.data, bridge.data, canSeeBridge]);

  const filtered = useMemo(() => rows.filter(row => {
    if (source === "session") return false;
    if (source !== "all" && source !== row.kind) return false;
    if (status !== "all" && row.bucket !== status) return false;
    const q = search.trim().toLowerCase();
    return !q || [row.title, row.sourceLabel, row.rawId, row.job?.external_id ?? "",
      row.task?.taskNumber ?? "", row.task?.customerName ?? ""].some(v => v.toLowerCase().includes(q));
  }), [rows, source, status, search]);

  const loading = tasks.isLoading || (canSeeBridge && bridge.isLoading);
  const errors = [
    tasks.isError ? "AI Tasks: " + (tasks.error instanceof Error ? tasks.error.message : "gagal dibaca") : null,
    canSeeBridge && bridge.isError ? "AI Core: " + (bridge.error instanceof Error ? bridge.error.message : "gagal dibaca") : null,
  ].filter(Boolean);
  const activeSessions = sessions.data?.sessions ?? [];
  // Keep clickable status counts consistent with the selected data source.
  const sourceRows = source === "task" || source === "bridge"
    ? rows.filter(r => r.kind === source) : rows;
  const stats: Array<{ key: StatusFilter; name: string; count: number }> = [
    { key: "all", name: "Semua pekerjaan", count: sourceRows.length },
    { key: "new", name: "Baru / Antrean", count: sourceRows.filter(r => r.bucket === "new").length },
    { key: "running", name: "Sedang berjalan", count: sourceRows.filter(r => r.bucket === "running").length },
    { key: "completed", name: "Selesai", count: sourceRows.filter(r => r.bucket === "completed").length },
    { key: "attention", name: "Perlu perhatian", count: sourceRows.filter(r => r.bucket === "attention").length },
  ];
  const sourceTabs: Array<{ key: SourceFilter; name: string }> = [
    { key: "all", name: "Semua sumber" },
    { key: "task", name: "AI Tasks" },
    ...(canSeeBridge ? [
      { key: "bridge" as const, name: "ChatGPT / AI Core" },
      { key: "session" as const, name: "Sesi" },
    ] : []),
  ];
  const chooseSource = (next: SourceFilter) => {
    setSource(next);
    setStatus("all");
    setOpenedJob(null);
  };
  const refreshAll = () => {
    void tasks.refetch();
    if (canSeeBridge) {
      void bridge.refetch();
      void sessions.refetch();
      if (openedJob) void events.refetch();
    }
  };

  return (
    <div className="flex flex-col min-h-0 h-full" data-testid="unified-dashboard">
      <div className="px-4 sm:px-6 pt-4"><OnboardingBanner /></div>
      <main className="px-4 sm:px-6 py-5 space-y-5">
        <div className="flex flex-wrap justify-between gap-3 items-center">
          <div>
            <h1 className="text-2xl font-bold">Dashboard Pekerjaan</h1>
            <p className="text-sm text-muted-foreground">
              Satu tempat untuk memantau AI Tasks dan pekerjaan yang dikirim melalui AI Core / ChatGPT.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {tasks.data?.length ?? "—"} AI Tasks
              {canSeeBridge ? " · " + (bridge.data?.jobs.length ?? "—") + " job integrasi terbaru (maks. 100)" : ""}
              {" · Dibaca langsung, tanpa membuat tugas duplikat"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={refreshAll} disabled={tasks.isFetching || bridge.isFetching}>
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
            <Link href="/ai-tasks">
              <Button type="button"><Plus className="w-4 h-4 mr-2" /> Buat / Kelola Task</Button>
            </Link>
          </div>
        </div>

        {errors.length > 0 && <div role="alert" className="rounded-lg border border-red-300 p-3 text-sm text-red-700">
          {errors.join("; ")}. Data dari sumber tersebut belum tersedia; angka yang tampil hanya data yang berhasil dibaca.
        </div>}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {stats.map(s => <button type="button" key={s.key} onClick={() => {setSource(source === "session" ? "all" : source); setStatus(current => current === s.key && s.key !== "all" ? "all" : s.key);}}
            aria-pressed={status === s.key && source !== "session"}
            className={"text-left rounded-xl border-2 bg-white p-4 transition-colors hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-blue-600 " +
              (status === s.key && source !== "session" ? "border-blue-500" : "border-slate-200")}>
            <span className="text-xs text-slate-600">{s.name}</span>
            <p className="text-2xl font-bold mt-1">{loading && !rows.length ? "…" : s.count}</p>
          </button>)}
        </div>

        <div className="flex flex-wrap gap-2 border-b pb-3" role="group" aria-label="Sumber pekerjaan">
          {sourceTabs.map(item =>
            <button type="button" key={item.key} onClick={() => chooseSource(item.key)}
              aria-pressed={source === item.key} className={"rounded-full px-4 py-2 text-sm border " +
                (source === item.key ? "bg-blue-600 border-blue-600 text-white" : "bg-white hover:bg-slate-100")}>
              {item.name}{item.key === "session" ? " (" + (sessions.data?.sessions.length ?? "—") + ")" : ""}
            </button>
          )}
        </div>

        {source === "session" ? (
          <section className="rounded-xl border bg-white p-4 space-y-3">
            <h2 className="font-semibold">Sesi yang terdaftar</h2>
            <p className="text-xs text-muted-foreground">Sesi di Job Registry berbeda dari heartbeat worker AI Core.</p>
            {sessions.isError && <p role="alert" className="text-red-700 text-sm">Sesi tidak dapat dibaca.</p>}
            {sessions.isLoading && <p>Memuat sesi…</p>}
            {!sessions.isLoading && !sessions.isError && activeSessions.length === 0 &&
              <p className="text-sm text-muted-foreground py-6">Belum ada sesi yang tercatat. Tidak ada sesi yang bisa dibuka saat ini.</p>}
            {activeSessions.map(session => {
              const key = session.source + ":" + session.session_id;
              return <div key={key} className="border-b py-2">
                <button type="button" className="flex w-full flex-wrap items-center justify-between text-left gap-3 hover:text-blue-700"
                  onClick={() => setOpenedSession(old => old === key ? null : key)} aria-expanded={openedSession === key}>
                  <span className="text-sm font-medium">{session.source} · {session.session_id}</span>
                  <Badge variant={session.heartbeat_recent ? "secondary" : "destructive"}>{session.heartbeat_recent ? session.state : "HEARTBEAT_STALE"}</Badge>
                </button>
                {openedSession === key && <div className="text-sm bg-slate-50 rounded p-3 mt-2">
                  <p>Pemilik: {session.owner ?? "—"}</p>
                  <p>Heartbeat: {stamp(session.last_seen_at)}</p>
                  <p>Job: {session.job_id ?? "—"}</p>
                </div>}
              </div>;
            })}
          </section>
        ) : (
          <section className="rounded-xl border bg-white overflow-hidden">
            <div className="p-4 flex flex-wrap justify-between gap-3 items-center">
              <div><h2 className="font-semibold">Daftar pekerjaan terpadu</h2>
                <p className="text-xs text-muted-foreground mt-1">{filtered.length} pekerjaan ditampilkan · klik baris untuk detail dan bukti</p>
              </div>
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                  aria-label="Cari seluruh pekerjaan" placeholder="Cari judul, ID, sumber…"
                  className="border rounded-md px-3 py-2 text-sm w-52 max-w-full" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-y bg-slate-50 text-slate-600"><tr>
                  <th className="p-3 font-medium">Pekerjaan</th>
                  <th className="p-3 font-medium">Sumber</th>
                  <th className="p-3 font-medium">Pelaksana</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Dibuat (WIB)</th>
                  <th className="p-3 font-medium">Hasil / ACK</th>
                </tr></thead>
                <tbody>
                  {filtered.map(row => (
                    <RowWithEvents key={row.key} row={row}
                      expanded={openedJob === row.key}
                      onExpand={() => setOpenedJob(current => current === row.key ? null : row.key)}
                      events={row.kind === "bridge" && openedJob === row.key ? events : undefined} />
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">
                    {loading ? "Memuat pekerjaan…" : errors.length ? "Sebagian sumber tidak tersedia, atau tidak ada hasil untuk filter ini." : "Tidak ada pekerjaan untuk filter ini."}
                  </td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 p-3 border-t text-xs text-muted-foreground">
              <Info className="h-4 w-4" />
              <span>AI Core menampilkan 100 job terbaru dari Job Registry. Ini bukan total seluruh riwayat; hasil dan ACK berasal dari event resmi.</span>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function RowWithEvents({ row, expanded, onExpand, events }: {
  row: WorkRow; expanded: boolean; onExpand: () => void;
  events?: { data?: { events: JobEvent[] }; isLoading: boolean; isError: boolean };
}) {
  return <>
    <tr className={"border-b " + (expanded ? "bg-blue-50/50" : "")}>
      <td className="p-3 max-w-[360px]">
        <button type="button" onClick={onExpand} aria-expanded={expanded}
          className="flex items-start gap-2 text-left w-full hover:text-blue-700 focus-visible:underline">
          {expanded ? <ChevronUp className="shrink-0 w-4 h-4 mt-1" /> : <ChevronDown className="shrink-0 w-4 h-4 mt-1" />}
          <span><span className="font-medium block">{row.title}</span>
            <span className="text-xs text-muted-foreground break-all">{row.kind === "task" ?
              row.task?.taskNumber ?? "Task " + row.rawId : row.job?.external_id ?? row.rawId}</span></span>
        </button>
      </td>
      <td className="p-3"><Badge variant="outline">{row.sourceLabel}</Badge></td>
      <td className="p-3">{row.owner}</td>
      <td className="p-3"><Badge variant={badgeVariant(row.status)}>{row.status}</Badge></td>
      <td className="p-3 whitespace-nowrap">{stamp(row.date)}</td>
      <td className="p-3">{row.kind === "bridge" ?
        row.ack ? <span className="text-green-700 font-semibold">ACK Terverifikasi</span> : "Belum terverifikasi" :
        <span className="text-muted-foreground">Status tugas</span>}</td>
    </tr>
    {expanded && <tr className="bg-slate-50 border-b"><td colSpan={6} className="p-4">
      <div className="space-y-2 text-sm">
        <p className="font-semibold">Detail pekerjaan</p>
        <p className="text-xs text-muted-foreground break-all">ID {row.rawId} · {row.sourceType}</p>
        {row.kind === "task" ? <>
          <p>Pelanggan: {row.task?.customerName ?? "—"} · Prioritas: {row.task?.priority ?? "—"}</p>
          <p>{row.task?.description ?? "Tidak ada keterangan tambahan."}</p>
          <Link href={"/ai-tasks/" + row.rawId} className="text-blue-700 underline">Buka pengelolaan task</Link>
        </> : <>
          <p>Hasil terverifikasi: {row.ack ? "Ya" : "Belum"} · Callback: {stamp(row.job?.callback_received_at ?? null)}</p>
          <p className="font-medium">Riwayat event dan ACK</p>
          {events?.isLoading && <p>Memuat event…</p>}
          {events?.isError && <p role="alert" className="text-red-700">Riwayat event tidak dapat dibaca.</p>}
          {!events?.isLoading && !events?.isError && events?.data?.events.length === 0 && <p>Belum ada event.</p>}
          <ol className="space-y-1">
            {(events?.data?.events ?? []).map(ev => <li className="flex flex-wrap gap-3 text-xs border-b py-1" key={ev.event_id}>
              <strong>{ev.kind}</strong><span>{stamp(ev.received_at)}</span><span>{ev.sender}</span>
            </li>)}
          </ol>
          <Link href={"/bridge-jobs?job=" + encodeURIComponent(row.rawId)}
            className="text-blue-700 underline">Buka audit lengkap</Link>
        </>}
      </div>
    </td></tr>}
  </>;
}
