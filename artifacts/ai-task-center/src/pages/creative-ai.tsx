import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wand2, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  Download, ExternalLink, ImageOff, ArrowLeft, Sparkles, KeyRound,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

// ─── API helpers ───────────────────────────────────────────────────────────────

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function apiFetch(path: string) {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${getToken()}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path: string) {
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CreativeJob {
  taskId: number;
  taskNumber: string;
  title: string;
  taskStatus: string;
  category: string;
  customerPhone: string | null;
  createdAt: string;
  serviceRequestId: number | null;
  aiStatus: string | null;
  imageUrl: string | null;
  prompt: string | null;
  aiCreatedAt: string | null;
}

interface JobDetail extends CreativeJob {
  updatedAt: string;
  errorMessage: string | null;
  aiHistory: unknown[];
}

interface PlatformStatus {
  provider: string;
  model: string;
  apiKeySet: boolean;
  status: string;
  message: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(aiStatus: string | null, taskStatus: string) {
  if (!aiStatus) {
    if (taskStatus === "In Progress") return <Badge className="bg-blue-100 text-blue-700">Memproses...</Badge>;
    if (taskStatus === "Completed")   return <Badge className="bg-green-100 text-green-700">Selesai</Badge>;
    return <Badge className="bg-gray-100 text-gray-600">Menunggu</Badge>;
  }
  if (aiStatus === "completed") return <Badge className="bg-green-100 text-green-700">Selesai</Badge>;
  if (aiStatus === "failed")    return <Badge className="bg-red-100 text-red-700">Gagal</Badge>;
  if (aiStatus === "pending")   return <Badge className="bg-blue-100 text-blue-700">Memproses...</Badge>;
  return <Badge className="bg-gray-100 text-gray-600">{aiStatus}</Badge>;
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: localeId });
  } catch { return dateStr; }
}

// ─── Job Card ─────────────────────────────────────────────────────────────────

