import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, CheckCircle2, Clock, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { getStoredToken } from "@/lib/auth-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type SopRevision = {
  eventId: string; capturedAt: string; version: string | null;
  title: string | null; steps: string[];
};
type Event = {
  eventId: string; kind: string; status: string | null;
  message: string | null; workerId: string | null; occurredAt: string; sopVersion: string | null;
};
type Job = {
  id: string; source: string; taskId: number | null; externalId: string;
  jobId: string | null; commandId: string | null; correlationId: string | null;
  workerId: string | null; workerStatus: string;
  executionStatus: string; ledgerStatus: string; finalAckStatus: "VERIFIED" | "PENDING";
  createdAt: string;
  updatedAt: string; sopVersion: string | null; sopHistory: SopRevision[];
  ack: { received: boolean; callbackObserved: boolean; mcpReceiptPersisted: boolean; mcpAcknowledgedAt: string | null; attestationVerified: boolean; finalVerified: boolean };
  events: Event[];
};
type Timeline = { authority: string; dispatchEnabled: boolean; syncedAt: string; jobs: Job[];
  paging: { limit: number; offset: number; total: number } };
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const stamp = (v: string) => Number.isNaN(Date.parse(v)) ? v : new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
const empty = (v: string | null) => v || "Belum tercatat";
const stateClass = (status: string) => {
  const s = status.toLowerCase();
  return ["completed", "verified"].includes(s) ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : ["failed", "blocked"].includes(s) ? "text-red-700 bg-red-50 border-red-200"
    : "text-amber-800 bg-amber-50 border-amber-200";
};

