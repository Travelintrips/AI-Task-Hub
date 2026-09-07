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
  FileText, Pencil, Trash2, MessageSquare, TrendingDown,
  CheckSquare, Ban, Info, ChevronDown, ChevronUp,
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

function fmt(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("id-ID");
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
    pending: "bg-yellow-100 text-yellow-800",
  };
  const labels: Record<string, string> = {
    draft: "Draft",
    pending_review: "Pending Review",
    submitted_for_approval: "Menunggu Approval",
    approved: "Disetujui",
    rejected: "Ditolak",
    cancelled: "Dibatalkan",
    pending: "Pending",
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

// ── Score Gauge ───────────────────────────────────────────────────────────────

function ScoreGauge({ score, label = "Risk Score" }: { score?: number | null; label?: string }) {
  if (score == null) return <div className="text-xs text-muted-foreground">Belum dievaluasi</div>;
  const color = score >= 65 ? "text-red-700" : score >= 35 ? "text-orange-600" : "text-green-700";
  const bg = score >= 65 ? "bg-red-500" : score >= 35 ? "bg-orange-400" : "bg-green-500";
  const tier = score >= 65 ? "CRITICAL" : score >= 35 ? "HIGH/MEDIUM" : "LOW";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${color}`}>{score}</span>
        <span className="text-sm text-muted-foreground">/100</span>
        <Badge className={`ml-auto text-xs font-bold ${score >= 65 ? "bg-red-100 text-red-800" : score >= 35 ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}`}>{tier}</Badge>
      </div>
      <Progress value={score} className="h-3" />
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ── Price Deviation Bar ───────────────────────────────────────────────────────

function PriceDeviationBar({ deviation, p25, p75, median, actual }: {
  deviation?: number | null; p25?: number | null; p75?: number | null; median?: number | null; actual?: number | null;
}) {
  if (deviation == null) return <div className="text-xs text-muted-foreground">Data benchmark tidak tersedia</div>;
  const color = Math.abs(deviation) > 30 ? "text-red-600" : Math.abs(deviation) > 15 ? "text-orange-600" : "text-green-700";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-bold ${color}`}>
          {deviation > 0 ? "+" : ""}{deviation.toFixed(1)}%
        </span>
        <span className="text-xs text-muted-foreground">vs benchmark</span>
      </div>
      {median != null && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {actual != null && <div>Estimasi: <strong>Rp {fmt(actual)}</strong></div>}
          <div>Median pasar: <strong>Rp {fmt(median)}</strong></div>
          {p25 != null && p75 != null && <div>Range: Rp {fmt(p25)} – Rp {fmt(p75)}</div>}
        </div>
      )}
      <div className={`text-xs font-medium ${color}`}>
        {deviation > 30 ? "⚠️ Jauh di atas harga pasar" : deviation > 15 ? "⚠️ Di atas rata-rata" : deviation < -15 ? "✓ Di bawah rata-rata" : "✓ Dalam range wajar"}
      </div>
    </div>
  );
}

// ── Approval Status Tracker ───────────────────────────────────────────────────

