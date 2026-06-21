import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ShoppingCart, TrendingUp, AlertTriangle, CheckCircle, XCircle,
  RefreshCw, Shield, DollarSign, BarChart3, Clock, Plus,
  ChevronRight, Eye, Zap, Copy, FileWarning, Activity,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Risk Badge ────────────────────────────────────────────────────────────────

function RiskBadge({ tier, score }: { tier?: string | null; score?: number | null }) {
  if (!tier) return <Badge variant="outline" className="text-gray-500">Mengevaluasi...</Badge>;
  const cfg: Record<string, { cls: string; label: string }> = {
    low:      { cls: "bg-green-100 text-green-800 border-green-300",  label: "LOW" },
    medium:   { cls: "bg-yellow-100 text-yellow-800 border-yellow-300", label: "MEDIUM" },
    high:     { cls: "bg-orange-100 text-orange-800 border-orange-300", label: "HIGH" },
    critical: { cls: "bg-red-100 text-red-800 border-red-300 animate-pulse", label: "CRITICAL" },
  };
  const c = cfg[tier] ?? cfg.low;
  return (
    <Badge className={`${c.cls} border font-bold text-xs`}>
      <Shield className="h-3 w-3 mr-1" />
      {c.label}{score != null ? ` · ${score}` : ""}
    </Badge>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    pending_review: "bg-blue-100 text-blue-700",
    submitted_for_approval: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    cancelled: "bg-gray-200 text-gray-500",
  };
  const labels: Record<string, string> = {
    draft: "Draft",
    pending_review: "Pending Review",
    submitted_for_approval: "Menunggu Approval",
    approved: "Disetujui",
    rejected: "Ditolak",
    cancelled: "Dibatalkan",
  };
  return <Badge className={`text-xs ${cfg[status] ?? "bg-gray-100 text-gray-600"}`}>{labels[status] ?? status}</Badge>;
}

// ── Budget Progress Bar ───────────────────────────────────────────────────────