function JobCard({ job, onRetry, retrying }: { job: CreativeJob; onRetry: (id: number) => void; retrying: boolean }) {
  const isDone   = job.aiStatus === "completed" || job.taskStatus === "Completed";
  const isFailed = job.aiStatus === "failed";

  return (
    <Card className="overflow-hidden">
      {/* Image preview */}
      <div className="relative bg-gray-50 border-b border-gray-100 aspect-square max-h-52 flex items-center justify-center overflow-hidden">
        {job.imageUrl ? (
          <img
            src={job.imageUrl}
            alt={`Logo ${job.title}`}
            className="w-full h-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : isFailed ? (
          <div className="flex flex-col items-center gap-2 text-red-400">
            <AlertTriangle className="h-10 w-10 opacity-40" />
            <p className="text-xs">Generate gagal</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-blue-400">
            <Wand2 className="h-10 w-10 opacity-40 animate-pulse" />
            <p className="text-xs">Sedang memproses...</p>
          </div>
        )}
      </div>

      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{job.title}</p>
            <p className="text-xs text-gray-400">{job.taskNumber}</p>
          </div>
          {statusBadge(job.aiStatus, job.taskStatus)}
        </div>

        {job.prompt && (
          <p className="text-xs text-gray-500 line-clamp-2 italic">"{job.prompt.slice(0, 120)}..."</p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-gray-400">{timeAgo(job.createdAt)}</span>
          <div className="flex gap-1.5">
            {isDone && job.imageUrl && (
              <a href={job.imageUrl} download target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="h-7 text-xs px-2">
                  <Download className="h-3 w-3 mr-1" /> Download
                </Button>
              </a>
            )}
            {isFailed && (
              <Button
                size="sm" variant="outline"
                className="h-7 text-xs px-2 text-orange-600 border-orange-200"
                onClick={() => onRetry(job.taskId)}
                disabled={retrying}
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${retrying ? "animate-spin" : ""}`} />
                Retry
              </Button>
            )}
            <a href={`/creative-ai/${job.taskId}`}>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2">
                <ExternalLink className="h-3 w-3 mr-1" /> Detail
              </Button>
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function JobDetailView({ taskId }: { taskId: number }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery<JobDetail>({
    queryKey: ["creative-ai-detail", taskId],
    queryFn: () => apiFetch(`/api/creative-ai/jobs/${taskId}`),
    refetchInterval: (d) => (d?.state?.data?.aiStatus === "pending" || d?.state?.data?.taskStatus === "In Progress") ? 5000 : false,
  });

  const retry = useMutation({
    mutationFn: () => apiPost(`/api/creative-ai/retry/${taskId}`),
    onSuccess: () => { setTimeout(() => { void refetch(); void qc.invalidateQueries({ queryKey: ["creative-ai-jobs"] }); }, 2000); },
  });

  if (isLoading) return <div className="py-20 text-center text-sm text-gray-400">Memuat detail...</div>;
  if (!data) return <div className="py-20 text-center text-sm text-red-400">Job tidak ditemukan</div>;

  const isDone   = data.aiStatus === "completed" || data.taskStatus === "Completed";
  const isFailed = data.aiStatus === "failed";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <a href="/creative-ai">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Kembali</Button>
        </a>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">{data.title}</h1>
          <p className="text-sm text-gray-400">{data.taskNumber} · {timeAgo(data.createdAt)}</p>
        </div>
        {statusBadge(data.aiStatus, data.taskStatus)}
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {/* Logo result */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-purple-500" /> Hasil Logo AI
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isDone && data.imageUrl ? (
            <div className="space-y-4">
              <div className="border rounded-lg overflow-hidden bg-white p-4 flex items-center justify-center min-h-64">
                <img src={data.imageUrl} alt="Generated Logo" className="max-w-full max-h-80 object-contain" />
              </div>
              <div className="flex gap-2">
                <a href={data.imageUrl} download target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button className="w-full" size="sm">
                    <Download className="h-4 w-4 mr-2" /> Download Logo
                  </Button>
                </a>
                <a href={data.imageUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="h-4 w-4 mr-1" /> Buka
                  </Button>
                </a>
              </div>
            </div>
          ) : isFailed ? (
            <div className="py-12 flex flex-col items-center gap-3 text-red-400">
              <AlertTriangle className="h-12 w-12 opacity-40" />
              <p className="text-sm font-medium">Generate logo gagal</p>
              {data.errorMessage && <p className="text-xs text-gray-400 max-w-sm text-center">{data.errorMessage}</p>}
              <Button
                size="sm" variant="outline"
                className="mt-2 text-orange-600 border-orange-200"
                onClick={() => retry.mutate()}
                disabled={retry.isPending}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${retry.isPending ? "animate-spin" : ""}`} />
                {retry.isPending ? "Mencoba ulang..." : "Coba Lagi"}
              </Button>
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center gap-3 text-blue-400">
              <Wand2 className="h-12 w-12 opacity-40 animate-pulse" />
              <p className="text-sm font-medium">Logo sedang diproses oleh AI...</p>
              <p className="text-xs text-gray-400">Biasanya selesai dalam 30–60 detik. Halaman akan otomatis update.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prompt used */}
      {data.prompt && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Prompt yang Digunakan</CardTitle>
            <CardDescription className="text-xs">Deskripsi yang dikirim ke FLUX.1</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 bg-gray-50 rounded p-3 leading-relaxed">{data.prompt}</p>
          </CardContent>
        </Card>
      )}

      {/* Task info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Info Task</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-gray-400">Task ID</dt><dd className="font-medium">#{data.taskId}</dd></div>
            <div><dt className="text-gray-400">Status Task</dt><dd className="font-medium">{data.taskStatus}</dd></div>
            <div><dt className="text-gray-400">Nomor WA</dt><dd className="font-medium">{data.customerPhone ?? "—"}</dd></div>
            <div><dt className="text-gray-400">Dibuat</dt><dd className="font-medium">{timeAgo(data.createdAt)}</dd></div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CreativeAiPage() {
  const [matchDetail, params] = useRoute("/creative-ai/:taskId");
  const taskId = matchDetail ? Number(params?.taskId) : null;
  const { user } = useAuth();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<"all" | "completed" | "failed" | "processing">("all");

  const { data, isLoading, refetch, isFetching } = useQuery<{ jobs: CreativeJob[] }>({
    queryKey: ["creative-ai-jobs"],
    queryFn: () => apiFetch("/api/creative-ai/jobs"),
    refetchInterval: 15_000,
  });

  const { data: platformStatus } = useQuery<PlatformStatus>({
    queryKey: ["creative-ai-status"],
    queryFn: () => apiFetch("/api/creative-ai/status"),
  });

  const retry = useMutation({
    mutationFn: (taskId: number) => apiPost(`/api/creative-ai/retry/${taskId}`),
    onSuccess: () => {
      setTimeout(() => { void refetch(); void qc.invalidateQueries({ queryKey: ["creative-ai-jobs"] }); }, 2000);
    },
  });

  // Show detail view if on /creative-ai/:taskId
  if (taskId) return (
    <div className="p-6">
      <JobDetailView taskId={taskId} />
    </div>
  );

  const jobs = data?.jobs ?? [];
  const filtered = jobs.filter((j) => {
    if (filter === "completed")  return j.aiStatus === "completed" || j.taskStatus === "Completed";
    if (filter === "failed")     return j.aiStatus === "failed";
    if (filter === "processing") return !j.aiStatus || j.aiStatus === "pending" || j.taskStatus === "In Progress";
    return true;
  });

  const stats = {
    total:      jobs.length,
    completed:  jobs.filter((j) => j.aiStatus === "completed" || j.taskStatus === "Completed").length,
    failed:     jobs.filter((j) => j.aiStatus === "failed").length,
    processing: jobs.filter((j) => !j.aiStatus || j.aiStatus === "pending").length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Wand2 className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Creative AI — Logo Generator</h1>
            <p className="text-sm text-gray-500">Generate logo otomatis menggunakan FLUX.1 via Together.ai</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* API key warning */}
      {platformStatus && !platformStatus.apiKeySet && (
        <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm text-orange-800">
          <KeyRound className="h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">TOGETHER_AI_API_KEY belum di-set</p>
            <p className="text-xs text-orange-600 mt-0.5">
              Tambahkan API key Together.ai di Replit Secrets untuk mengaktifkan logo generation.
              Daftar gratis di <span className="underline">together.ai</span>.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Request",  value: stats.total,      icon: <Sparkles className="h-4 w-4" />, color: "purple" },
          { label: "Selesai",        value: stats.completed,  icon: <CheckCircle2 className="h-4 w-4" />, color: "green" },
          { label: "Memproses",      value: stats.processing, icon: <Clock className="h-4 w-4" />, color: "blue" },
          { label: "Gagal",          value: stats.failed,     icon: <AlertTriangle className="h-4 w-4" />, color: "red" },
        ].map((s) => {
          const colors: Record<string, string> = {
            purple: "bg-purple-50 text-purple-600",
            green:  "bg-green-50 text-green-600",
            blue:   "bg-blue-50 text-blue-600",
            red:    "bg-red-50 text-red-600",
          };
          return (
            <Card key={s.label}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <div className={`p-1.5 rounded-md ${colors[s.color]}`}>{s.icon}</div>
                  <div>
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <p className="text-xl font-bold text-gray-900">{s.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5">
        {(["all", "completed", "processing", "failed"] as const).map((f) => (
          <Button
            key={f}
            size="sm" variant={filter === f ? "default" : "outline"}
            className="text-xs h-7"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "Semua" : f === "completed" ? "Selesai" : f === "processing" ? "Diproses" : "Gagal"}
          </Button>
        ))}
      </div>

      {/* Jobs grid */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-400">Memuat data...</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
          <ImageOff className="h-10 w-10 opacity-30" />
          <p className="text-sm">
            {jobs.length === 0
              ? "Belum ada request logo. Customer bisa kirim WA: 'bikin logo' untuk memulai."
              : "Tidak ada job dengan filter ini."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((job) => (
            <JobCard
              key={job.taskId}
              job={job}
              onRetry={(id) => retry.mutate(id)}
              retrying={retry.isPending}
            />
          ))}
        </div>
      )}

      {/* Platform info */}
      {platformStatus && (
        <div className="text-xs text-gray-400 text-center pt-2">
          Provider: <span className="font-medium text-gray-600">{platformStatus.provider}</span> ·
          Model: <span className="font-medium text-gray-600">{platformStatus.model}</span>
        </div>
      )}
    </div>
  );
}
