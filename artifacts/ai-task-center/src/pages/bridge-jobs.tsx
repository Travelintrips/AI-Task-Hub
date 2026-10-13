import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Network, ShieldAlert } from "lucide-react";

type Job = {
  id: string; source: string; external_id: string; source_session_id: string | null;
  title: string; status: string; owner: string | null; created_at: string;
  updated_at: string; callback_received_at: string | null; result_verified_at: string | null;
};
type Session = {
  source: string; session_id: string; state: string; owner: string | null;
  job_id: string | null; last_seen_at: string; heartbeat_recent: boolean;
};

async function load<T>(path: string): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

const stateColor = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "FAILED" || status === "DISCONNECTED") return "destructive";
  if (status === "COMPLETED") return "default";
  if (status === "WAITING_FOR_ACK" || status === "SUSPECTED_STALL") return "outline";
  return "secondary";
};

export default function BridgeJobsPage() {
  const { user } = useAuth();
  const authorized = user?.role === "super_admin";
  const jobs = useQuery({
    queryKey: ["bridge-admin-jobs"],
    queryFn: () => load<{ jobs: Job[] }>("/api/bridge/admin/jobs"),
    enabled: authorized,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: false, // Event-driven/on-demand, never high-rate polling.
  });
  const sessions = useQuery({
    queryKey: ["bridge-admin-sessions"],
    queryFn: () => load<{ sessions: Session[] }>("/api/bridge/admin/sessions"),
    enabled: authorized,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
  if (!authorized) return <div className="p-6 text-destructive">Hanya super admin yang dapat membaca registry lintas sistem.</div>;
  const rows = jobs.data?.jobs ?? [];
  const trackedSessions = sessions.data?.sessions ?? [];
  return (
    <main className="space-y-5 p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Network className="h-6 w-6" /> Unified Job Registry</h1>
          <p className="text-sm text-muted-foreground">
            Pencatatan pekerjaan lintas AI Core, ChatGPT, OpenClaw dan worker.
            Refresh hanya saat halaman dibuka atau atas permintaan.
          </p>
        </div>
        <Button variant="outline" onClick={() => { void jobs.refetch(); void sessions.refetch(); }}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>
      {(jobs.isError || sessions.isError) && (
        <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
          <ShieldAlert className="h-4 w-4 inline mr-2" />
          Registry belum tersedia atau database belum dimigrasi. Periksa /api/readyz dan deploy migration.
          <span className="ml-2 text-muted-foreground">
            {jobs.error instanceof Error ? jobs.error.message : sessions.error instanceof Error ? sessions.error.message : ""}
          </span>
        </div>
      )}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {[
          ["Total job", rows.length],
          ["Running", rows.filter((j) => j.status === "RUNNING").length],
          ["Menunggu ACK", rows.filter((j) => j.status === "WAITING_FOR_ACK").length],
          ["Perlu perhatian", rows.filter((j) => ["FAILED", "SUSPECTED_STALL", "BLOCKED"].includes(j.status)).length],
        ].map(([label, value]) => (
          <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Pekerjaan terakhir</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b text-muted-foreground"><tr>
              <th className="py-2 pr-4">Sumber</th><th className="py-2 pr-4">Pekerjaan</th>
              <th className="py-2 pr-4">Owner</th><th className="py-2 pr-4">Status</th>
              <th className="py-2">Callback</th>
            </tr></thead>
            <tbody>
              {rows.map((j) => <tr key={j.id} className="border-b">
                <td className="py-2 pr-4">{j.source}</td>
                <td className="py-2 pr-4"><p className="font-medium">{j.title}</p><p className="text-xs text-muted-foreground">{j.external_id}</p></td>
                <td className="py-2 pr-4">{j.owner ?? "—"}</td>
                <td className="py-2 pr-4"><Badge variant={stateColor(j.status)}>{j.status}</Badge></td>
                <td className="py-2">{j.callback_received_at && j.result_verified_at ? "ACK tersimpan" : "Belum diverifikasi"}</td>
              </tr>)}
              {rows.length === 0 && <tr><td colSpan={5} className="py-5 text-muted-foreground text-center">
                {jobs.isLoading ? "Memuat…" : "Belum ada pekerjaan terdaftar"}
              </td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Sesi yang terdaftar</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {trackedSessions.map((s) => <div key={s.source + ":" + s.session_id} className="flex flex-wrap gap-3 items-center border-b pb-2 text-sm">
            <span className="font-medium">{s.source}</span>
            <span className="font-mono text-xs">{s.session_id}</span>
            <Badge variant={s.heartbeat_recent ? stateColor(s.state) : "destructive"}>{s.heartbeat_recent ? s.state : "HEARTBEAT_STALE"}</Badge>
            <span className="text-muted-foreground">{s.owner ?? "Belum ada pemilik"}</span>
          </div>)}
          {!sessions.isLoading && trackedSessions.length === 0 && <p className="text-muted-foreground text-sm">Belum ada sesi terdaftar.</p>}
        </CardContent>
      </Card>
    </main>
  );
}