function BudgetBar({ used, pending, allocated }: { used: number; pending: number; allocated: number }) {
  if (!allocated) return <div className="text-xs text-muted-foreground">Tidak ada data budget</div>;
  const usedPct = Math.min((used / allocated) * 100, 100);
  const pendingPct = Math.min((pending / allocated) * 100, 100 - usedPct);
  const total = usedPct + pendingPct;
  return (
    <div className="space-y-1">
      <div className="w-full bg-gray-200 rounded-full h-3 relative overflow-hidden">
        <div className="h-3 bg-blue-500 absolute left-0 rounded-l-full transition-all" style={{ width: `${usedPct}%` }} />
        <div className="h-3 bg-yellow-400 absolute transition-all" style={{ left: `${usedPct}%`, width: `${pendingPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Terpakai: {usedPct.toFixed(0)}%</span>
        <span>Pending: {pendingPct.toFixed(0)}%</span>
        <span className={total > 100 ? "text-red-600 font-bold" : ""}>Total: {total.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ── Margin Gauge ──────────────────────────────────────────────────────────────

function MarginGauge({ pct, floor = 15 }: { pct?: number | null; floor?: number }) {
  if (pct == null) return <div className="text-xs text-muted-foreground">Data tidak tersedia</div>;
  const color = pct < 0 ? "text-red-700" : pct < floor ? "text-orange-600" : "text-green-700";
  const bg = pct < 0 ? "bg-red-500" : pct < floor ? "bg-orange-400" : "bg-green-500";
  const width = Math.min(Math.max(pct, 0), 50) * 2;
  return (
    <div className="space-y-1">
      <div className={`text-2xl font-bold ${color}`}>{pct.toFixed(1)}%</div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className={`h-2 rounded-full ${bg}`} style={{ width: `${width}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">Floor: {floor}% | {pct < floor ? "⚠️ DI BAWAH FLOOR" : "✓ OK"}</div>
    </div>
  );
}

// ── Signal Timeline ───────────────────────────────────────────────────────────

function SignalTimeline({ signals }: { signals: any[] }) {
  const severityIcon: Record<string, React.ReactNode> = {
    info: <Activity className="h-4 w-4 text-blue-500" />,
    warning: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
    critical: <Zap className="h-4 w-4 text-red-500" />,
  };
  const typeLabel: Record<string, string> = {
    price_benchmark: "Benchmark Harga",
    duplicate_detected: "Duplikat",
    supplier_risk: "Risiko Vendor",
    budget_impact: "Dampak Budget",
    margin_impact: "Dampak Margin",
    composite: "Evaluasi Komprehensif",
  };

  if (!signals.length) return (
    <div className="text-center text-muted-foreground py-8 text-sm">
      Belum ada signal AI. Request baru akan dievaluasi otomatis.
    </div>
  );

  return (
    <div className="space-y-3">
      {signals.map((s) => (
        <div key={s.id} className={`flex gap-3 p-3 rounded-lg border ${s.severity === "critical" ? "border-red-200 bg-red-50" : s.severity === "warning" ? "border-yellow-200 bg-yellow-50" : "border-blue-100 bg-blue-50"}`}>
          <div className="mt-0.5">{severityIcon[s.severity] ?? <Activity className="h-4 w-4 text-gray-400" />}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground">{typeLabel[s.signalType] ?? s.signalType}</span>
              {s.score != null && <span className="text-xs bg-white border rounded px-1">{s.score}/100</span>}
              <span className="text-xs text-muted-foreground ml-auto">{new Date(s.createdAt).toLocaleString("id-ID")}</span>
            </div>
            <div className="text-sm font-medium mt-0.5">{s.headline}</div>
            {s.explanation && <div className="text-xs text-muted-foreground mt-1">{s.explanation}</div>}
            {s.clarificationQuestions?.length > 0 && (
              <div className="mt-2 space-y-1">
                {s.clarificationQuestions.map((q: string, i: number) => (
                  <div key={i} className="text-xs bg-white rounded p-2 border border-yellow-200">❓ {q}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── New Request Form ──────────────────────────────────────────────────────────

function NewRequestDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    vendorName: "", serviceCategory: "", origin: "", destination: "",
    estimatedAmount: "", description: "", urgencyLevel: "normal",
    department: "", notes: "",
  });
  const { toast } = useToast();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (data: typeof form) =>
      apiFetch("/purchasing/requests", {
        method: "POST",
        body: JSON.stringify({ ...data, estimatedAmount: parseFloat(data.estimatedAmount) || 0 }),
      }),
    onSuccess: () => {
      toast({ title: "✅ Request dibuat", description: "AI sedang mengevaluasi..." });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["purchasing-requests"] });
      onCreated();
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Buat Request</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Purchase Request Baru</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nama Vendor</Label>
              <Input placeholder="PT. Vendor Logistik" value={form.vendorName} onChange={f("vendorName")} />
            </div>
            <div>
              <Label>Kategori Layanan *</Label>
              <Select value={form.serviceCategory} onValueChange={v => setForm(p => ({ ...p, serviceCategory: v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih..." /></SelectTrigger>
                <SelectContent>
                  {["trucking","sea_freight","air_freight","customs","warehouse","courier"].map(v => (
                    <SelectItem key={v} value={v}>{v.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Urgensi</Label>
              <Select value={form.urgencyLevel} onValueChange={v => setForm(p => ({ ...p, urgencyLevel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Origin</Label>
              <Input placeholder="Jakarta" value={form.origin} onChange={f("origin")} />
            </div>
            <div>
              <Label>Destination</Label>
              <Input placeholder="Surabaya" value={form.destination} onChange={f("destination")} />
            </div>
            <div className="col-span-2">
              <Label>Estimasi Biaya (IDR) *</Label>
              <Input type="number" placeholder="5000000" value={form.estimatedAmount} onChange={f("estimatedAmount")} />
            </div>
            <div className="col-span-2">
              <Label>Deskripsi</Label>
              <Input placeholder="Trucking 2 unit untuk pengiriman ke gudang..." value={form.description} onChange={f("description")} />
            </div>
            <div>
              <Label>Departemen</Label>
              <Input placeholder="Operations" value={form.department} onChange={f("department")} />
            </div>
          </div>
          <div>
            <Label>Catatan</Label>
            <Textarea rows={2} value={form.notes} onChange={f("notes")} placeholder="Informasi tambahan..." />
          </div>
          <Button
            className="w-full"
            disabled={createMut.isPending || !form.estimatedAmount}
            onClick={() => createMut.mutate(form)}
          >
            {createMut.isPending ? "Menyimpan..." : "Buat & Evaluasi AI"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Request Detail Panel ──────────────────────────────────────────────────────

function RequestDetailPanel({ requestId, onClose }: { requestId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: reqData } = useQuery({
    queryKey: ["purchasing-request", requestId],
    queryFn: () => apiFetch(`/purchasing/requests/${requestId}`),
    refetchInterval: 5000,
  });
  const { data: intelData } = useQuery({
    queryKey: ["purchasing-intel", requestId],
    queryFn: () => apiFetch(`/purchasing/requests/${requestId}/intel`),
    refetchInterval: 5000,
  });
  const { data: budgetData } = useQuery({
    queryKey: ["purchasing-budget-impact", requestId],
    queryFn: () => apiFetch(`/purchasing/requests/${requestId}/budget-impact`),
  });
  const { data: marginData } = useQuery({
    queryKey: ["purchasing-margin-impact", requestId],
    queryFn: () => apiFetch(`/purchasing/requests/${requestId}/margin-impact`),
  });
  const { data: adviceData } = useQuery({
    queryKey: ["purchasing-advice", requestId],
    queryFn: () => apiFetch(`/purchasing/requests/${requestId}/approval-advice`),
    refetchInterval: 8000,
  });

  const evalMut = useMutation({
    mutationFn: () => apiFetch(`/purchasing/requests/${requestId}/evaluate`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Re-evaluasi selesai" }); qc.invalidateQueries({ queryKey: ["purchasing-intel", requestId] }); qc.invalidateQueries({ queryKey: ["purchasing-request", requestId] }); },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });
  const submitMut = useMutation({
    mutationFn: () => apiFetch(`/purchasing/requests/${requestId}/submit-for-approval`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Berhasil diajukan untuk approval" }); qc.invalidateQueries({ queryKey: ["purchasing-advice", requestId] }); qc.invalidateQueries({ queryKey: ["purchasing-request", requestId] }); },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const lpr = reqData?.request;
  const signals: any[] = intelData?.signals ?? [];
  const advice = adviceData?.advice;
  const budget = budgetData?.budgetImpact;
  const margin = marginData?.marginImpact;

  if (!lpr) return <div className="p-6 text-center text-muted-foreground">Memuat...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-lg">{lpr.requestNumber}</h3>
            <StatusBadge status={lpr.status} />
            <RiskBadge tier={lpr.aiRiskTier} score={lpr.aiRiskScore} />
            {lpr.aiDuplicateFlag && (
              <Badge className="bg-red-100 text-red-800 border border-red-300">
                <Copy className="h-3 w-3 mr-1" />DUPLIKAT
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {lpr.vendorName ?? "—"} · {lpr.serviceCategory ?? "—"} · {lpr.origin ?? "—"} → {lpr.destination ?? "—"}
          </div>
          <div className="text-xl font-bold mt-1">
            {(lpr.estimatedAmount ?? 0).toLocaleString("id-ID")} {lpr.currency}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>✕</Button>
      </div>

      <Tabs defaultValue="intel">
        <TabsList className="w-full">
          <TabsTrigger value="intel" className="flex-1 text-xs">AI Signals</TabsTrigger>
          <TabsTrigger value="budget" className="flex-1 text-xs">Budget</TabsTrigger>
          <TabsTrigger value="margin" className="flex-1 text-xs">Margin</TabsTrigger>
          <TabsTrigger value="approval" className="flex-1 text-xs">Approval</TabsTrigger>
        </TabsList>

        {/* AI Signals Tab */}
        <TabsContent value="intel" className="mt-3 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" disabled={evalMut.isPending} onClick={() => evalMut.mutate()}>
              <RefreshCw className={`h-3 w-3 mr-1 ${evalMut.isPending ? "animate-spin" : ""}`} />
              Re-Evaluasi
            </Button>
          </div>
          <SignalTimeline signals={signals} />
        </TabsContent>

        {/* Budget Tab */}
        <TabsContent value="budget" className="mt-3">
          {budget ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Dampak Budget</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <BudgetBar
                  used={(budget.data as any)?.budgetUsed ?? 0}
                  pending={(budget.data as any)?.budgetPending ?? 0}
                  allocated={(budget.data as any)?.budgetAllocated ?? 0}
                />
                <div className={`p-3 rounded border text-sm ${budget.score >= 60 ? "bg-red-50 border-red-200" : budget.score >= 30 ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200"}`}>
                  <div className="font-medium">{budget.headline}</div>
                  <div className="text-xs text-muted-foreground mt-1">{budget.explanation}</div>
                </div>
              </CardContent>
            </Card>
          ) : <div className="text-center text-muted-foreground py-6 text-sm">Memuat data budget...</div>}
        </TabsContent>

        {/* Margin Tab */}
        <TabsContent value="margin" className="mt-3">
          {margin ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Dampak Margin</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <MarginGauge pct={(margin.data as any)?.projectedMarginPct != null ? (margin.data as any).projectedMarginPct * 100 : null} />
                <div className={`p-3 rounded border text-sm ${margin.score >= 60 ? "bg-red-50 border-red-200" : margin.score >= 30 ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200"}`}>
                  <div className="font-medium">{margin.headline}</div>
                  <div className="text-xs text-muted-foreground mt-1">{margin.explanation}</div>
                </div>
              </CardContent>
            </Card>
          ) : <div className="text-center text-muted-foreground py-6 text-sm">Memuat data margin...</div>}
        </TabsContent>

        {/* Approval Tab */}
        <TabsContent value="approval" className="mt-3">
          {advice ? (
            <div className="space-y-3">
              <Card className={advice.requiresApproval ? "border-orange-300 bg-orange-50" : "border-green-200 bg-green-50"}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    {advice.requiresApproval
                      ? <AlertTriangle className="h-4 w-4 text-orange-600" />
                      : <CheckCircle className="h-4 w-4 text-green-600" />}
                    <span className="font-medium text-sm">{advice.recommendation}</span>
                  </div>
                  {advice.approvalLevel && (
                    <div className="text-xs text-muted-foreground">Level approval: <strong>{advice.approvalLevel}</strong></div>
                  )}
                  {advice.existingApproval && (
                    <div className="text-xs bg-white rounded border p-2">
                      Status approval: <StatusBadge status={String(advice.existingApproval.status)} />
                    </div>
                  )}
                </CardContent>
              </Card>

              {advice.latestEvaluation?.clarificationQuestions?.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Pertanyaan Klarifikasi AI:</div>
                  {advice.latestEvaluation.clarificationQuestions.map((q: string, i: number) => (
                    <div key={i} className="text-sm bg-yellow-50 border border-yellow-200 rounded p-2">❓ {q}</div>
                  ))}
                </div>
              )}

              {advice.requiresApproval && !advice.existingApprovalId && lpr.status === "pending_review" && (
                <Button
                  className="w-full"
                  disabled={submitMut.isPending}
                  onClick={() => submitMut.mutate()}
                >
                  {submitMut.isPending ? "Mengajukan..." : "Ajukan untuk Approval"}
                </Button>
              )}
            </div>
          ) : <div className="text-center text-muted-foreground py-6 text-sm">Memuat advice...</div>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchasingIntelligencePage() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: requestsData, isLoading: reqLoading } = useQuery({
    queryKey: ["purchasing-requests", statusFilter, riskFilter, search],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (riskFilter !== "all") params.set("riskTier", riskFilter);
      if (search) params.set("search", search);
      return apiFetch(`/purchasing/requests?${params}`);
    },
    refetchInterval: 10000,
  });

  const { data: duplicatesData } = useQuery({
    queryKey: ["purchasing-duplicates"],
    queryFn: () => apiFetch("/purchasing/duplicates"),
  });

  const { data: benchmarkData } = useQuery({
    queryKey: ["purchasing-benchmarks"],
    queryFn: () => apiFetch("/purchasing/benchmark?limit=20"),
  });

  const { data: budgetData } = useQuery({
    queryKey: ["purchasing-budget"],
    queryFn: () => apiFetch("/purchasing/budget/summary"),
  });

  const { data: approvalsData } = useQuery({
    queryKey: ["purchasing-approvals"],
    queryFn: () => apiFetch("/purchasing/approval-requests?status=pending"),
  });

  const refreshBenchMut = useMutation({
    mutationFn: () => apiFetch("/purchasing/benchmark/refresh", { method: "POST" }),
    onSuccess: (d) => { toast({ title: `Benchmark diperbarui: ${d.refreshed} entri` }); qc.invalidateQueries({ queryKey: ["purchasing-benchmarks"] }); },
    onError: (err: Error) => toast({ title: "Gagal refresh", description: err.message, variant: "destructive" }),
  });

  const ingestMut = useMutation({
    mutationFn: () => apiFetch("/purchasing/signals/ingest", { method: "POST" }),
    onSuccess: (d) => { toast({ title: `Signal ingested: ${d.ingested} baru` }); qc.invalidateQueries({ queryKey: ["purchasing-requests"] }); },
    onError: (err: Error) => toast({ title: "Gagal ingest", description: err.message, variant: "destructive" }),
  });

  const requests: any[] = requestsData?.requests ?? [];
  const duplicates: any[] = duplicatesData?.duplicates ?? [];
  const benchmarks: any[] = benchmarkData?.benchmarks ?? [];
  const budgetCategories: any[] = budgetData?.categories ?? [];
  const budgetTotals = budgetData?.totals;
  const approvals: any[] = approvalsData?.approvalRequests ?? [];

  // Dashboard stats
  const stats = {
    total: requestsData?.total ?? 0,
    pending: requests.filter(r => r.status === "pending_review").length,
    high: requests.filter(r => r.aiRiskTier === "high" || r.aiRiskTier === "critical").length,
    duplicates: duplicates.length,
    pendingApprovals: approvals.length,
  };

  const confidenceColor: Record<string, string> = {
    high: "text-green-700", medium: "text-yellow-700", low: "text-orange-600", insufficient: "text-red-600",
  };

  const trendIcon: Record<string, string> = { rising: "↑", stable: "→", falling: "↓", insufficient_data: "?" };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" />
            Purchasing Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">AI-powered purchase request evaluation & risk management</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" disabled={ingestMut.isPending} onClick={() => ingestMut.mutate()}>
            <Activity className={`h-4 w-4 mr-1 ${ingestMut.isPending ? "animate-spin" : ""}`} />
            Ingest Signals
          </Button>
          <Button variant="outline" size="sm" disabled={refreshBenchMut.isPending} onClick={() => refreshBenchMut.mutate()}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshBenchMut.isPending ? "animate-spin" : ""}`} />
            Refresh Benchmark
          </Button>
          <NewRequestDialog onCreated={() => qc.invalidateQueries({ queryKey: ["purchasing-requests"] })} />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="requests">
            Requests {stats.total > 0 && <Badge className="ml-1 bg-primary text-white text-xs">{stats.total}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
          <TabsTrigger value="duplicates">
            Duplikat {duplicates.length > 0 && <Badge className="ml-1 bg-red-600 text-white text-xs">{duplicates.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="approval">
            Approval {approvals.length > 0 && <Badge className="ml-1 bg-orange-600 text-white text-xs">{approvals.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── Dashboard ── */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Total Requests", value: stats.total, icon: ShoppingCart, color: "text-blue-600" },
              { label: "Pending Review", value: stats.pending, icon: Clock, color: "text-yellow-600" },
              { label: "High/Critical Risk", value: stats.high, icon: AlertTriangle, color: "text-red-600" },
              { label: "Duplikat", value: stats.duplicates, icon: Copy, color: "text-orange-600" },
              { label: "Pending Approval", value: stats.pendingApprovals, icon: Shield, color: "text-purple-600" },
            ].map(s => (
              <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <s.icon className={`h-5 w-5 ${s.color}`} />
                    <div>
                      <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Budget Overview */}
          {budgetTotals && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />Budget Bulan Ini
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BudgetBar
                  used={budgetTotals.budgetUsed ?? 0}
                  pending={budgetTotals.budgetPending ?? 0}
                  allocated={budgetTotals.budgetAllocated ?? 0}
                />
                <div className="grid grid-cols-3 gap-3 mt-3 text-center">
                  <div><div className="text-xs text-muted-foreground">Dialokasikan</div><div className="font-bold text-sm">{(budgetTotals.budgetAllocated ?? 0).toLocaleString("id-ID")}</div></div>
                  <div><div className="text-xs text-muted-foreground">Terpakai</div><div className="font-bold text-sm text-blue-600">{(budgetTotals.budgetUsed ?? 0).toLocaleString("id-ID")}</div></div>
                  <div><div className="text-xs text-muted-foreground">Sisa</div><div className={`font-bold text-sm ${(budgetTotals.budgetRemaining ?? 0) < 0 ? "text-red-600" : "text-green-600"}`}>{(budgetTotals.budgetRemaining ?? 0).toLocaleString("id-ID")}</div></div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent high-risk requests */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />Request Berisiko Tinggi
              </CardTitle>
            </CardHeader>
            <CardContent>
              {requests.filter(r => r.aiRiskTier === "high" || r.aiRiskTier === "critical").length === 0
                ? <div className="text-sm text-muted-foreground text-center py-4">Tidak ada request berisiko tinggi saat ini ✓</div>
                : requests
                    .filter(r => r.aiRiskTier === "high" || r.aiRiskTier === "critical")
                    .slice(0, 5)
                    .map(r => (
                      <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0 cursor-pointer hover:bg-muted/50 rounded px-2" onClick={() => { setSelectedRequestId(r.id); setActiveTab("requests"); }}>
                        <div>
                          <div className="text-sm font-medium">{r.requestNumber}</div>
                          <div className="text-xs text-muted-foreground">{r.vendorName ?? "—"} · {r.serviceCategory ?? "—"}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{(r.estimatedAmount ?? 0).toLocaleString("id-ID")}</span>
                          <RiskBadge tier={r.aiRiskTier} score={r.aiRiskScore} />
                        </div>
                      </div>
                    ))
              }
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Requests Tab ── */}
        <TabsContent value="requests" className="mt-4">
          <div className="flex gap-2 flex-wrap mb-3">
            <Input placeholder="Cari request, vendor..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="submitted_for_approval">Menunggu Approval</SelectItem>
                <SelectItem value="approved">Disetujui</SelectItem>
                <SelectItem value="rejected">Ditolak</SelectItem>
              </SelectContent>
            </Select>
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Risiko</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Request list */}
            <div className="space-y-2">
              {reqLoading && <div className="text-center text-muted-foreground py-8">Memuat...</div>}
              {!reqLoading && requests.length === 0 && (
                <div className="text-center text-muted-foreground py-12">
                  <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <div>Belum ada purchase request</div>
                  <div className="text-sm mt-1">Klik "Buat Request" untuk memulai</div>
                </div>
              )}
              {requests.map(r => (
                <div
                  key={r.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-all hover:shadow-md ${selectedRequestId === r.id ? "border-primary bg-primary/5" : "bg-card"}`}
                  onClick={() => setSelectedRequestId(r.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{r.requestNumber}</span>
                        <StatusBadge status={r.status} />
                        {r.aiDuplicateFlag && <Badge className="bg-red-100 text-red-700 text-xs"><Copy className="h-2.5 w-2.5 mr-0.5" />DUP</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {r.vendorName ?? "—"} · {r.serviceCategory ?? "—"} · {r.origin ?? "—"} → {r.destination ?? "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold">{(r.estimatedAmount ?? 0).toLocaleString("id-ID")}</div>
                      <RiskBadge tier={r.aiRiskTier} score={r.aiRiskScore} />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(r.createdAt).toLocaleDateString("id-ID")} · {r.requestedBy ?? "—"}
                  </div>
                </div>
              ))}
            </div>

            {/* Detail panel */}
            <div className="border rounded-lg p-4 bg-card min-h-[400px]">
              {selectedRequestId
                ? <RequestDetailPanel requestId={selectedRequestId} onClose={() => setSelectedRequestId(null)} />
                : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 py-16">
                    <Eye className="h-10 w-10 opacity-30" />
                    <div className="text-sm">Pilih request untuk melihat detail & AI signals</div>
                  </div>
                )}
            </div>
          </div>
        </TabsContent>

        {/* ── Benchmark Tab ── */}
        <TabsContent value="benchmark" className="mt-4 space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">{benchmarks.length} benchmark tersedia</div>
            <Button variant="outline" size="sm" disabled={refreshBenchMut.isPending} onClick={() => refreshBenchMut.mutate()}>
              <RefreshCw className={`h-3 w-3 mr-1 ${refreshBenchMut.isPending ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          {benchmarks.length === 0
            ? (
              <div className="text-center text-muted-foreground py-12">
                <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <div>Belum ada data benchmark</div>
                <div className="text-sm mt-1">Klik "Ingest Signals" lalu "Refresh Benchmark" untuk mulai</div>
              </div>
            )
            : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {benchmarks.map(b => (
                  <Card key={b.id}>
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm capitalize">{b.serviceCategory?.replace("_", " ")}</div>
                          <div className="text-xs text-muted-foreground">{b.origin ?? "All"} → {b.destination ?? "All"}{b.vendorName ? ` · ${b.vendorName}` : ""}</div>
                        </div>
                        <div className="text-right">
                          <Badge className={`text-xs ${b.benchmarkConfidence === "high" ? "bg-green-100 text-green-800" : b.benchmarkConfidence === "medium" ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-600"}`}>
                            {b.benchmarkConfidence}
                          </Badge>
                          <div className="text-xs text-muted-foreground mt-0.5">{b.sampleCount} sampel {trendIcon[b.priceTrend]}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-1 text-center text-xs mt-2">
                        {[["P10", b.p10Price], ["P25", b.p25Price], ["Med", b.medianPrice], ["P75", b.p75Price], ["P90", b.p90Price]].map(([label, val]) => (
                          <div key={label as string} className={`p-1 rounded bg-muted ${label === "Med" ? "bg-primary/10 font-bold" : ""}`}>
                            <div className="text-muted-foreground">{label as string}</div>
                            <div className="font-medium">{val ? (val as number / 1000).toFixed(0) + "K" : "—"}</div>
                          </div>
                        ))}
                      </div>
                      {b.contractRateAvailable && (
                        <div className="text-xs bg-blue-50 border border-blue-200 rounded p-1.5 flex items-center gap-1">
                          <Shield className="h-3 w-3 text-blue-600" />
                          Contract rate: {b.contractRate?.toLocaleString("id-ID")} IDR
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          }
        </TabsContent>

        {/* ── Duplicates Tab ── */}
        <TabsContent value="duplicates" className="mt-4 space-y-3">
          {duplicates.length === 0
            ? (
              <div className="text-center text-muted-foreground py-12">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-30 text-green-500" />
                <div>Tidak ada duplikat terdeteksi ✓</div>
              </div>
            )
            : duplicates.map(r => (
              <Card key={r.id} className="border-red-200 bg-red-50">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileWarning className="h-4 w-4 text-red-600" />
                        <span className="font-medium">{r.requestNumber}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {r.vendorName ?? "—"} · {r.serviceCategory ?? "—"} · {(r.estimatedAmount ?? 0).toLocaleString("id-ID")} IDR
                      </div>
                      {r.aiDuplicateOfId && (
                        <div className="text-xs text-red-700 mt-1">Duplikat dari request ID #{r.aiDuplicateOfId}</div>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => { setSelectedRequestId(r.id); setActiveTab("requests"); }}>
                      <Eye className="h-3 w-3 mr-1" />Detail
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </TabsContent>

        {/* ── Budget Tab ── */}
        <TabsContent value="budget" className="mt-4 space-y-3">
          {budgetCategories.length === 0
            ? (
              <div className="text-center text-muted-foreground py-12">
                <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <div>Belum ada data budget</div>
                <div className="text-sm mt-1">Refresh budget tracker untuk memuat data dari Supabase</div>
              </div>
            )
            : (
              <div className="space-y-3">
                {budgetTotals && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Total Budget Bulan Ini</CardTitle></CardHeader>
                    <CardContent>
                      <BudgetBar used={budgetTotals.budgetUsed} pending={budgetTotals.budgetPending} allocated={budgetTotals.budgetAllocated} />
                      <div className="text-center mt-2">
                        <span className={`text-lg font-bold ${budgetTotals.utilizationPct > 100 ? "text-red-600" : budgetTotals.utilizationPct > 85 ? "text-orange-600" : "text-green-600"}`}>
                          {budgetTotals.utilizationPct}% terpakai
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {budgetCategories.map(c => (
                  <Card key={c.id}>
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-sm capitalize">{c.serviceCategory?.replace("budget_cat_", "Cat ").replace("_", " ")}</span>
                        <span className={`text-sm font-bold ${c.utilizationPct > 100 ? "text-red-600" : c.utilizationPct > 85 ? "text-orange-600" : "text-green-600"}`}>{c.utilizationPct?.toFixed(0)}%</span>
                      </div>
                      <BudgetBar used={c.budgetUsed} pending={c.budgetPending} allocated={c.budgetAllocated} />
                      <div className="text-xs text-muted-foreground">Sisa: {(c.budgetRemaining ?? 0).toLocaleString("id-ID")} IDR</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          }
        </TabsContent>

        {/* ── Approval Tab ── */}
        <TabsContent value="approval" className="mt-4 space-y-3">
          {approvals.length === 0
            ? (
              <div className="text-center text-muted-foreground py-12">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-30 text-green-500" />
                <div>Tidak ada approval yang menunggu ✓</div>
              </div>
            )
            : approvals.map((a) => (
              <ApprovalCard key={a.id} approval={a} onDecide={() => { qc.invalidateQueries({ queryKey: ["purchasing-approvals"] }); qc.invalidateQueries({ queryKey: ["purchasing-requests"] }); }} />
            ))
          }
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Approval Card ─────────────────────────────────────────────────────────────

function ApprovalCard({ approval, onDecide }: { approval: any; onDecide: () => void }) {
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const { toast } = useToast();
  const lpr = approval.lpr;
  const metadata = approval.metadata as Record<string, unknown> ?? {};

  const decide = async (decision: "approved" | "rejected") => {
    setDeciding(true);
    try {
      await apiFetch(`/purchasing/approval-requests/${approval.id}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, note }),
      });
      toast({ title: `Request ${decision === "approved" ? "disetujui" : "ditolak"}` });
      onDecide();
    } catch (err) {
      toast({ title: "Gagal", description: String(err), variant: "destructive" });
    } finally {
      setDeciding(false);
    }
  };

  return (
    <Card className="border-orange-200 bg-orange-50">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">{approval.doc_number}</div>
            <div className="text-sm text-muted-foreground">
              {lpr ? `${lpr.vendorName ?? "—"} · ${lpr.serviceCategory ?? "—"} · ${(lpr.estimatedAmount ?? 0).toLocaleString("id-ID")} IDR` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Diajukan: {new Date(approval.requested_at).toLocaleString("id-ID")}</div>
          </div>
          {lpr && <RiskBadge tier={lpr.aiRiskTier} score={lpr.aiRiskScore} />}
        </div>

        {metadata.clarificationQuestions && Array.isArray(metadata.clarificationQuestions) && metadata.clarificationQuestions.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium">Pertanyaan AI:</div>
            {(metadata.clarificationQuestions as string[]).map((q, i) => (
              <div key={i} className="text-xs bg-white border border-yellow-200 rounded p-2">❓ {q}</div>
            ))}
          </div>
        )}

        <div>
          <Label className="text-xs">Catatan Keputusan</Label>
          <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Tulis alasan persetujuan/penolakan..." className="text-sm mt-1" />
        </div>

        <div className="flex gap-2">
          <Button
            className="flex-1 bg-green-600 hover:bg-green-700"
            disabled={deciding}
            onClick={() => decide("approved")}
          >
            <CheckCircle className="h-4 w-4 mr-1" />Setujui
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
            disabled={deciding}
            onClick={() => decide("rejected")}
          >
            <XCircle className="h-4 w-4 mr-1" />Tolak
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