export default function UnifiedExecutionTimelinePage() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      setSelected(null);
      setAppliedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const timeline = useQuery<Timeline>({
    queryKey: ["unified-execution-timeline", page, appliedSearch],
    queryFn: async () => {
      const token = getStoredToken();
      const response = await fetch(BASE + "/api/executions/unified-timeline?limit=50&offset=" + (page * 50) + "&q=" + encodeURIComponent(appliedSearch), {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json() as Promise<Timeline>;
    },
    refetchInterval: 15000,
  });
  const jobs = timeline.data?.jobs ?? [];
  const totalPages = Math.max(1, Math.ceil((timeline.data?.paging.total ?? 0) / 50));
  // Results and total count are scoped and filtered by the authenticated API.
  // Filtering this page a second time would hide valid matches from older pages.
  const filtered = jobs;
  const current = filtered.find((job) => job.id === selected) ?? filtered[0] ?? null;
  return (
    <div className="p-4 md:p-7 space-y-5 max-w-7xl mx-auto text-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-600"><Activity size={17} /> AI Task / SOP</div>
          <h1 className="text-2xl font-bold mt-1">Timeline Terpadu</h1>
          <p className="text-sm text-slate-600 mt-1">Status eksekusi dari AI Core ditampilkan terpisah dari status Final ACK. Job yang selesai tidak dianggap sedang berjalan hanya karena menunggu verifikasi akhir.</p>
          <p className="flex items-center gap-2 text-xs text-slate-500 mt-2"><ShieldCheck size={14}/> Otoritas eksekusi: AI Core. Halaman ini hanya membaca; tidak mengirim atau mengambil job.</p>
        </div>
        <Button variant="outline" onClick={() => void timeline.refetch()} disabled={timeline.isFetching}>
          <RefreshCw size={15} className={timeline.isFetching ? "animate-spin mr-2" : "mr-2"} /> Sinkronkan
        </Button>
      </header>
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
        Sumber waktu: WIB • Sinkron terakhir: {timeline.data ? stamp(timeline.data.syncedAt) : "Belum tersedia"} •
        Eksekusi = event otoritatif AI Core • Final ACK = bukti akhir yang diverifikasi • Ledger = status pemantauan internal AI Task.
      </div>
      {timeline.isError && <div role="alert" className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-800">Gagal mengambil timeline dari AI Task DEV. Tidak ada status yang diasumsikan berhasil.</div>}
      <div className="relative">
        <Search className="absolute left-3 top-3 text-slate-400" size={17} />
        <Input aria-label="Cari job, command, correlation atau worker" placeholder="Cari jobId, commandId, correlationId, worker..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(250px,1fr)_minmax(0,2fr)]">
        <div className="space-y-2 min-w-0">
          <div className="rounded-xl border bg-white max-h-[700px] overflow-y-auto">
          {filtered.length === 0 && <p className="p-5 text-sm text-slate-500">{timeline.isLoading ? "Memuat ledger..." : "Tidak ditemukan job pada data yang tersedia."}</p>}
          {filtered.map((job) => (
            <button key={job.id} type="button" onClick={() => setSelected(job.id)}
              className={"block w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-slate-50 " + (current?.id === job.id ? "bg-blue-50" : "")}>
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-xs">{job.source}</span>
                <span className={"text-[11px] border rounded-full px-2 py-0.5 " + stateClass(job.executionStatus)}>{job.executionStatus}</span>
              </span>
              <span className="block mt-1 text-[11px] text-slate-600">Final ACK: <strong>{job.finalAckStatus === "VERIFIED" ? "Verified" : "Pending"}</strong> · Ledger: {job.ledgerStatus}</span>
              <span className="block mt-1 font-mono text-[11px] break-all text-slate-700">{job.jobId || job.externalId}</span>
              <span className="block mt-1 text-[11px] text-slate-500">{stamp(job.updatedAt)}</span>
            </button>
          ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
            <span>Halaman {page + 1} dari {totalPages} · {timeline.data?.paging.total ?? 0} job</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page === 0 || timeline.isFetching}
                onClick={() => { setSelected(null); setPage((n) => Math.max(0, n - 1)); }}>Sebelumnya</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages || timeline.isFetching}
                onClick={() => { setSelected(null); setPage((n) => n + 1); }}>Berikutnya</Button>
            </div>
          </div>
        </div>
        <section className="rounded-xl border bg-white p-4 md:p-5 min-w-0">
          {current ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-lg">Detail eksekusi dan korelasi</h2>
                {current.taskId && <Link href={"/ai-tasks/" + current.taskId} className="text-blue-600 text-sm underline">Buka task</Link>}
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {([
                  ["Job ID", current.jobId],
                  ["External ID", current.externalId],
                  ["Command ID", current.commandId],
                  ["Correlation ID", current.correlationId],
                  ["Worker", current.workerId],
                  ["Status eksekusi sumber", current.executionStatus],
                  ["Final ACK", current.finalAckStatus === "VERIFIED" ? "Verified" : "Pending"],
                  ["Status ledger AI Task", current.ledgerStatus],
                ] as Array<[string, string | null]>).map(([title, value]) => (
                  <div key={title} className="rounded-lg bg-slate-50 p-3 min-w-0">
                    <dt className="text-xs text-slate-500">{title}</dt>
                    <dd className="mt-1 font-mono text-xs break-all">{empty(value)}</dd>
                  </div>
                ))}
              </dl>
              {current.executionStatus === "COMPLETED" && !current.ack.finalVerified && (
                <p className="text-xs text-slate-600 rounded-lg border border-slate-200 p-3">
                  Eksekusi AI Core sudah COMPLETED. Final ACK masih Pending; ini tidak berarti worker masih berjalan.
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {([
                  ["ACK diterima", current.ack.received],
                  ["Callback tercatat", current.ack.callbackObserved],
                  ["MCP ACK tertaut", current.ack.mcpReceiptPersisted],
                  ["Attestation", current.ack.attestationVerified],
                  ["Final ACK", current.ack.finalVerified],
                ] as Array<[string, boolean]>).map(([title, status]) => (
                  <div key={title} className={"rounded-lg border p-3 " + (status ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-600")}>
                    {status ? <CheckCircle2 size={15}/> : <Clock size={15}/>}
                    <p className="mt-1 font-semibold">{title}</p>
                    <p>{status ? "Tercatat" : "Belum terverifikasi"}</p>
                  </div>
                ))}
              </div>
              {current.ack.mcpReceiptPersisted && current.ack.mcpAcknowledgedAt && (
                <p className="text-xs text-slate-600">
                  Bukti MCP diterima: {stamp(current.ack.mcpAcknowledgedAt)}. Ini membuktikan receipt
                  tersimpan di sumber, bukan keseluruhan browser E2E.
                </p>
              )}
              <div>
                <h3 className="font-semibold">Riwayat SOP per job</h3>
                {current.sopHistory.length === 0 && <p className="text-xs text-slate-500 mt-2">Snapshot SOP belum diterima dari AI Core untuk job ini; tidak menggunakan versi SOP terbaru sebagai riwayat.</p>}
                {current.sopHistory.map((sop) => (
                  <div key={sop.eventId} className="rounded-lg border mt-2 p-3">
                    <p className="font-semibold text-sm">{sop.title || "SOP"}</p>
                    <p className="text-xs text-slate-500">{sop.version || "Versi belum tercatat"} • {stamp(sop.capturedAt)}</p>
                    {sop.steps.length > 0 && <ol className="list-decimal pl-5 text-xs mt-2 space-y-1">{sop.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}
                  </div>
                ))}
              </div>
              <div>
                <h3 className="font-semibold">Event dan ACK</h3>
                {current.events.length === 0 && <p className="text-xs text-slate-500 mt-2">Belum ada event tercatat.</p>}
                <div className="space-y-2 mt-2 max-h-72 overflow-y-auto">
                  {current.events.map((event) => (
                    <div key={event.eventId} className="border-l-2 border-blue-300 pl-3 py-1 text-xs">
                      <div className="flex items-center justify-between gap-2"><strong>{event.kind}</strong><span className="text-slate-500">{stamp(event.occurredAt)}</span></div>
                      <p className="text-slate-600 mt-1 break-words">{event.message || event.status || "Event tercatat"}</p>
                      {event.sopVersion && <p className="text-slate-500 mt-1">SOP: {event.sopVersion}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : <p className="text-sm text-slate-500">Pilih job untuk menampilkan timeline.</p>}
        </section>
      </div>
    </div>
  );
}
