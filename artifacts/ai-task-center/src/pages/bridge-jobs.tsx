import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Network, ShieldAlert, ChevronDown, ChevronUp, Search } from "lucide-react";

type Job = {
  id: string; source: string; external_id: string; source_session_id: string | null;
  title: string; status: string; owner: string | null; created_at: string;
  updated_at: string; callback_received_at: string | null; result_verified_at: string | null;
};
type Session = {
  source: string; session_id: string; state: string; owner: string | null;
  job_id: string | null; last_seen_at: string; heartbeat_recent: boolean;
};
type JobEvent = {
  event_id: string; kind: string; sender: string; received_at: string;
  payload: unknown;
};
type SummaryFilter = "all" | "running" | "waiting" | "attention";

async function load<T>(url: string): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(url, {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json() as Promise<T>;
}

const stateColor = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  if (["FAILED", "DISCONNECTED", "BLOCKED"].includes(status)) return "destructive";
  if (status === "COMPLETED") return "default";
  if (["WAITING_FOR_ACK", "SUSPECTED_STALL"].includes(status)) return "outline";
  return "secondary";
};
const attention = (status: string) => ["FAILED", "SUSPECTED_STALL", "BLOCKED"].includes(status);
const isTerminal = (status: string) => ["COMPLETED", "FAILED", "CANCELLED", "CANCELED", "BLOCKED"].includes(status.toUpperCase());

const inWib = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short",
    year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date) + " WIB";
};
const elapsed = (start: string, end: string | null, now: number) => {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "—";
  const seconds = Math.floor((to - from) / 1000);
  return [
    Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60,
  ].map(n => String(n).padStart(2, "0")).join(":");
};

