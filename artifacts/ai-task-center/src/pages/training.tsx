import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Brain, FlaskConical, BarChart3, GitBranch, Beaker, TrendingUp,
  Plus, Download, Archive, ChevronRight, RefreshCw, Play, Pause, CheckCheck,
} from "lucide-react";

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Correction { id: number; taskId: number; fieldCorrected: string; originalValue: string; correctedValue: string; correctedBy: string; status: string; createdAt: string; correctionReason?: string }
interface DatasetRecord { id: number; sourceTaskId?: number; originalMessage: string; fieldCorrected: string; correctValue: string; correctedBy: string; splitTag: string; createdAt: string; predictedIntent?: string; predictedConfidence?: number }
interface AccuracySummary { totalPredictions: number; totalCorrections: number; intentAccuracy: number | null; routingAccuracy: number | null; approvalAccuracy: number | null; fallbackRate: number | null; correctionRate: number | null; correctionsByField: Record<string, number> }
interface PromptVersion { id: number; versionLabel: string; systemPrompt: string; status: string; promptHash?: string; model: string; changelog?: string; createdBy: string; createdAt: string; activatedAt?: string }
interface Experiment { id: number; name: string; description?: string; status: string; controlVersionId: number; challengerVersionId: number; challengerTrafficPct: number; conclusion?: string; createdAt: string }
interface PerfSummary { last7Days: { totalPredictions: number; fallbackRate: number | null; correctionRate: number | null; avgLlmLatencyMs: number | null }; last30Days: { totalPredictions: number; correctionRate: number | null } }
interface PredictionLog { id: number; taskId?: number; predictedIntent?: string; predictedConfidence?: string; isFallback: boolean; wasCorrected: boolean; llmLatencyMs?: number; predictedAt: string }

// ─── Reusable components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    testing: "bg-blue-100 text-blue-800",
    draft: "bg-gray-100 text-gray-800",
    archived: "bg-slate-100 text-slate-500",
    running: "bg-emerald-100 text-emerald-800",
    paused: "bg-orange-100 text-orange-800",
    concluded: "bg-purple-100 text-purple-800",
    pending: "bg-yellow-100 text-yellow-800",
    exported_to_dataset: "bg-blue-100 text-blue-800",
  };
  return <Badge className={`text-xs ${cfg[status] ?? "bg-gray-100 text-gray-800"}`}>{status}</Badge>;
}

function MetricCard({ label, value, sub }: { label: string; value: string | number | null; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-bold">{value !== null && value !== undefined ? value : "—"}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Antrian Koreksi
// ══════════════════════════════════════════════════════════════════════════════

function CorrectionQueueTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [fieldFilter, setFieldFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("pending");

  const { data: corrections = [], isLoading } = useQuery<Correction[]>({
    queryKey: ["training-corrections", fieldFilter, statusFilter],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "100" });
      if (fieldFilter !== "all") p.set("field", fieldFilter);
      if (statusFilter && statusFilter !== "all") p.set("status", statusFilter);
      return apiFetch<Correction[]>(`/training/corrections?${p.toString()}`);
    },
  });

  const { data: pendingCount } = useQuery<{ count: number }>({
    queryKey: ["training-corrections-pending"],
    queryFn: () => apiFetch<{ count: number }>("/training/corrections/pending-count"),
    refetchInterval: 30_000,
  });

  const bulkExport = useMutation({
    mutationFn: () => apiPost<{ exported: number }>("/training/corrections/bulk-export"),
    onSuccess: (d) => {
      toast({ title: `${d.exported} koreksi diekspor ke dataset` });
      qc.invalidateQueries({ queryKey: ["training-corrections"] });
    },
    onError: (e) => toast({ title: "Gagal export", description: e.message, variant: "destructive" }),
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) => apiFetch<Correction>(`/training/corrections/${id}/archive`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["training-corrections"] }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Antrian Koreksi</h3>
          {(pendingCount?.count ?? 0) > 0 && (
            <Badge className="bg-red-100 text-red-800">{pendingCount?.count} pending</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => bulkExport.mutate()} disabled={bulkExport.isPending}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export ke Dataset
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="exported_to_dataset">Diekspor</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fieldFilter} onValueChange={setFieldFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Field" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Field</SelectItem>
            <SelectItem value="intent">Intent</SelectItem>
            <SelectItem value="routing_role">Routing</SelectItem>
            <SelectItem value="priority">Prioritas</SelectItem>
            <SelectItem value="sla_hours">SLA</SelectItem>
            <SelectItem value="approval_required">Approval Req</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task ID</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Nilai AI</TableHead>
              <TableHead>Koreksi</TableHead>
              <TableHead>Oleh</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Waktu</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : corrections.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Tidak ada koreksi</TableCell></TableRow>
            ) : corrections.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">#{c.taskId}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{c.fieldCorrected}</Badge></TableCell>
                <TableCell className="text-muted-foreground max-w-[120px] truncate text-xs">{c.originalValue}</TableCell>
                <TableCell className="font-medium max-w-[120px] truncate text-xs">{c.correctedValue}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.correctedBy}</TableCell>
                <TableCell><StatusBadge status={c.status} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("id-ID")}</TableCell>
                <TableCell>
                  {c.status === "pending" && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => archiveMut.mutate(c.id)}>
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — Training Dataset
// ══════════════════════════════════════════════════════════════════════════════

function DatasetTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [splitFilter, setSplitFilter] = useState("all");
  const [exporting, setExporting] = useState(false);

  const { data: records = [], isLoading } = useQuery<DatasetRecord[]>({
    queryKey: ["training-dataset", splitFilter],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "100" });
      if (splitFilter !== "all") p.set("split_tag", splitFilter);
      return apiFetch<DatasetRecord[]>(`/training/dataset?${p.toString()}`);
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["training-dataset-stats"],
    queryFn: () => apiFetch<{ total: number; byField: { field: string; cnt: number }[]; bySplit: { split: string; cnt: number }[] }>("/training/dataset/stats"),
  });

  const handleExport = async (format: "jsonl" | "csv") => {
    setExporting(true);
    try {
      const res = await fetch("/api/training/dataset/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ format, split_tag: splitFilter !== "all" ? splitFilter : undefined }),
      });
      if (!res.ok) throw new Error("Export gagal");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `training_export_${Date.now()}.${format === "csv" ? "csv" : "jsonl"}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Export ${format.toUpperCase()} berhasil`, description: `${records.length} records` });
    } catch (e) {
      toast({ title: "Export gagal", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const splitMut = useMutation({
    mutationFn: ({ id, splitTag }: { id: number; splitTag: string }) =>
      apiFetch<DatasetRecord>(`/training/dataset/${id}/split`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ splitTag }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["training-dataset"] }),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Total Records" value={stats?.total ?? 0} />
        {(stats?.bySplit ?? []).map((s) => (
          <MetricCard key={s.split} label={s.split} value={s.cnt} />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <Select value={splitFilter} onValueChange={setSplitFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Split Tag" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="train">Train</SelectItem>
              <SelectItem value="validation">Validation</SelectItem>
              <SelectItem value="test">Test</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {user?.role === "super_admin" && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => handleExport("jsonl")} disabled={exporting}>
              <Download className="h-3.5 w-3.5 mr-1.5" />JSONL
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleExport("csv")} disabled={exporting}>
              <Download className="h-3.5 w-3.5 mr-1.5" />CSV
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pesan</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Prediksi AI</TableHead>
              <TableHead>Koreksi</TableHead>
              <TableHead>Oleh</TableHead>
              <TableHead>Split</TableHead>
              <TableHead>Tanggal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : records.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Dataset kosong. Export koreksi terlebih dahulu.</TableCell></TableRow>
            ) : records.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-[200px] truncate text-xs" title={r.originalMessage}>{r.originalMessage}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{r.fieldCorrected}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.predictedIntent ?? "-"}</TableCell>
                <TableCell className="text-xs font-medium">{r.correctValue}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.correctedBy}</TableCell>
                <TableCell>
                  {user?.role === "company_admin" || user?.role === "super_admin" ? (
                    <Select value={r.splitTag} onValueChange={(v) => splitMut.mutate({ id: r.id, splitTag: v })}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="train">train</SelectItem>
                        <SelectItem value="validation">validation</SelectItem>
                        <SelectItem value="test">test</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : <Badge variant="outline" className="text-xs">{r.splitTag}</Badge>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("id-ID")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — Akurasi
// ══════════════════════════════════════════════════════════════════════════════

function AccuracyTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [period, setPeriod] = useState("30");

  const { data: summary, isLoading, refetch } = useQuery<AccuracySummary>({
    queryKey: ["training-accuracy", period],
    queryFn: () => apiFetch<AccuracySummary>(`/training/accuracy/summary?days=${period}`),
  });

  const snapshotMut = useMutation({
    mutationFn: () => apiPost("/training/accuracy/snapshot", { days: parseInt(period, 10) }),
    onSuccess: () => { toast({ title: "Snapshot akurasi dibuat" }); qc.invalidateQueries({ queryKey: ["training-accuracy"] }); },
    onError: (e) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const fmt = (v: number | null) => v !== null ? `${v.toFixed(1)}%` : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 hari</SelectItem>
              <SelectItem value="30">30 hari</SelectItem>
              <SelectItem value="90">90 hari</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
          </Button>
        </div>
        {user?.role === "super_admin" && (
          <Button size="sm" onClick={() => snapshotMut.mutate()} disabled={snapshotMut.isPending}>
            Simpan Snapshot
          </Button>
        )}
      </div>

      {isLoading ? <p className="text-muted-foreground text-sm">Memuat...</p> : summary && (
        <>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <MetricCard label="Intent Accuracy" value={fmt(summary.intentAccuracy)} />
            <MetricCard label="Routing Accuracy" value={fmt(summary.routingAccuracy)} />
            <MetricCard label="Approval Accuracy" value={fmt(summary.approvalAccuracy)} />
            <MetricCard label="Fallback Rate" value={fmt(summary.fallbackRate)} />
            <MetricCard label="Correction Rate" value={fmt(summary.correctionRate)} />
            <MetricCard label="Total Prediksi" value={summary.totalPredictions} />
          </div>

          {Object.keys(summary.correctionsByField).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Koreksi per Field</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(summary.correctionsByField).map(([field, count]) => (
                    <div key={field} className="flex items-center justify-between">
                      <span className="text-sm">{field}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-40 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${Math.min(100, (count / Math.max(...Object.values(summary.correctionsByField))) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — Prompt Versions
// ══════════════════════════════════════════════════════════════════════════════

function PromptVersionsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newChangelog, setNewChangelog] = useState("");
  const [selected, setSelected] = useState<PromptVersion | null>(null);

  const { data: versions = [], isLoading } = useQuery<PromptVersion[]>({
    queryKey: ["prompt-versions"],
    queryFn: () => apiFetch<PromptVersion[]>("/training/prompt-versions"),
  });

  const createMut = useMutation({
    mutationFn: () => apiPost<PromptVersion>("/training/prompt-versions", {
      versionLabel: newLabel, systemPrompt: newPrompt, changelog: newChangelog,
    }),
    onSuccess: () => {
      toast({ title: "Draft prompt dibuat" });
      qc.invalidateQueries({ queryKey: ["prompt-versions"] });
      setCreating(false); setNewLabel(""); setNewPrompt(""); setNewChangelog("");
    },
    onError: (e) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const promoteMut = useMutation({
    mutationFn: (id: number) => apiPost<PromptVersion>(`/training/prompt-versions/${id}/promote`),
    onSuccess: () => { toast({ title: "Prompt dipromote" }); qc.invalidateQueries({ queryKey: ["prompt-versions"] }); },
    onError: (e) => toast({ title: "Gagal promote", description: e.message, variant: "destructive" }),
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) => apiPost<PromptVersion>(`/training/prompt-versions/${id}/archive`),
    onSuccess: () => { toast({ title: "Prompt diarsipkan" }); qc.invalidateQueries({ queryKey: ["prompt-versions"] }); },
    onError: (e) => toast({ title: "Gagal archive", description: e.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: (id: number) => apiPost<{ tested: number; intentAccuracy?: string }>(`/training/prompt-versions/${id}/run-test`),
    onSuccess: (d) => toast({ title: "Test selesai", description: d.intentAccuracy ? `Intent accuracy: ${d.intentAccuracy}%` : `${d.tested} records diuji` }),
    onError: (e) => toast({ title: "Test gagal", description: e.message, variant: "destructive" }),
  });

  const canPromote = (v: PromptVersion) => ["draft", "testing"].includes(v.status);
  const canArchive = (v: PromptVersion) => v.status !== "archived";
  const canTest = (v: PromptVersion) => v.status === "testing";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Prompt Versions</h3>
        {(user?.role === "company_admin" || user?.role === "super_admin") && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Buat Draft Baru
          </Button>
        )}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Memuat...</p> : (
        <div className="space-y-3">
          {versions.map((v) => (
            <Card key={v.id} className={`cursor-pointer transition-colors ${selected?.id === v.id ? "border-primary" : ""}`}
              onClick={() => setSelected(selected?.id === v.id ? null : v)}>
              <CardContent className="py-4 px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{v.versionLabel}</span>
                      <StatusBadge status={v.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {v.model} · Dibuat oleh {v.createdBy} · {new Date(v.createdAt).toLocaleDateString("id-ID")}
                    </p>
                    {v.changelog && <p className="text-xs text-muted-foreground mt-1 truncate">{v.changelog}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canTest(v) && (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); testMut.mutate(v.id); }} disabled={testMut.isPending}>
                        <FlaskConical className="h-3.5 w-3.5 mr-1" />Uji
                      </Button>
                    )}
                    {canPromote(v) && (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); promoteMut.mutate(v.id); }} disabled={promoteMut.isPending}>
                        <ChevronRight className="h-3.5 w-3.5 mr-1" />Promote
                      </Button>
                    )}
                    {canArchive(v) && user?.role === "super_admin" && (
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); archiveMut.mutate(v.id); }} disabled={archiveMut.isPending}>
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                {selected?.id === v.id && (
                  <div className="mt-4 rounded-md bg-muted p-3">
                    <p className="text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{v.systemPrompt}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {versions.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Belum ada prompt version</p>}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Buat Draft Prompt Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Label Versi *</Label>
              <Input placeholder="Contoh: v6 - tambah intent kredit" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>System Prompt *</Label>
              <Textarea className="font-mono text-xs" rows={10} placeholder="Tulis system prompt lengkap di sini..." value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Changelog</Label>
              <Textarea rows={2} placeholder="Apa yang berubah dari versi sebelumnya?" value={newChangelog} onChange={(e) => setNewChangelog(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Batal</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !newLabel || !newPrompt}>
              {createMut.isPending ? "Menyimpan..." : "Simpan Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — Eksperimen
// ══════════════════════════════════════════════════════════════════════════════

function ExperimentsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", controlVersionId: "", challengerVersionId: "", challengerTrafficPct: "20", primaryMetric: "intent_accuracy", description: "" });

  const { data: experiments = [], isLoading } = useQuery<Experiment[]>({
    queryKey: ["training-experiments"],
    queryFn: () => apiFetch<Experiment[]>("/training/experiments"),
  });

  const { data: versions = [] } = useQuery<PromptVersion[]>({
    queryKey: ["prompt-versions"],
    queryFn: () => apiFetch<PromptVersion[]>("/training/prompt-versions"),
  });

  const createMut = useMutation({
    mutationFn: () => apiPost<Experiment>("/training/experiments", {
      ...form,
      controlVersionId: parseInt(form.controlVersionId, 10),
      challengerVersionId: parseInt(form.challengerVersionId, 10),
      challengerTrafficPct: parseInt(form.challengerTrafficPct, 10),
    }),
    onSuccess: () => {
      toast({ title: "Eksperimen dibuat" }); qc.invalidateQueries({ queryKey: ["training-experiments"] });
      setCreating(false);
    },
    onError: (e) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const startMut = useMutation({
    mutationFn: (id: number) => apiPost(`/training/experiments/${id}/start`),
    onSuccess: () => { toast({ title: "Eksperimen dimulai" }); qc.invalidateQueries({ queryKey: ["training-experiments"] }); },
    onError: (e) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const pauseMut = useMutation({
    mutationFn: (id: number) => apiPost(`/training/experiments/${id}/pause`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["training-experiments"] }),
  });

  const concludeMut = useMutation({
    mutationFn: ({ id, conclusion }: { id: number; conclusion: string }) =>
      apiPost(`/training/experiments/${id}/conclude`, { conclusion }),
    onSuccess: () => { toast({ title: "Eksperimen disimpulkan" }); qc.invalidateQueries({ queryKey: ["training-experiments"] }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">AI Experiments (A/B Testing)</h3>
        {(user?.role === "company_admin" || user?.role === "super_admin") && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Buat Eksperimen
          </Button>
        )}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Memuat...</p> : (
        <div className="space-y-3">
          {experiments.map((exp) => (
            <Card key={exp.id}>
              <CardContent className="py-4 px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{exp.name}</span>
                      <StatusBadge status={exp.status} />
                      {exp.conclusion && <Badge className="text-xs bg-purple-100 text-purple-800">{exp.conclusion}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Control v{exp.controlVersionId} vs Challenger v{exp.challengerVersionId} · Split {exp.challengerTrafficPct}% · {new Date(exp.createdAt).toLocaleDateString("id-ID")}
                    </p>
                    {exp.description && <p className="text-xs text-muted-foreground mt-1">{exp.description}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {exp.status === "draft" && user?.role === "super_admin" && (
                      <Button size="sm" variant="outline" onClick={() => startMut.mutate(exp.id)}>
                        <Play className="h-3.5 w-3.5 mr-1" />Mulai
                      </Button>
                    )}
                    {exp.status === "running" && (user?.role === "company_admin" || user?.role === "super_admin") && (
                      <Button size="sm" variant="outline" onClick={() => pauseMut.mutate(exp.id)}>
                        <Pause className="h-3.5 w-3.5 mr-1" />Pause
                      </Button>
                    )}
                    {["running", "paused"].includes(exp.status) && user?.role === "super_admin" && (
                      <Button size="sm" variant="outline" onClick={() => concludeMut.mutate({ id: exp.id, conclusion: "inconclusive" })}>
                        <CheckCheck className="h-3.5 w-3.5 mr-1" />Conclude
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {experiments.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Belum ada eksperimen</p>}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>Buat Eksperimen Baru</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nama Eksperimen *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Control Version *</Label>
                <Select value={form.controlVersionId} onValueChange={(v) => setForm((f) => ({ ...f, controlVersionId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Pilih versi..." /></SelectTrigger>
                  <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.versionLabel}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Challenger Version *</Label>
                <Select value={form.challengerVersionId} onValueChange={(v) => setForm((f) => ({ ...f, challengerVersionId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Pilih versi..." /></SelectTrigger>
                  <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.versionLabel}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Traffic Challenger (%) *</Label>
              <Input type="number" min={5} max={50} value={form.challengerTrafficPct} onChange={(e) => setForm((f) => ({ ...f, challengerTrafficPct: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Batal</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name || !form.controlVersionId || !form.challengerVersionId}>
              {createMut.isPending ? "Menyimpan..." : "Buat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 6 — Performa Model
// ══════════════════════════════════════════════════════════════════════════════

function PerformanceTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [logLimit, setLogLimit] = useState("50");
  const [intentFilter, setIntentFilter] = useState("");

  const { data: summary } = useQuery<PerfSummary>({
    queryKey: ["training-perf-summary"],
    queryFn: () => apiFetch<PerfSummary>("/training/performance/summary"),
    refetchInterval: 60_000,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<PredictionLog[]>({
    queryKey: ["training-prediction-logs", logLimit, intentFilter],
    queryFn: () => {
      const p = new URLSearchParams({ limit: logLimit });
      if (intentFilter) p.set("intent", intentFilter);
      return apiFetch<PredictionLog[]>(`/training/prediction-logs?${p.toString()}`);
    },
  });

  const rebuildMut = useMutation({
    mutationFn: () => apiPost("/training/performance/rebuild", { date: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => { toast({ title: "Rebuild selesai" }); qc.invalidateQueries({ queryKey: ["training-perf-summary"] }); },
    onError: (e) => toast({ title: "Gagal rebuild", description: e.message, variant: "destructive" }),
  });

  const fmt = (v: number | null | undefined) => v !== null && v !== undefined ? `${Number(v).toFixed(1)}%` : "—";

  return (
    <div className="space-y-6">
      {summary && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground">7 Hari Terakhir</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Total Prediksi" value={summary.last7Days.totalPredictions} />
            <MetricCard label="Fallback Rate" value={fmt(summary.last7Days.fallbackRate)} />
            <MetricCard label="Correction Rate" value={fmt(summary.last7Days.correctionRate)} />
            <MetricCard label="Avg Latency" value={summary.last7Days.avgLlmLatencyMs !== null ? `${summary.last7Days.avgLlmLatencyMs}ms` : "—"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Total Prediksi (30 hari)" value={summary.last30Days.totalPredictions} />
            <MetricCard label="Correction Rate (30 hari)" value={fmt(summary.last30Days.correctionRate)} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Prediction Logs</h4>
        <div className="flex gap-2">
          <Input
            className="w-40 h-8 text-sm"
            placeholder="Filter intent..."
            value={intentFilter}
            onChange={(e) => setIntentFilter(e.target.value)}
          />
          <Select value={logLimit} onValueChange={setLogLimit}>
            <SelectTrigger className="w-24 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          {user?.role === "super_admin" && (
            <Button size="sm" variant="outline" onClick={() => rebuildMut.mutate()} disabled={rebuildMut.isPending}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />Rebuild
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task ID</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Fallback</TableHead>
              <TableHead>Dikoreksi</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Waktu</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logsLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : logs.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada prediction logs</TableCell></TableRow>
            ) : logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-mono text-xs">{l.taskId ? `#${l.taskId}` : "-"}</TableCell>
                <TableCell className="text-xs">{l.predictedIntent ?? "-"}</TableCell>
                <TableCell>
                  <Badge className={`text-xs ${l.predictedConfidence === "high" ? "bg-green-100 text-green-800" : l.predictedConfidence === "low" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}>
                    {l.predictedConfidence ?? "-"}
                  </Badge>
                </TableCell>
                <TableCell>{l.isFallback ? <Badge className="text-xs bg-red-100 text-red-800">fallback</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell>{l.wasCorrected ? <Badge className="text-xs bg-orange-100 text-orange-800">ya</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs">{l.llmLatencyMs ? `${l.llmLatencyMs}ms` : "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(l.predictedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function TrainingPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <Brain className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">AI Training & Feedback Loop</h1>
          <p className="text-sm text-muted-foreground">Koreksi prediksi AI, kelola dataset, pantau akurasi, dan optimalkan prompt</p>
        </div>
      </div>

      <Tabs defaultValue="corrections" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="corrections" className="flex items-center gap-1.5 text-xs">
            <Brain className="h-3.5 w-3.5" />Antrian Koreksi
          </TabsTrigger>
          <TabsTrigger value="dataset" className="flex items-center gap-1.5 text-xs">
            <GitBranch className="h-3.5 w-3.5" />Dataset
          </TabsTrigger>
          <TabsTrigger value="accuracy" className="flex items-center gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />Akurasi
          </TabsTrigger>
          <TabsTrigger value="prompts" className="flex items-center gap-1.5 text-xs">
            <GitBranch className="h-3.5 w-3.5" />Prompt Versions
          </TabsTrigger>
          <TabsTrigger value="experiments" className="flex items-center gap-1.5 text-xs">
            <Beaker className="h-3.5 w-3.5" />Eksperimen
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-1.5 text-xs">
            <TrendingUp className="h-3.5 w-3.5" />Performa Model
          </TabsTrigger>
        </TabsList>

        <TabsContent value="corrections" className="mt-6"><CorrectionQueueTab /></TabsContent>
        <TabsContent value="dataset" className="mt-6"><DatasetTab /></TabsContent>
        <TabsContent value="accuracy" className="mt-6"><AccuracyTab /></TabsContent>
        <TabsContent value="prompts" className="mt-6"><PromptVersionsTab /></TabsContent>
        <TabsContent value="experiments" className="mt-6"><ExperimentsTab /></TabsContent>
        <TabsContent value="performance" className="mt-6"><PerformanceTab /></TabsContent>
      </Tabs>
    </div>
  );
}