function ApprovalStatusTracker({ status, approvedBy, approvedAt, rejectedBy, rejectedAt, rejectedReason }: {
  status: string; approvedBy?: string | null; approvedAt?: string | null;
  rejectedBy?: string | null; rejectedAt?: string | null; rejectedReason?: string | null;
}) {
  const steps = [
    { key: "pending_review",         label: "Dibuat",           icon: FileText },
    { key: "submitted_for_approval", label: "Diajukan",         icon: ChevronRight },
    { key: "decided",                label: status === "approved" ? "Disetujui" : status === "rejected" ? "Ditolak" : "Keputusan", icon: status === "approved" ? CheckCircle : status === "rejected" ? XCircle : Clock },
  ];
  const statusOrder: Record<string, number> = {
    draft: 0, pending_review: 1, submitted_for_approval: 2, approved: 3, rejected: 3, cancelled: 3,
  };
  const current = statusOrder[status] ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {steps.map((step, i) => {
          const done = current > i || (i === 2 && current === 3);
          const active = current === i + 1 || (i === 2 && current === 3);
          const Icon = step.icon;
          return (
            <div key={step.key} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full border-2 text-xs font-bold flex-shrink-0 ${done || active ? "border-primary bg-primary text-white" : "border-gray-300 text-gray-400"}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span className={`text-xs font-medium ${done || active ? "text-foreground" : "text-muted-foreground"} hidden sm:block`}>{step.label}</span>
              {i < steps.length - 1 && <div className={`flex-1 h-0.5 mx-1 ${current > i + 1 || (i === 1 && current === 3) ? "bg-primary" : "bg-gray-200"}`} />}
            </div>
          );
        })}
      </div>
      {status === "approved" && (approvedBy || approvedAt) && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-green-50 border border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <div className="font-medium text-green-800">Disetujui oleh {approvedBy ?? "—"}</div>
            {approvedAt && <div className="text-green-700">{new Date(approvedAt).toLocaleString("id-ID")}</div>}
          </div>
        </div>
      )}
      {status === "rejected" && (rejectedBy || rejectedReason) && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-red-50 border border-red-200">
          <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <div className="font-medium text-red-800">Ditolak oleh {rejectedBy ?? "—"}</div>
            {rejectedAt && <div className="text-red-700">{new Date(rejectedAt).toLocaleString("id-ID")}</div>}
            {rejectedReason && <div className="mt-1 text-red-700 font-medium">Alasan: {rejectedReason}</div>}
          </div>
        </div>
      )}
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
    approval_granted: "Keputusan: Disetujui",
    approval_rejected: "Keputusan: Ditolak",
    contract_rate_change: "Perubahan Kontrak",
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
              {s.score != null && s.score > 0 && <span className="text-xs bg-white border rounded px-1">{s.score}/100</span>}
              <span className="text-xs text-muted-foreground ml-auto">{new Date(s.createdAt).toLocaleString("id-ID")}</span>
            </div>
            <div className="text-sm font-medium mt-0.5">{s.headline}</div>
            {s.explanation && <div className="text-xs text-muted-foreground mt-1">{s.explanation}</div>}
            {Array.isArray(s.clarificationQuestions) && s.clarificationQuestions.length > 0 && (
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
              <Input placeholder="Trucking 2 unit untuk pengiriman..." value={form.description} onChange={f("description")} />
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

// ── Contract Rate Dialog ──────────────────────────────────────────────────────

function ContractRateDialog({
  mode, existing, onSaved,
}: { mode: "create" | "edit"; existing?: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    vendorName: existing?.vendorName ?? "",
    serviceCategory: existing?.serviceCategory ?? "",
    origin: existing?.origin ?? "",
    destination: existing?.destination ?? "",
    contractedRate: existing?.contractedRate?.toString() ?? "",
    currency: existing?.currency ?? "IDR",
    rateUnit: existing?.rateUnit ?? "per_shipment",
    validFrom: existing?.validFrom ? existing.validFrom.slice(0, 10) : "",
    validUntil: existing?.validUntil ? existing.validUntil.slice(0, 10) : "",
    contractReference: existing?.contractReference ?? "",
    notes: existing?.notes ?? "",
  });
  const { toast } = useToast();

  const saveMut = useMutation({
    mutationFn: (data: typeof form) => {
      const body = { ...data, contractedRate: parseFloat(data.contractedRate) || 0, vendorId: existing?.vendorId ?? null };
      if (mode === "create") return apiFetch("/purchasing/contract-rates", { method: "POST", body: JSON.stringify(body) });
      return apiFetch(`/purchasing/contract-rates/${existing.id}`, { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast({ title: mode === "create" ? "✅ Kontrak ditambahkan" : "✅ Kontrak diperbarui" });
      setOpen(false);
      onSaved();
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create"
          ? <Button size="sm"><Plus className="h-4 w-4 mr-1" />Tambah Kontrak</Button>
          : <Button size="sm" variant="outline"><Pencil className="h-3 w-3" /></Button>
        }
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Tambah Contract Rate" : "Edit Contract Rate"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nama Vendor</Label>
              <Input placeholder="PT. Vendor Logistik" value={form.vendorName} onChange={f("vendorName")} />
            </div>
            <div>
              <Label>Kategori *</Label>
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
              <Label>Satuan Rate</Label>
              <Select value={form.rateUnit} onValueChange={v => setForm(p => ({ ...p, rateUnit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_shipment">Per Shipment</SelectItem>
                  <SelectItem value="per_kg">Per KG</SelectItem>
                  <SelectItem value="per_cbm">Per CBM</SelectItem>
                  <SelectItem value="per_day">Per Hari</SelectItem>
                  <SelectItem value="per_container">Per Container</SelectItem>
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
            <div>
              <Label>Rate (IDR) *</Label>
              <Input type="number" placeholder="5000000" value={form.contractedRate} onChange={f("contractedRate")} />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IDR">IDR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Berlaku Mulai *</Label>
              <Input type="date" value={form.validFrom} onChange={f("validFrom")} />
            </div>
            <div>
              <Label>Berlaku Sampai</Label>
              <Input type="date" value={form.validUntil} onChange={f("validUntil")} />
            </div>
            <div className="col-span-2">
              <Label>No. Kontrak / Referensi</Label>
              <Input placeholder="SPK-2025-001" value={form.contractReference} onChange={f("contractReference")} />
            </div>
          </div>
          <div>
            <Label>Catatan</Label>
            <Textarea rows={2} value={form.notes} onChange={f("notes")} placeholder="Info tambahan..." />
          </div>
          <Button
            className="w-full"
            disabled={saveMut.isPending || !form.serviceCategory || !form.contractedRate}
            onClick={() => saveMut.mutate(form)}
          >
            {saveMut.isPending ? "Menyimpan..." : mode === "create" ? "Tambah Kontrak" : "Simpan Perubahan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Approve/Reject Panel ──────────────────────────────────────────────────────

function ApproveRejectPanel({ approvalId, onDecided }: { approvalId: number; onDecided: () => void }) {
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const decideMut = useMutation({
    mutationFn: ({ decision }: { decision: "approved" | "rejected" }) =>
      apiFetch(`/purchasing/approval-requests/${approvalId}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, notes }),
      }),
    onSuccess: (data) => {
      toast({ title: data.decision === "approved" ? "✅ Request disetujui" : "❌ Request ditolak", description: data.waNotified ? "Notifikasi WA terkirim" : "" });
      onDecided();
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        onClick={() => setShowForm(v => !v)}
      >
        {showForm ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
        {showForm ? "Tutup Panel Keputusan" : "Buat Keputusan Approval"}
      </Button>

      {showForm && (
        <div className="space-y-3 p-3 border rounded-lg bg-gray-50">
          <div>
            <Label className="text-xs">Catatan / Alasan Penolakan</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Opsional — tulis catatan atau alasan penolakan..."
            />
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              size="sm"
              disabled={decideMut.isPending}
              onClick={() => decideMut.mutate({ decision: "approved" })}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              {decideMut.isPending ? "Memproses..." : "Setujui"}
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700"
              size="sm"
              disabled={decideMut.isPending}
              onClick={() => decideMut.mutate({ decision: "rejected" })}
            >
              <XCircle className="h-4 w-4 mr-1" />
              {decideMut.isPending ? "Memproses..." : "Tolak"}
            </Button>
          </div>
        </div>
      )}
    </div>
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
  const { data: adviceData, refetch: refetchAdvice } = useQuery({
    queryKey: ["purchasing-advice", requestId],
    queryFn: () => apiFetch(`/purchasing/requests/${requestId}/approval-advice`),
    refetchInterval: 8000,
  });

  const evalMut = useMutation({
    mutationFn: () => apiFetch(`/purchasing/requests/${requestId}/evaluate`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Re-evaluasi selesai" });
      qc.invalidateQueries({ queryKey: ["purchasing-intel", requestId] });
      qc.invalidateQueries({ queryKey: ["purchasing-request", requestId] });
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });
  const submitMut = useMutation({
    mutationFn: () => apiFetch(`/purchasing/requests/${requestId}/submit-for-approval`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Berhasil diajukan untuk approval" });
      qc.invalidateQueries({ queryKey: ["purchasing-advice", requestId] });
      qc.invalidateQueries({ queryKey: ["purchasing-request", requestId] });
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const lpr = reqData?.request;
  const signals: any[] = intelData?.signals ?? [];
  const advice = adviceData?.advice;
  const budget = budgetData?.budgetImpact;
  const margin = marginData?.marginImpact;

  // Derive price benchmark signal
  const priceSig = signals.find(s => s.signalType === "price_benchmark");
  const priceBenchData = priceSig?.dataSnapshot as Record<string, number> | undefined;
  const dupSig = signals.find(s => s.signalType === "duplicate_detected");
  const compositeSig = signals.find(s => s.signalType === "composite");

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
            Rp {fmt(lpr.estimatedAmount)} {lpr.currency !== "IDR" ? lpr.currency : ""}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>✕</Button>
      </div>

      {/* AI Risk Summary Row */}
      {lpr.aiRiskScore != null && (
        <div className="grid grid-cols-3 gap-2">
          <Card className="col-span-1">
            <CardContent className="pt-3 pb-3">
              <div className="text-xs text-muted-foreground mb-1">Composite Score</div>
              <ScoreGauge score={lpr.aiRiskScore} label="" />
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardContent className="pt-3 pb-3">
              <div className="text-xs text-muted-foreground mb-1">Harga vs Pasar</div>
              {priceBenchData
                ? <PriceDeviationBar deviation={priceBenchData.deviationPct} median={priceBenchData.median} actual={lpr.estimatedAmount} />
                : <div className="text-xs text-muted-foreground">Tidak ada data</div>
              }
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardContent className="pt-3 pb-3">
              <div className="text-xs text-muted-foreground mb-1">Budget Impact</div>
              {lpr.aiBudgetImpactPct != null
                ? (
                  <div className="space-y-1">
                    <div className={`text-xl font-bold ${lpr.aiBudgetImpactPct > 90 ? "text-red-700" : lpr.aiBudgetImpactPct > 70 ? "text-orange-600" : "text-green-700"}`}>{lpr.aiBudgetImpactPct.toFixed(0)}%</div>
                    <Progress value={lpr.aiBudgetImpactPct} className="h-1.5" />
                    <div className="text-xs text-muted-foreground">utilisasi budget</div>
                  </div>
                )
                : <div className="text-xs text-muted-foreground">Tidak ada data</div>
              }
            </CardContent>
          </Card>
        </div>
      )}

      {/* Duplicate Warning */}
      {lpr.aiDuplicateFlag && dupSig && (
        <div className="flex gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
          <Copy className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <div className="font-medium text-red-800">{dupSig.headline}</div>
            {dupSig.explanation && <div className="text-xs text-red-700 mt-0.5">{dupSig.explanation}</div>}
            {Array.isArray(dupSig.clarificationQuestions) && dupSig.clarificationQuestions.length > 0 && (
              <div className="mt-2 space-y-1">
                {dupSig.clarificationQuestions.map((q: string, i: number) => (
                  <div key={i} className="text-xs bg-white rounded p-1.5 border border-red-200">❓ {q}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Tabs defaultValue="intel">
        <TabsList className="w-full">
          <TabsTrigger value="intel" className="flex-1 text-xs">AI Signals</TabsTrigger>
          <TabsTrigger value="budget" className="flex-1 text-xs">Budget</TabsTrigger>
          <TabsTrigger value="margin" className="flex-1 text-xs">Margin</TabsTrigger>
          <TabsTrigger value="approval" className="flex-1 text-xs">Approval</TabsTrigger>
        </TabsList>

        {/* AI Signals Tab */}
        <TabsContent value="intel" className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">{signals.length} signal tersedia</div>
            <Button variant="outline" size="sm" disabled={evalMut.isPending} onClick={() => evalMut.mutate()}>
              <RefreshCw className={`h-3 w-3 mr-1 ${evalMut.isPending ? "animate-spin" : ""}`} />
              Re-Evaluasi
            </Button>
          </div>
          {compositeSig && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-3 pb-3">
                <div className="text-xs font-medium text-blue-700 mb-1">Narasi AI</div>
                <div className="text-sm text-blue-900">{compositeSig.explanation}</div>
                {Array.isArray(compositeSig.clarificationQuestions) && compositeSig.clarificationQuestions.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {compositeSig.clarificationQuestions.map((q: string, i: number) => (
                      <div key={i} className="text-xs bg-white rounded p-1.5 border border-blue-200">❓ {q}</div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <SignalTimeline signals={signals.filter(s => s.signalType !== "composite")} />
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
                {(budget.data as any)?.willExceed && (
                  <div className="flex gap-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>Request ini akan <strong>melebihi budget</strong> yang dialokasikan.</span>
                  </div>
                )}
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
            <div className="space-y-4">
              {/* Status Tracker */}
              <ApprovalStatusTracker
                status={lpr.status}
                approvedBy={advice.approvedBy ?? lpr.approvedBy}
                approvedAt={advice.approvedAt ?? lpr.approvedAt}
                rejectedBy={advice.rejectedBy ?? lpr.rejectedBy}
                rejectedAt={advice.rejectedAt ?? lpr.rejectedAt}
                rejectedReason={advice.rejectedReason ?? lpr.rejectedReason}
              />

              {/* AI Recommendation */}
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
                    <div className="text-xs bg-white rounded border p-2 space-y-1">
                      <div>Status Supabase: <StatusBadge status={String(advice.existingApproval.status)} /></div>
                      {advice.existingApproval.note && (
                        <div className="text-muted-foreground">Catatan approver: <span className="text-foreground">{String(advice.existingApproval.note)}</span></div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Submit for Approval Button */}
              {advice.requiresApproval && !advice.existingApprovalId && lpr.status === "pending_review" && (
                <Button
                  className="w-full"
                  disabled={submitMut.isPending}
                  onClick={() => submitMut.mutate()}
                >
                  {submitMut.isPending ? "Mengajukan..." : "Ajukan untuk Approval"}
                </Button>
              )}

              {/* Admin Approve/Reject Panel */}
              {advice.existingApprovalId && advice.existingApproval?.status === "pending" && (
                <ApproveRejectPanel
                  approvalId={advice.existingApprovalId}
                  onDecided={() => {
                    refetchAdvice();
                    qc.invalidateQueries({ queryKey: ["purchasing-request", requestId] });
                    qc.invalidateQueries({ queryKey: ["purchasing-approvals"] });
                  }}
                />
              )}

              {/* Clarification Questions */}
              {Array.isArray(advice.latestEvaluation?.clarificationQuestions) && advice.latestEvaluation.clarificationQuestions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Pertanyaan Klarifikasi AI:</div>
                  {advice.latestEvaluation.clarificationQuestions.map((q: string, i: number) => (
                    <div key={i} className="text-sm bg-yellow-50 border border-yellow-200 rounded p-2">❓ {q}</div>
                  ))}
                </div>
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
  const [showRefreshLog, setShowRefreshLog] = useState(false);
  const [contractFilter, setContractFilter] = useState("active");
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

  const { data: benchmarkData, dataUpdatedAt: benchmarkUpdated } = useQuery({
    queryKey: ["purchasing-benchmarks"],
    queryFn: () => apiFetch("/purchasing/benchmark?limit=30"),
  });

  const { data: budgetData } = useQuery({
    queryKey: ["purchasing-budget"],
    queryFn: () => apiFetch("/purchasing/budget/summary"),
  });

  const { data: approvalsData } = useQuery({
    queryKey: ["purchasing-approvals"],
    queryFn: () => apiFetch("/purchasing/approval-requests?status=pending"),
  });

  const { data: contractRatesData } = useQuery({
    queryKey: ["purchasing-contract-rates", contractFilter],
    queryFn: () => apiFetch(`/purchasing/contract-rates?activeOnly=${contractFilter === "active"}`),
  });

  const refreshBenchMut = useMutation({
    mutationFn: () => apiFetch("/purchasing/benchmark/refresh", { method: "POST" }),
    onSuccess: (d) => {
      toast({ title: `✅ Benchmark diperbarui`, description: `${d.refreshed ?? 0} entri · ${(d.categoriesUpdated ?? []).length} kategori` });
      setShowRefreshLog(true);
      qc.invalidateQueries({ queryKey: ["purchasing-benchmarks"] });
    },
    onError: (err: Error) => toast({ title: "Gagal refresh", description: err.message, variant: "destructive" }),
  });

  const ingestMut = useMutation({
    mutationFn: () => apiFetch("/purchasing/signals/ingest", { method: "POST" }),
    onSuccess: (d) => { toast({ title: `✅ Signal ingested: ${d.ingested ?? 0} baru` }); qc.invalidateQueries({ queryKey: ["purchasing-requests"] }); },
    onError: (err: Error) => toast({ title: "Gagal ingest", description: err.message, variant: "destructive" }),
  });

  const deleteContractMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/purchasing/contract-rates/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "✅ Kontrak dinonaktifkan" }); qc.invalidateQueries({ queryKey: ["purchasing-contract-rates"] }); },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const requests: any[] = requestsData?.requests ?? [];
  const duplicates: any[] = duplicatesData?.duplicates ?? [];
  const benchmarks: any[] = benchmarkData?.benchmarks ?? [];
  const budgetCategories: any[] = budgetData?.categories ?? [];
  const budgetTotals = budgetData?.totals;
  const approvals: any[] = approvalsData?.approvalRequests ?? [];
  const contractRates: any[] = contractRatesData?.contractRates ?? [];

  // Dashboard stats
  const stats = {
    total: requestsData?.total ?? 0,
    pending: requests.filter(r => r.status === "pending_review").length,
    high: requests.filter(r => r.aiRiskTier === "high" || r.aiRiskTier === "critical").length,
    critical: requests.filter(r => r.aiRiskTier === "critical").length,
    duplicates: duplicates.length,
    pendingApprovals: approvals.length,
    budgetUtilization: budgetTotals
      ? Math.round((budgetTotals.totalUsed / (budgetTotals.totalAllocated || 1)) * 100)
      : null,
    marginWarnings: requests.filter(r => r.aiMarginImpactPct != null && r.aiMarginImpactPct < 15).length,
  };

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
          <TabsTrigger value="benchmark">
            Benchmark
            {benchmarkData?.hasStale && <Badge className="ml-1 bg-yellow-500 text-white text-xs">Stale</Badge>}
          </TabsTrigger>
          <TabsTrigger value="duplicates">
            Duplikat {duplicates.length > 0 && <Badge className="ml-1 bg-red-600 text-white text-xs">{duplicates.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="approval">
            Approval {approvals.length > 0 && <Badge className="ml-1 bg-orange-600 text-white text-xs">{approvals.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="contract">Kontrak</TabsTrigger>
        </TabsList>

        {/* ── Dashboard ── */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Requests", value: stats.total, icon: ShoppingCart, color: "text-blue-600", bg: "bg-blue-50", onClick: () => setActiveTab("requests") },
              { label: "Pending Review", value: stats.pending, icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50", onClick: () => { setStatusFilter("pending_review"); setActiveTab("requests"); } },
              { label: "Menunggu Approval", value: stats.pendingApprovals, icon: Shield, color: "text-purple-600", bg: "bg-purple-50", onClick: () => setActiveTab("approval") },
              { label: "High/Critical Risk", value: stats.high, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50", onClick: () => { setRiskFilter("critical"); setActiveTab("requests"); } },
            ].map(s => (
              <Card key={s.label} className={`cursor-pointer hover:shadow-md transition-shadow ${s.value > 0 ? s.bg : ""}`} onClick={s.onClick}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-2">
                    <s.icon className={`h-5 w-5 ${s.color} mt-0.5 flex-shrink-0`} />
                    <div>
                      <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-muted-foreground leading-tight">{s.label}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card className={duplicates.length > 0 ? "bg-orange-50" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <Copy className={`h-5 w-5 ${duplicates.length > 0 ? "text-orange-600" : "text-gray-400"} mt-0.5`} />
                  <div>
                    <div className={`text-2xl font-bold ${duplicates.length > 0 ? "text-orange-600" : "text-gray-500"}`}>{stats.duplicates}</div>
                    <div className="text-xs text-muted-foreground">Potensi Duplikat</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className={stats.marginWarnings > 0 ? "bg-red-50" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <TrendingDown className={`h-5 w-5 ${stats.marginWarnings > 0 ? "text-red-600" : "text-gray-400"} mt-0.5`} />
                  <div>
                    <div className={`text-2xl font-bold ${stats.marginWarnings > 0 ? "text-red-600" : "text-gray-500"}`}>{stats.marginWarnings}</div>
                    <div className="text-xs text-muted-foreground">Margin Warning</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <BarChart3 className="h-5 w-5 text-blue-500 mt-0.5" />
                  <div>
                    <div className={`text-2xl font-bold ${(stats.budgetUtilization ?? 0) > 90 ? "text-red-600" : (stats.budgetUtilization ?? 0) > 70 ? "text-orange-600" : "text-green-700"}`}>
                      {stats.budgetUtilization != null ? `${stats.budgetUtilization}%` : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">Budget Utilisasi</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Critical / High Risk List */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  Request Berisiko Tinggi
                </CardTitle>
              </CardHeader>
              <CardContent>
                {requests.filter(r => r.aiRiskTier === "critical" || r.aiRiskTier === "high").slice(0, 5).length === 0
                  ? <div className="text-xs text-muted-foreground py-3 text-center">Tidak ada request berisiko tinggi ✓</div>
                  : (
                    <div className="space-y-2">
                      {requests.filter(r => r.aiRiskTier === "critical" || r.aiRiskTier === "high").slice(0, 5).map(r => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                          onClick={() => setSelectedRequestId(r.id)}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{r.requestNumber}</div>
                            <div className="text-xs text-muted-foreground truncate">{r.vendorName ?? "—"} · Rp {fmt(r.estimatedAmount)}</div>
                          </div>
                          <RiskBadge tier={r.aiRiskTier} score={r.aiRiskScore} />
                        </div>
                      ))}
                    </div>
                  )}
              </CardContent>
            </Card>

            {/* Pending Approvals List */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4 text-purple-500" />
                  Menunggu Approval
                  {approvals.length > 0 && <Badge className="bg-orange-100 text-orange-800 ml-auto">{approvals.length}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {approvals.length === 0
                  ? <div className="text-xs text-muted-foreground py-3 text-center">Tidak ada yang menunggu approval ✓</div>
                  : (
                    <div className="space-y-2">
                      {approvals.slice(0, 5).map((ar: any) => (
                        <div
                          key={ar.id}
                          className="flex items-center justify-between gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                          onClick={() => ar.doc_id && setSelectedRequestId(ar.doc_id)}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{ar.doc_number ?? ar.lpr?.requestNumber ?? "—"}</div>
                            <div className="text-xs text-muted-foreground truncate">Diajukan oleh {ar.requested_by ?? "—"}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            {ar.lpr && <RiskBadge tier={ar.lpr.aiRiskTier} />}
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </CardContent>
            </Card>
          </div>

          {/* Budget Utilization per Category */}
          {budgetCategories.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  Budget per Kategori
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {budgetCategories.slice(0, 6).map((cat: any) => (
                  <div key={cat.serviceCategory ?? cat.category} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{cat.serviceCategory ?? cat.category ?? "—"}</span>
                      <span className="text-muted-foreground">Rp {fmt(cat.totalUsed)} / {fmt(cat.budgetAllocated)}</span>
                    </div>
                    <BudgetBar
                      used={cat.totalUsed ?? 0}
                      pending={cat.totalPending ?? 0}
                      allocated={cat.budgetAllocated ?? 0}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Requests ── */}
        <TabsContent value="requests" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: List */}
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Input
                  placeholder="Cari nomor, vendor, deskripsi..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="flex-1 min-w-[180px]"
                />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="pending_review">Pending Review</SelectItem>
                    <SelectItem value="submitted_for_approval">Menunggu Approval</SelectItem>
                    <SelectItem value="approved">Disetujui</SelectItem>
                    <SelectItem value="rejected">Ditolak</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Risk</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {reqLoading ? (
                <div className="text-center py-8 text-muted-foreground">Memuat...</div>
              ) : requests.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <div>Tidak ada purchase request</div>
                  <div className="text-xs mt-1">Buat request baru menggunakan tombol di atas</div>
                </div>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {requests.map(r => (
                    <Card
                      key={r.id}
                      className={`cursor-pointer hover:shadow-md transition-all ${selectedRequestId === r.id ? "ring-2 ring-primary" : ""}`}
                      onClick={() => setSelectedRequestId(r.id)}
                    >
                      <CardContent className="pt-3 pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{r.requestNumber}</span>
                              <StatusBadge status={r.status} />
                              {r.aiDuplicateFlag && <Badge className="bg-orange-100 text-orange-800 text-xs border border-orange-300">DUPLIKAT</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">
                              {r.vendorName ?? "—"} · {r.serviceCategory ?? "—"}
                            </div>
                            <div className="text-sm font-semibold mt-1">Rp {fmt(r.estimatedAmount)}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <RiskBadge tier={r.aiRiskTier} score={r.aiRiskScore} />
                            <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("id-ID")}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Detail */}
            <div className="border rounded-lg p-4 min-h-[400px]">
              {selectedRequestId ? (
                <RequestDetailPanel
                  requestId={selectedRequestId}
                  onClose={() => setSelectedRequestId(null)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-16">
                  <Eye className="h-10 w-10 mb-3 opacity-20" />
                  <div className="text-sm">Pilih request untuk melihat detail</div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Benchmark ── */}
        <TabsContent value="benchmark" className="mt-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm text-muted-foreground">
              {benchmarks.length} benchmark · {benchmarks.filter(b => b.isStale).length} stale
              {benchmarkData?.oldestRefresh && (
                <span> · Terlama: {new Date(benchmarkData.oldestRefresh).toLocaleDateString("id-ID")}</span>
              )}
            </div>
            <div className="flex gap-2">
              {benchmarkData?.hasStale && (
                <Badge className="bg-yellow-100 text-yellow-800 border border-yellow-300">
                  <AlertTriangle className="h-3 w-3 mr-1" />Data stale (&gt;7 hari)
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRefreshLog(v => !v)}
              >
                <Info className="h-3 w-3 mr-1" />
                {showRefreshLog ? "Sembunyikan Log" : "Lihat Log Refresh"}
              </Button>
              <Button
                size="sm"
                disabled={refreshBenchMut.isPending}
                onClick={() => refreshBenchMut.mutate()}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${refreshBenchMut.isPending ? "animate-spin" : ""}`} />
                {refreshBenchMut.isPending ? "Merefresh..." : "Refresh Sekarang"}
              </Button>
            </div>
          </div>

          {/* Refresh Log */}
          {showRefreshLog && refreshBenchMut.data && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Log Refresh Terakhir</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                <div>Direfresh: {new Date(refreshBenchMut.data.refreshedAt).toLocaleString("id-ID")}</div>
                <div>Durasi: {refreshBenchMut.data.elapsedMs}ms</div>
                <div>Entri diperbarui: {refreshBenchMut.data.refreshed}</div>
                <div>Total sampel: {refreshBenchMut.data.totalSamples}</div>
                {refreshBenchMut.data.categoriesUpdated?.length > 0 && (
                  <div>Kategori: {refreshBenchMut.data.categoriesUpdated.join(", ")}</div>
                )}
              </CardContent>
            </Card>
          )}

          {benchmarks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <div className="text-sm">Belum ada data benchmark</div>
              <div className="text-xs mt-1">Klik "Refresh Sekarang" untuk menghitung dari data historis</div>
              <Button className="mt-3" size="sm" disabled={refreshBenchMut.isPending} onClick={() => refreshBenchMut.mutate()}>
                <RefreshCw className="h-4 w-4 mr-1" />Hitung Benchmark
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-3">Kategori</th>
                    <th className="text-left py-2 pr-3">Rute</th>
                    <th className="text-right py-2 pr-3">P25</th>
                    <th className="text-right py-2 pr-3">Median</th>
                    <th className="text-right py-2 pr-3">P75</th>
                    <th className="text-right py-2 pr-3">Sampel</th>
                    <th className="text-left py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {benchmarks.map((b: any) => (
                    <tr key={b.id} className={`hover:bg-accent/50 ${b.isStale ? "opacity-70" : ""}`}>
                      <td className="py-2 pr-3 font-medium">{b.serviceCategory}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {b.origin && b.destination ? `${b.origin} → ${b.destination}` : b.origin ?? b.destination ?? "Semua rute"}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs">Rp {fmt(b.p25)}</td>
                      <td className="py-2 pr-3 text-right font-medium">Rp {fmt(b.median)}</td>
                      <td className="py-2 pr-3 text-right text-xs">Rp {fmt(b.p75)}</td>
                      <td className="py-2 pr-3 text-right text-xs">{b.sampleCount ?? 0}</td>
                      <td className="py-2">
                        {b.isStale
                          ? <Badge className="bg-yellow-100 text-yellow-800 text-xs border border-yellow-300">Stale</Badge>
                          : <Badge className="bg-green-100 text-green-800 text-xs border border-green-300">✓ Fresh</Badge>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Duplikat ── */}
        <TabsContent value="duplicates" className="mt-4">
          {duplicates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Copy className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <div className="text-sm">Tidak ada potensi duplikat terdeteksi ✓</div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{duplicates.length} request terdeteksi sebagai potensi duplikat</div>
              {duplicates.map((r: any) => (
                <Card key={r.id} className="border-orange-200 bg-orange-50">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Copy className="h-3.5 w-3.5 text-orange-600" />
                          <span className="font-medium text-sm">{r.requestNumber}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {r.vendorName ?? "—"} · {r.serviceCategory ?? "—"} · Rp {fmt(r.estimatedAmount)}
                        </div>
                        {r.aiDuplicateOfId && (
                          <div className="text-xs text-orange-700 mt-1">Mirip dengan Request #{r.aiDuplicateOfId}</div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setSelectedRequestId(r.id); setActiveTab("requests"); }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />Detail
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Budget ── */}
        <TabsContent value="budget" className="mt-4 space-y-4">
          {budgetTotals && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Ringkasan Budget Total</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <BudgetBar
                  used={budgetTotals.totalUsed ?? 0}
                  pending={budgetTotals.totalPending ?? 0}
                  allocated={budgetTotals.totalAllocated ?? 0}
                />
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="text-center">
                    <div className="font-bold text-blue-700">Rp {fmt(budgetTotals.totalUsed)}</div>
                    <div className="text-muted-foreground">Terpakai</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-yellow-700">Rp {fmt(budgetTotals.totalPending)}</div>
                    <div className="text-muted-foreground">Pending</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-gray-700">Rp {fmt(budgetTotals.totalAllocated)}</div>
                    <div className="text-muted-foreground">Alokasi</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {budgetCategories.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-20" />
              Belum ada data budget per kategori
            </div>
          ) : (
            <div className="space-y-3">
              {budgetCategories.map((cat: any) => (
                <Card key={cat.serviceCategory ?? cat.category}>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm">{cat.serviceCategory ?? cat.category ?? "—"}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <BudgetBar
                      used={cat.totalUsed ?? 0}
                      pending={cat.totalPending ?? 0}
                      allocated={cat.budgetAllocated ?? 0}
                    />
                    <div className="text-xs text-muted-foreground">
                      {cat.requestCount ?? 0} request · Terbesar: Rp {fmt(cat.maxAmount)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Approval ── */}
        <TabsContent value="approval" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{approvals.length} menunggu keputusan</div>
          </div>
          {approvals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckSquare className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <div className="text-sm">Tidak ada approval yang menunggu keputusan ✓</div>
            </div>
          ) : (
            <div className="space-y-3">
              {approvals.map((ar: any) => (
                <Card key={ar.id} className="border-orange-200">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{ar.doc_number ?? ar.lpr?.requestNumber ?? "—"}</span>
                          <StatusBadge status={String(ar.status)} />
                          {ar.lpr && <RiskBadge tier={ar.lpr.aiRiskTier} score={ar.lpr.aiRiskScore} />}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Diajukan oleh {ar.requested_by ?? "—"} · {ar.requested_at ? new Date(ar.requested_at).toLocaleDateString("id-ID") : "—"}
                        </div>
                        {ar.lpr && (
                          <div className="text-xs mt-1">
                            {ar.lpr.vendorName ?? "—"} · Rp {fmt(ar.lpr.estimatedAmount)}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setSelectedRequestId(ar.doc_id); setActiveTab("requests"); }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />Review
                      </Button>
                    </div>
                    {ar.status === "pending" && (
                      <div className="mt-3">
                        <ApproveRejectPanel
                          approvalId={ar.id}
                          onDecided={() => {
                            qc.invalidateQueries({ queryKey: ["purchasing-approvals"] });
                            qc.invalidateQueries({ queryKey: ["purchasing-requests"] });
                          }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Kontrak (Contract Rates) ── */}
        <TabsContent value="contract" className="mt-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Select value={contractFilter} onValueChange={setContractFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktif Saja</SelectItem>
                  <SelectItem value="all">Semua</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-sm text-muted-foreground">{contractRates.length} kontrak</div>
            </div>
            <ContractRateDialog
              mode="create"
              onSaved={() => qc.invalidateQueries({ queryKey: ["purchasing-contract-rates"] })}
            />
          </div>

          {contractRates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <div className="text-sm">Belum ada contract rate</div>
              <div className="text-xs mt-1">Tambahkan kontrak vendor untuk meningkatkan akurasi benchmark</div>
              <ContractRateDialog
                mode="create"
                onSaved={() => qc.invalidateQueries({ queryKey: ["purchasing-contract-rates"] })}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-3">Vendor</th>
                    <th className="text-left py-2 pr-3">Kategori</th>
                    <th className="text-left py-2 pr-3">Rute</th>
                    <th className="text-right py-2 pr-3">Rate</th>
                    <th className="text-left py-2 pr-3">Periode</th>
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-right py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {contractRates.map((cr: any) => (
                    <tr key={cr.id} className={`hover:bg-accent/50 ${!cr.isActive || cr.isExpired ? "opacity-60" : ""}`}>
                      <td className="py-2 pr-3">
                        <div className="font-medium truncate max-w-[120px]">{cr.vendorName ?? "—"}</div>
                        {cr.contractReference && <div className="text-xs text-muted-foreground">{cr.contractReference}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs">{cr.serviceCategory}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {cr.origin && cr.destination ? `${cr.origin} → ${cr.destination}` : cr.origin ?? cr.destination ?? "Semua rute"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <div className="font-medium">Rp {fmt(cr.contractedRate)}</div>
                        <div className="text-xs text-muted-foreground">{cr.rateUnit?.replace("_", " ")}</div>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <div>{cr.validFrom ? new Date(cr.validFrom).toLocaleDateString("id-ID") : "—"}</div>
                        {cr.validUntil && (
                          <div className={cr.isExpired ? "text-red-600 font-medium" : cr.expiresInDays != null && cr.expiresInDays <= 30 ? "text-orange-600" : "text-muted-foreground"}>
                            s/d {new Date(cr.validUntil).toLocaleDateString("id-ID")}
                            {cr.expiresInDays != null && cr.expiresInDays > 0 && !cr.isExpired && cr.expiresInDays <= 30 && (
                              <span> ({cr.expiresInDays}h lagi)</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {!cr.isActive
                          ? <Badge className="bg-gray-100 text-gray-600 text-xs">Nonaktif</Badge>
                          : cr.isExpired
                          ? <Badge className="bg-red-100 text-red-800 text-xs border border-red-300">Expired</Badge>
                          : cr.expiresInDays != null && cr.expiresInDays <= 30
                          ? <Badge className="bg-orange-100 text-orange-800 text-xs border border-orange-300">Segera Habis</Badge>
                          : <Badge className="bg-green-100 text-green-800 text-xs border border-green-300">✓ Aktif</Badge>
                        }
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <ContractRateDialog
                            mode="edit"
                            existing={cr}
                            onSaved={() => qc.invalidateQueries({ queryKey: ["purchasing-contract-rates"] })}
                          />
                          {cr.isActive && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700"
                              disabled={deleteContractMut.isPending}
                              onClick={() => {
                                if (confirm(`Nonaktifkan kontrak ${cr.vendorName ?? ""} ${cr.serviceCategory}?`)) {
                                  deleteContractMut.mutate(cr.id);
                                }
                              }}
                            >
                              <Ban className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Floating detail panel when triggered from dashboard */}
      {selectedRequestId && activeTab !== "requests" && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <RequestDetailPanel
              requestId={selectedRequestId}
              onClose={() => setSelectedRequestId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