export default function BridgeJobsPage() {
  const { user } = useAuth();
  const authorized = user?.role === "super_admin";
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<SummaryFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() => {
    const requested = new URLSearchParams(window.location.search).get("job");
    return requested && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requested) ? requested : null;
  });
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const jobs = useQuery({
    queryKey: ["bridge-admin-jobs"],
    queryFn: () => load<{ jobs: Job[] }>("/api/bridge/admin/jobs"),
    enabled: authorized, retry: false,
    refetchOnWindowFocus: false, refetchInterval: false,
  });
  const sessions = useQuery({
    queryKey: ["bridge-admin-sessions"],
    queryFn: () => load<{ sessions: Session[] }>("/api/bridge/admin/sessions"),
    enabled: authorized, retry: false,
    refetchOnWindowFocus: false, refetchInterval: false,
  });
  const events = useQuery({
    queryKey: ["bridge-admin-job-events", selectedJobId],
    queryFn: () => load<{ events: JobEvent[] }>(
      "/api/bridge/admin/jobs/" + encodeURIComponent(selectedJobId || "") + "/events"
    ),
    enabled: authorized && selectedJobId !== null,
    retry: false, refetchOnWindowFocus: false, refetchInterval: false,
  });

  if (!authorized) return <div className="p-6 text-destructive">Hanya super admin yang dapat membaca registry lintas sistem.</div>;

  const rows = jobs.data?.jobs ?? [];
  const trackedSessions = sessions.data?.sessions ?? [];
  const filtered = rows.filter((j) => {
    const matchesStatus = filter === "all" ||
      (filter === "running" && j.status === "RUNNING") ||
      (filter === "waiting" && j.status === "WAITING_FOR_ACK") ||
      (filter === "attention" && attention(j.status));
    const keyword = search.trim().toLowerCase();
    return matchesStatus && (!keyword ||
      [j.title, j.external_id, j.id, j.source].some(v => v.toLowerCase().includes(keyword)));
  });
  const stats: Array<{ key: SummaryFilter; label: string; value: number }> = [
    { key: "all", label: "100 job terbaru (maks.)", value: rows.length },
    { key: "running", label: "Running", value: rows.filter(j => j.status === "RUNNING").length },
    { key: "waiting", label: "Menunggu ACK", value: rows.filter(j => j.status === "WAITING_FOR_ACK").length },
    { key: "attention", label: "Perlu perhatian", value: rows.filter(j => attention(j.status)).length },
  ];

  return (
    <main className="space-y-5 p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Network className="h-6 w-6" /> Unified Job Registry</h1>
          <p className="text-sm text-muted-foreground">Pekerjaan AI Core, ChatGPT dan OpenClaw, dibaca saat dibuka atau saat Refresh.</p>
          <p className="text-xs text-muted-foreground mt-1">
            <Link href="/" className="text-blue-700 hover:underline">Dashboard</Link>
            {" · "}
            <Link href="/ai-tasks" className="text-blue-700 hover:underline">AI Tasks</Link>
            {" · "}
            <span>Job Registry adalah catatan integrasi, bukan duplikat AI Tasks.</span>
          </p>
        </div>
        <Button variant="outline" onClick={() => {
          void jobs.refetch();
          void sessions.refetch();
          if (selectedJobId) void events.refetch();
        }}><RefreshCw className="h-4 w-4 mr-2" /> Refresh</Button>
      </div>

      {(jobs.isError || sessions.isError) && (
        <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
          <ShieldAlert className="h-4 w-4 inline mr-2" />
          Tidak dapat membaca Job Registry. Periksa login dan akses super_admin.
          <span className="ml-2 text-muted-foreground">
            {jobs.error instanceof Error ? jobs.error.message : sessions.error instanceof Error ? sessions.error.message : ""}
          </span>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {stats.map((stat) => (
          <button type="button" key={stat.key}
            onClick={() => setFilter(current => current === stat.key && current !== "all" ? "all" : stat.key)}
            aria-label={"Filter pekerjaan: " + stat.label} aria-pressed={filter === stat.key}
            className="text-left rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            data-testid={"bridge-filter-" + stat.key}>
            <Card className={filter === stat.key ? "border-blue-500 shadow-sm" : "hover:border-blue-300 transition-colors"}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-semibold">{jobs.data ? stat.value : "—"}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-3 justify-between items-center">
            <div>
              <CardTitle className="text-base">Pekerjaan terakhir</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Menampilkan {filtered.length} dari {rows.length} job terbaru. Klik nama pekerjaan untuk melihat event dan ACK.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input aria-label="Cari pekerjaan integrasi" placeholder="Cari nama, ID, sumber…"
                className="border rounded-md px-2 py-1 text-sm min-w-40" value={search} onChange={e => setSearch(e.target.value)} />
              {(filter !== "all" || search) && <Button variant="outline" size="sm" onClick={() => { setFilter("all"); setSearch(""); }}>Reset</Button>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b text-muted-foreground"><tr>
              <th className="py-2 pr-4">Sumber</th><th className="py-2 pr-4">Pekerjaan</th>
              <th className="py-2 pr-4">Owner</th><th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Dibuat (WIB)</th><th className="py-2 pr-4">Durasi</th><th className="py-2">Callback</th>
            </tr></thead>
            <tbody>
              {filtered.map((j) => (
                <Fragment key={j.id}>
                  <tr className={selectedJobId === j.id ? "border-b bg-blue-50/50" : "border-b"}>
                    <td className="py-2 pr-4">{j.source}</td>
                    <td className="py-2 pr-4">
                      <button type="button" aria-expanded={selectedJobId === j.id}
                        className="text-left hover:text-blue-700 focus-visible:underline"
                        onClick={() => setSelectedJobId(previous => previous === j.id ? null : j.id)}>
                        <span className="font-medium flex items-center gap-1">{j.title}
                          {selectedJobId === j.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </span>
                        <span className="text-xs text-muted-foreground break-all">{j.external_id}</span>
                      </button>
                    </td>
                    <td className="py-2 pr-4">{j.owner ?? "—"}</td>
                    <td className="py-2 pr-4"><Badge variant={stateColor(j.status)}>{j.status}</Badge></td>
                    <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{inWib(j.created_at)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap tabular-nums" title={isTerminal(j.status) ? "Pembaruan: " + inWib(j.updated_at) : "Durasi berjalan"}>{elapsed(j.created_at, isTerminal(j.status) ? j.updated_at : null, now)}</td>
                    <td className="py-2">{j.callback_received_at && j.result_verified_at ? "ACK " + inWib(j.result_verified_at) : "Belum diverifikasi"}</td>
                  </tr>
                  {selectedJobId === j.id && (
                    <tr><td colSpan={7} className="bg-slate-50 px-4 py-3">
                      <div className="space-y-2">
                        <p className="font-semibold">Riwayat event — {j.title}</p>
                        <p className="text-xs text-muted-foreground break-all">Job ID: {j.id} · Sumber: {j.external_id}</p>
                        {events.isLoading && <p>Memuat riwayat event…</p>}
                        {events.isError && <p role="alert" className="text-red-700">Tidak dapat membaca event: {events.error instanceof Error ? events.error.message : "Kesalahan API"}</p>}
                        {events.data?.events.length === 0 && <p className="text-muted-foreground">Belum ada event untuk job ini.</p>}
                        <ol className="space-y-1">
                          {(events.data?.events ?? []).map(ev => (
                            <li key={ev.event_id} className="flex flex-wrap gap-x-3 gap-y-1 border-b py-1 text-xs">
                              <strong>{ev.kind}</strong>
                              <span>{inWib(ev.received_at)}</span>
                              <span className="text-muted-foreground">{ev.sender}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="py-5 text-muted-foreground text-center">
                {jobs.isLoading ? "Memuat…" : jobs.isError ? "Data tidak tersedia" : "Tidak ada pekerjaan untuk filter ini"}
              </td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sesi yang terdaftar ({trackedSessions.length})</CardTitle>
          <p className="text-xs text-muted-foreground">Klik sesi untuk melihat pemilik, heartbeat, dan job terkait.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {trackedSessions.map(s => {
            const key = s.source + ":" + s.session_id;
            return <div key={key} className="border-b pb-2 text-sm">
              <button type="button" className="flex flex-wrap gap-3 items-center text-left w-full hover:text-blue-700"
                aria-expanded={selectedSession === key} onClick={() => setSelectedSession(previous => previous === key ? null : key)}>
                <span className="font-medium">{s.source}</span>
                <span className="font-mono text-xs">{s.session_id}</span>
                <Badge variant={s.heartbeat_recent ? stateColor(s.state) : "destructive"}>{s.heartbeat_recent ? s.state : "HEARTBEAT_STALE"}</Badge>
                <span className="text-muted-foreground">{s.owner ?? "Belum ada pemilik"}</span>
                {selectedSession === key ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
              </button>
              {selectedSession === key && <div className="mt-2 rounded-md bg-slate-50 p-3 text-xs space-y-1">
                <p>Heartbeat terakhir: {inWib(s.last_seen_at)}</p>
                <p>Status: {s.state}</p>
                <p>Job terkait: {s.job_id ?? "Belum ada"}</p>
                {s.job_id && <button type="button" className="text-blue-700 underline" onClick={() => { setSearch(""); setFilter("all"); setSelectedJobId(s.job_id); }}>
                  Lihat event job terkait
                </button>}
              </div>}
            </div>;
          })}
          {!sessions.isLoading && trackedSessions.length === 0 &&
            <p className="text-muted-foreground text-sm">
              Belum ada sesi tersimpan di Job Registry. Heartbeat worker di AI Core bukan otomatis sesi pada tabel ini.
            </p>}
        </CardContent>
      </Card>
    </main>
  );
}
