
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Code2, Server, ShieldCheck, ClipboardCheck, PlayCircle, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Role = "coding" | "infrastructure" | "security" | "qa";
type Step = { id: string; role: string; status: string | null; at: string; message: string | null; evidence: Record<string, unknown> | null };
type Run = {
 id: string; companyId: string; title: string; status: string; progress: number; createdAt: string;
 completedAt: string | null; resultSummary: string | null; errorMessage: string | null;
 verifiedComplete: boolean; proofLevel: string; callbackVerified: boolean;
 attestationVerified: boolean; finalAckVerified: boolean; steps: Step[];
};
type WorkerPresence = {
 clientId: string; eligible: boolean; presenceState: "ACTIVE" | "UNAVAILABLE";
 reportedHealth: "healthy" | "degraded" | "unknown";
 lastSeenAt: string | null; leaseExpiresAt: string | null;
};
type AgentReadiness = {
 status: "available" | "unavailable"; mode: "PRESENCE_ONLY_NOT_EXECUTION_PROOF";
 checkedAt: string | null; workers: WorkerPresence[]; reason?: string;
};
type Monitor = {
 companyId: string; roles: Role[]; runs: Run[]; mode: string; authority: string;
 agentReadiness: AgentReadiness; canRunCanary: boolean;
 operationalTaskBinding: {verified:boolean; reason:string};
};
const roles = [
 { id: "coding", name: "Agen Coding", note: "Kontrak source dan ledger", Icon: Code2 },
 { id: "infrastructure", name: "Agen Infrastruktur", note: "Health runtime DEV", Icon: Server },
 { id: "security", name: "Agen Security", note: "Batas akses dan kredensial", Icon: ShieldCheck },
 { id: "qa", name: "Agen QA", note: "Verifikasi bukti tiga peran", Icon: ClipboardCheck },
] as const;
async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
 const token = getStoredToken();
 const res = await fetch(path, { ...init, headers: {
  "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}),
 } });
 if (!res.ok) throw new Error("HTTP " + res.status + " — " +
  (res.status === 404 ? "fitur belum diaktifkan pada runtime DEV" : "akses atau API tidak tersedia"));
 return res.json() as Promise<T>;
}
function pill(status: string) {
 const text = status === "completed" ? "PASS diagnostik" : status === "failed" ? "FAIL" :
   status === "blocked" ? "BLOCKED" :
   status === "started" || status === "processing" ? "Berjalan" : "Belum uji";
 const klass = status === "completed" ? "bg-emerald-100 text-emerald-800" :
   status === "failed" ? "bg-rose-100 text-rose-800" :
   status === "blocked" ? "bg-amber-100 text-amber-800" :
   status === "started" || status === "processing" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700";
 return <span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + klass}>{text}</span>;
}
function when(s: string | null) { return s ? new Date(s).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"}) : "—"; }

export default function CstAiTeamMonitor() {
 const queryClient = useQueryClient();
 const [selected, setSelected] = useState<string | null>(null);
 const query = useQuery<Monitor>({queryKey:["cst-ai-team", "1"],
  queryFn: () => callApi<Monitor>("/api/cst-ai-team/monitor?companyId=1"),
  refetchInterval:5000, retry:1});
 const mutation = useMutation({mutationFn:() => callApi<{id:string}>("/api/cst-ai-team/runs?companyId=1",
  {method:"POST", body:JSON.stringify({scenario:"dev_read_only_canary"})}),
  onSuccess:(data) => {setSelected(data.id); void queryClient.invalidateQueries({queryKey:["cst-ai-team"]});}});
 const runs = query.data?.runs || [];
 const agentReadiness = query.data?.agentReadiness;
 const current = runs.find(r => r.id === selected) || runs[0];
 return <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8">
  <header className="flex flex-wrap items-start justify-between gap-4">
   <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AI TASK HUB / CST-DEV / COMPANY 1</p>
    <h1 className="mt-2 text-3xl font-bold">CST AI Team Monitor</h1>
    <p className="mt-2 text-sm text-muted-foreground">Pemantauan empat peran dari bukti ledger eksekusi nyata.</p></div>
   <div className="flex gap-2">
    <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
    <Button disabled={!query.data?.canRunCanary || mutation.isPending || current?.status === "processing"}
     onClick={() => mutation.mutate()}><PlayCircle className="mr-2 h-4 w-4"/>{query.data?.canRunCanary ? "Uji koordinasi DEV" : "Uji DEV terkunci"}</Button>
   </div>
  </header>
  <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
   <AlertTriangle className="h-5 w-5 shrink-0"/>
   <p><strong>Mode canary DEV saja.</strong> Ini empat executor diagnostik terkoordinasi, bukan empat GPT mandiri atau izin deploy.
    Hasil PASS bukan tanda tangan GPT02, Final ACK, transaksi PROD, maupun coding lintas repo.
    Tugas operasional yang tersimpan dengan companyId berbeda tidak boleh otomatis dipetakan ke Company 1.</p>
  </div>
  {query.data?.operationalTaskBinding?.verified !== true && <p role="status" className="rounded-lg border border-amber-200 p-3 text-sm text-amber-900">Belum ada bukti bahwa task operasional terikat ke Company 1, worker yang sah, callback, dan verifikasi QA. Status canary tidak dihitung sebagai tugas operasional selesai.</p>}
  {query.isError && <div role="alert" className="rounded-lg border border-red-300 p-4 text-sm text-red-700">{(query.error as Error).message}</div>}
  {mutation.isError && <div role="alert" className="rounded-lg border border-red-300 p-4 text-sm text-red-700">{(mutation.error as Error).message}</div>}
  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
   {[
    {name:"Uji tersimpan",value:String(runs.length),caption:"12 terbaru"},
    {name:"PASS diagnostik dengan bukti",value:String(runs.filter(r => r.verifiedComplete).length),caption:"Wajib 4/4 pemeriksaan PASS"},
    {name:"Izin operasional",value:"TERKUNCI",caption:"Tidak ada signing / dispatch / PROD"},
   ].map(item => <div key={item.name} className="rounded-xl border bg-card p-4">
     <p className="text-xs text-muted-foreground">{item.name}</p><p className="mt-2 text-2xl font-bold">{item.value}</p>
     <p className="mt-1 text-xs text-muted-foreground">{item.caption}</p></div>)}
  </div>
  <section className="rounded-xl border bg-card p-4 md:p-5">
   <h2 className="text-lg font-semibold">Worker AI Core DEV — status koneksi aktual</h2>
   <p className="mt-1 text-xs text-muted-foreground">Data heartbeat dari registry AI Core yang sudah ada. Online bukan bukti tugas selesai, izin dispatch, atau Final ACK.</p>
   {agentReadiness?.status === "available" ? <>
    <p className="mt-2 text-xs text-muted-foreground">Diperiksa: {when(agentReadiness.checkedAt)} · Mode: baca-saja</p>
    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
     {agentReadiness.workers.map(worker =>
      <div key={worker.clientId} className="rounded-lg border p-3">
       <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{worker.clientId}</span>
        <span className={"rounded-full px-2 py-1 text-xs font-semibold " +
         (worker.eligible ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>
          {worker.eligible ? "Online / eligible" : "Tidak siap"}
        </span>
       </div>
       <p className="mt-2 text-xs text-muted-foreground">Heartbeat: {when(worker.lastSeenAt)}</p>
       <p className="text-xs text-muted-foreground">Lease sampai: {when(worker.leaseExpiresAt)}</p>
      </div>)}
    </div>
   </> : <p className="mt-3 text-sm text-amber-800">
     Status worker belum dapat diverifikasi dari bridge. {agentReadiness?.reason || "Belum ada pembacaan."} Tidak dinyatakan PASS.
   </p>}
  </section>
  <section><h2 className="mb-3 text-lg font-semibold">Empat peran uji diagnostik</h2>
   <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{roles.map(role => {
    const steps = current?.steps.filter(s => s.role === role.id) || [];
    const latest = steps[steps.length-1];
    return <div key={role.id} className="rounded-xl border bg-card p-4">
     <div className="flex items-center justify-between"><role.Icon className="h-5 w-5 text-muted-foreground"/>{pill(latest?.status || "")}</div>
     <p className="mt-4 font-semibold">{role.name}</p><p className="text-xs text-muted-foreground">{role.note}</p>
     <p className="mt-3 text-xs text-muted-foreground">cst-team-dev-{role.id}</p>
     <p className="text-xs text-muted-foreground">{when(latest?.at || null)}</p>
    </div>;
   })}</div>
  </section>
  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr]">
   <section className="rounded-xl border bg-card p-4">
    <h2 className="mb-3 font-semibold">Riwayat uji</h2>
    {runs.length === 0 && <p className="text-sm text-muted-foreground">Belum ada run tersimpan.</p>}
    <div className="space-y-2">{runs.map(run =>
     <button key={run.id} onClick={() => setSelected(run.id)}
      className={"w-full rounded-lg border p-3 text-left hover:bg-muted " + (current?.id === run.id ? "border-primary bg-muted/50" : "")}>
      <div className="flex justify-between gap-2 text-sm"><span className="font-medium">#{run.id.slice(0,8)}</span>{pill(run.status)}</div>
      <p className="mt-2 text-xs text-muted-foreground">{when(run.createdAt)}</p>
      <p className="mt-1 text-xs">{run.verifiedComplete ? "Bukti empat peran PASS" : "Belum memenuhi kriteria PASS"}</p>
     </button>)}</div>
   </section>
   <section className="rounded-xl border bg-card p-4 md:p-5">
    <div className="mb-4 flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold">Detail eksekusi</h2>
     <p className="text-xs text-muted-foreground">{current?.id || "Belum ada run"}</p></div>
     {current && pill(current.verifiedComplete ? "completed" : current.status)}</div>
    {!current && <p className="text-sm text-muted-foreground">Jalankan uji canary DEV untuk menampilkan bukti.</p>}
    {current && <>
     <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full bg-emerald-500" style={{width:current.progress + "%"}}/></div>
     <p className="mb-4 text-xs text-muted-foreground">Progress {current.progress}% · {when(current.completedAt)} · {current.proofLevel}</p>
     <div className="space-y-3">{current.steps.filter(s => s.status !== "started").map(step =>
      <div key={step.id} className="rounded-lg border p-3">
       <div className="flex justify-between text-sm"><strong>{roles.find(r => r.id === step.role)?.name || step.role}</strong>{pill(step.status || "")}</div>
       <p className="mt-1 text-xs text-muted-foreground">{step.message} · {when(step.at)}</p>
       {step.evidence && <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(step.evidence,null,2)}</pre>}
      </div>)}</div>
     {current.errorMessage && <p className="mt-3 text-sm text-red-700">{current.errorMessage}</p>}
     <p className="mt-4 text-xs text-muted-foreground">Callback: {String(current.callbackVerified)} · Attestation: {String(current.attestationVerified)} · Final ACK: {String(current.finalAckVerified)} — ketiganya bukan bukti canary ini.</p>
    </>}
   </section>
  </div>
 </div>;
}
