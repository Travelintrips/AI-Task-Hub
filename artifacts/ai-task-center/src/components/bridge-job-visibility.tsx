import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";
import { RefreshCw, ExternalLink } from "lucide-react";

type BridgeJob = {
  id: string;
  title: string;
  source: string;
  status: string;
  external_id: string;
  callback_received_at: string | null;
  result_verified_at: string | null;
  created_at: string;
};

async function fetchRegistryJobs(): Promise<{ jobs: BridgeJob[] }> {
  const token = getStoredToken();
  const response = await fetch("/api/bridge/admin/jobs", {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

export function BridgeJobVisibility({ location }: { location: "dashboard" | "ai-tasks" }) {
  const { user } = useAuth();
  const authorized = user?.role === "super_admin";
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["bridge-admin-jobs"],
    queryFn: fetchRegistryJobs,
    enabled: authorized,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
  if (!authorized) return null;

  const jobs = data?.jobs ?? [];
  const verified = jobs.filter(job => job.status === "COMPLETED" && Boolean(job.result_verified_at));
  const needsAttention = jobs.filter(job =>
    ["FAILED", "BLOCKED", "SUSPECTED_STALL"].includes(job.status)
  );
  return (
    <section aria-label="Integrasi AI Core" data-testid={"bridge-visibility-" + location}
      className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-3 text-sm">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
        <div>
          <strong className="font-semibold">Pekerjaan Integrasi AI Core / GPT02</strong>
          <p className="text-xs text-slate-600">
            Terhubung ke Job Registry DEV; terpisah dari AI Tasks agar tidak menggandakan tugas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => void refetch()} disabled={isFetching}
            aria-label="Refresh pekerjaan integrasi" className="text-blue-700 hover:underline disabled:opacity-50">
            <RefreshCw className={"w-4 h-4 " + (isFetching ? "animate-spin" : "")} />
          </button>
          <Link href="/bridge-jobs" className="text-blue-700 font-medium hover:underline inline-flex items-center gap-1">
            Job Registry <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
      {isLoading && <p className="text-slate-600">Memuat hasil integrasi…</p>}
      {isError && <p role="alert" className="text-red-700">
        Tidak dapat membaca Job Registry ({error instanceof Error ? error.message : "kesalahan API"}).
      </p>}
      {data && <>
        <p className="text-xs text-slate-600 mb-2">
          Dari {jobs.length} job terbaru: {verified.length} selesai dengan ACK terverifikasi, {needsAttention.length} perlu perhatian.
        </p>
        {jobs.length === 0 && <p>Belum ada pekerjaan integrasi yang tercatat.</p>}
        <div className="flex flex-wrap gap-2">
          {jobs.slice(0, 4).map(job => (
            <Link key={job.id} href={"/bridge-jobs?job=" + encodeURIComponent(job.id)}
              title={"Lihat hasil dan event " + job.title}
              className="rounded border border-slate-200 bg-white px-2 py-1 hover:border-blue-500 hover:text-blue-700">
              <span className="font-medium">{job.title}</span>
              <span className="ml-2 text-xs text-slate-600">{job.status}</span>
              {job.result_verified_at && <span className="ml-2 text-xs text-green-700">ACK</span>}
            </Link>
          ))}
        </div>
      </>}
    </section>
  );
}
