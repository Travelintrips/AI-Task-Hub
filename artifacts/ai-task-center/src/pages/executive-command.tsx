import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  TrendingUp,
  ShieldAlert,
  Truck,
  ShoppingCart,
  Users,
  Brain,
  DollarSign,
  Activity,
  Flame,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Link2,
  LayoutGrid,
  ListChecks,
} from "lucide-react";
import { useState } from "react";

// ── API helpers ────────────────────────────────────────────────────────────────

function apiFetch(path: string, opts?: RequestInit) {
  const token = getStoredToken();
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface KpiData {
  generatedAt: string;
  totalActiveTasks: number;
  highRiskCustomers: number;
  highRiskVendors: number;
  highRiskFleetUnits: number;
  pendingApprovals: number;
  projectedMarginRisk: number;
  duplicatePurchaseRisk: number;
  avgFleetCostPerKm: number | null;
}

interface Alert {
  id: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  count: number;
  href?: string;
}

interface AlertsData {
  generatedAt: string;
  alerts: Alert[];
}

interface ReadinessModule {
  name: string;
  score: number;
  status: "good" | "warning" | "critical" | "empty";
  lastRefresh: string | null;
  staleCount: number;
  totalCount: number;
}

interface ReadinessData {
  generatedAt: string;
  overallScore: number;
  modules: ReadinessModule[];
}

interface FinancialSlice {
  estimatedSavingsIdr: number;
  preventedDuplicates: number;
  preventedLowMargin: number;
  vendorOptimizationOpportunities: number;
  fleetCostSavingUnits: number;
}

interface FinancialData {
  generatedAt: string;
  monthly: FinancialSlice;
  all_time: FinancialSlice;
}

interface RefreshSection {
  sectionName: string;
  lastSuccess: string | null;
  lastFailure: string | null;
  durationMs: number | null;
  status: string;
  successCount: number;
  failureCount: number;
}

interface RefreshHealthData {
  generatedAt: string;
  sections: RefreshSection[];
}

// Sprint 8C types

interface PendingApproval {
  approvalId: number;
  requestNumber: string;
  requestedBy: string;
  riskTier: string | null;
  estimatedAmount: number | null;
  vendorName: string | null;
  serviceCategory: string | null;
  requestId: number | null;
  submittedAt: string | null;
}

interface QuickLink {
  label: string;
  count: number;
  href: string;
  type: string;
}

interface ActionCenterData {
  generatedAt: string;
  pendingApprovals: PendingApproval[];
  quickLinks: QuickLink[];
}

type EventSeverity = "critical" | "high" | "medium" | "low" | "info";

interface TimelineEvent {
  id: string;
  source: string;
  severity: EventSeverity;
  title: string;
  detail: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actionUrl: string | null;
}

interface TimelineData {
  generatedAt: string;
  total: number;
  events: TimelineEvent[];
}

type RiskLevel = "critical" | "high" | "medium" | "low";

interface HeatmapCell {
  count: number;
  score: number;
  topEntities: Array<{ id: string; label: string }>;
  actionUrl: string;
}

interface HeatmapRow {
  module: string;
  key: string;
  data: Record<RiskLevel, HeatmapCell>;
}

interface RiskHeatmapData {
  generatedAt: string;
  rows: HeatmapRow[];
  columns: RiskLevel[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StaleBadge({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <Badge variant="outline" className="text-xs text-muted-foreground">Belum pernah</Badge>;
  const hours = (Date.now() - new Date(dateStr).getTime()) / 3_600_000;
  if (hours > 24) return <Badge variant="destructive" className="text-xs">Stale {Math.round(hours)}j</Badge>;
  if (hours > 6) return <Badge variant="secondary" className="text-xs text-yellow-700 bg-yellow-100">Stale {Math.round(hours)}j</Badge>;
  return <Badge variant="outline" className="text-xs text-green-700 bg-green-50">Baru {Math.round(hours)}j lalu</Badge>;
}

function SeverityBadge({ severity }: { severity: Alert["severity"] }) {
  const map: Record<Alert["severity"], string> = {
    critical: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
    low: "bg-blue-100 text-blue-800 border-blue-200",
  };
  const label: Record<Alert["severity"], string> = {
    critical: "KRITIS",
    high: "TINGGI",
    medium: "SEDANG",
    low: "RENDAH",
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${map[severity]}`}>
      {label[severity]}
    </span>
  );
}

function AlertIcon({ type }: { type: string }) {
  const icons: Record<string, React.ComponentType<{ className?: string }>> = {
    task: Clock,
    fleet: Truck,
    vendor: ShieldAlert,
    purchasing: ShoppingCart,
    ai: Brain,
  };
  const Icon = icons[type] ?? AlertCircle;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

const idrFmt = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });

function ReadinessStatusIcon({ status }: { status: ReadinessModule["status"] }) {
  if (status === "good") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
  if (status === "critical") return <XCircle className="h-4 w-4 text-red-600" />;
  return <Activity className="h-4 w-4 text-muted-foreground" />;
}

function progressColor(score: number) {
  if (score >= 70) return "bg-green-500";
  if (score >= 40) return "bg-yellow-500";
  return "bg-red-500";
}

function RefreshStatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-red-600" />;
  return <Activity className="h-4 w-4 text-muted-foreground" />;
}

function sectionLabel(name: string) {
  const map: Record<string, string> = {
    customer_memory: "Customer Memory",
    vendor_memory: "Vendor Memory",
    purchasing_intel: "Purchasing Intel",
    fleet_units: "Armada",
    fleet_documents: "Dokumen Armada",
    fleet_fuel: "BBM Armada",
    driver_memory: "Driver Memory",
    ai_tasks: "AI Tasks",
  };
  return map[name] ?? name;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />;
}

function RiskTierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-blue-100 text-blue-800",
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${map[tier] ?? "bg-gray-100 text-gray-700"}`}>
      {tier.toUpperCase()}
    </span>
  );
}

function EventSeverityDot({ severity }: { severity: EventSeverity }) {
  const colors: Record<EventSeverity, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-blue-400",
    info: "bg-gray-300",
  };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${colors[severity]}`} />;
}

function HeatmapCellView({
  cell,
  level,
}: {
  cell: HeatmapCell;
  level: RiskLevel;
}) {
  const bgMap: Record<RiskLevel, string> = {
    critical: cell.count > 0 ? "bg-red-100 border-red-200" : "bg-muted/20 border-transparent",
    high: cell.count > 0 ? "bg-orange-50 border-orange-200" : "bg-muted/20 border-transparent",
    medium: cell.count > 0 ? "bg-yellow-50 border-yellow-200" : "bg-muted/20 border-transparent",
    low: cell.count > 0 ? "bg-blue-50 border-blue-200" : "bg-muted/20 border-transparent",
  };
  const textMap: Record<RiskLevel, string> = {
    critical: "text-red-700",
    high: "text-orange-700",
    medium: "text-yellow-700",
    low: "text-blue-700",
  };

  if (cell.count === 0) {
    return (
      <div className={`rounded border p-1.5 text-center min-h-[44px] flex items-center justify-center ${bgMap[level]}`}>
        <span className="text-xs text-muted-foreground">—</span>
      </div>
    );
  }

  return (
    <a
      href={cell.actionUrl}
      className={`rounded border p-1.5 flex flex-col items-center min-h-[44px] hover:opacity-80 transition-opacity cursor-pointer ${bgMap[level]}`}
    >
      <span className={`text-lg font-bold leading-tight ${textMap[level]}`}>{cell.count}</span>
      {cell.topEntities.length > 0 && (
        <span className="text-[9px] text-muted-foreground truncate w-full text-center leading-tight mt-0.5">
          {cell.topEntities[0]?.label}
        </span>
      )}
    </a>
  );
}

function sourceLabel(source: string) {
  const map: Record<string, string> = {
    audit_logs: "Audit",
    ai_tasks: "Tugas AI",
    purchasing_intel_signals: "Intel Beli",
    fleet_report_logs: "Laporan Armada",
    vendor_recommendation_outcomes: "Rekomendasi Vendor",
    fleet_scheduler_runs: "Scheduler",
  };
  return map[source] ?? source;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExecutiveCommandPage() {
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<PendingApproval | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const kpisQ = useQuery<KpiData>({
    queryKey: ["executive-kpis"],
    queryFn: () => apiFetch("/api/executive/kpis"),
    retry: 1,
    staleTime: 60_000,
  });

  const alertsQ = useQuery<AlertsData>({
    queryKey: ["executive-alerts"],
    queryFn: () => apiFetch("/api/executive/alerts"),
    retry: 1,
    staleTime: 60_000,
  });

  const readinessQ = useQuery<ReadinessData>({
    queryKey: ["executive-readiness"],
    queryFn: () => apiFetch("/api/executive/readiness"),
    retry: 1,
    staleTime: 120_000,
  });

  const financialQ = useQuery<FinancialData>({
    queryKey: ["executive-financial"],
    queryFn: () => apiFetch("/api/executive/financial-protection"),
    retry: 1,
    staleTime: 120_000,
  });

  const healthQ = useQuery<RefreshHealthData>({
    queryKey: ["executive-refresh-health"],
    queryFn: () => apiFetch("/api/executive/refresh-health"),
    retry: 1,
    staleTime: 120_000,
  });

  // Sprint 8C queries
  const actionCenterQ = useQuery<ActionCenterData>({
    queryKey: ["executive-action-center"],
    queryFn: () => apiFetch("/api/executive/action-center"),
    retry: 1,
    staleTime: 30_000,
  });

  const timelineQ = useQuery<TimelineData>({
    queryKey: ["executive-timeline"],
    queryFn: () => apiFetch("/api/executive/timeline?limit=50"),
    retry: 1,
    staleTime: 60_000,
  });

  const heatmapQ = useQuery<RiskHeatmapData>({
    queryKey: ["executive-risk-heatmap"],
    queryFn: () => apiFetch("/api/executive/risk-heatmap"),
    retry: 1,
    staleTime: 120_000,
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: ({ approvalId, notes }: { approvalId: number; notes?: string }) =>
      apiFetch(`/api/executive/actions/approve/${approvalId}`, {
        method: "POST",
        body: JSON.stringify({ notes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["executive-action-center"] });
      qc.invalidateQueries({ queryKey: ["executive-kpis"] });
      qc.invalidateQueries({ queryKey: ["executive-timeline"] });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ approvalId, notes }: { approvalId: number; notes: string }) =>
      apiFetch(`/api/executive/actions/reject/${approvalId}`, {
        method: "POST",
        body: JSON.stringify({ notes }),
      }),
    onSuccess: () => {
      setRejectTarget(null);
      setRejectNotes("");
      qc.invalidateQueries({ queryKey: ["executive-action-center"] });
      qc.invalidateQueries({ queryKey: ["executive-kpis"] });
      qc.invalidateQueries({ queryKey: ["executive-timeline"] });
    },
  });

  const kpi = kpisQ.data;
  const alerts = alertsQ.data?.alerts ?? [];
  const readiness = readinessQ.data;
  const financial = financialQ.data;
  const health = healthQ.data;
  const actionCenter = actionCenterQ.data;
  const timeline = timelineQ.data;
  const heatmap = heatmapQ.data;

  const RISK_COLS: { key: RiskLevel; label: string }[] = [
    { key: "critical", label: "Kritis" },
    { key: "high", label: "Tinggi" },
    { key: "medium", label: "Sedang" },
    { key: "low", label: "Rendah" },
  ];

  return (
    <div className="flex flex-col min-h-full bg-background">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Command Center</h1>
              <p className="text-sm text-muted-foreground">
                Ringkasan eksekutif operasional real-time
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            {kpi
              ? `Diperbarui ${new Date(kpi.generatedAt).toLocaleTimeString("id-ID")}`
              : "Memuat..."}
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6 overflow-auto">

        {/* ── Panel 1: Executive KPI Grid ─────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            KPI Eksekutif
          </h2>
          {kpisQ.isError ? (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
              Gagal memuat KPI. Data mungkin tidak tersedia.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  label: "Tugas Aktif",
                  value: kpi?.totalActiveTasks,
                  icon: Activity,
                  accent: "text-blue-600 bg-blue-50",
                },
                {
                  label: "Pelanggan Risiko Tinggi",
                  value: kpi?.highRiskCustomers,
                  icon: Users,
                  accent: kpi?.highRiskCustomers ? "text-red-600 bg-red-50" : "text-muted-foreground bg-muted/40",
                },
                {
                  label: "Vendor Risiko Tinggi",
                  value: kpi?.highRiskVendors,
                  icon: ShieldAlert,
                  accent: kpi?.highRiskVendors ? "text-red-600 bg-red-50" : "text-muted-foreground bg-muted/40",
                },
                {
                  label: "Armada Bermasalah",
                  value: kpi?.highRiskFleetUnits,
                  icon: Truck,
                  accent: kpi?.highRiskFleetUnits ? "text-orange-600 bg-orange-50" : "text-muted-foreground bg-muted/40",
                },
                {
                  label: "Menunggu Persetujuan",
                  value: kpi?.pendingApprovals,
                  icon: Clock,
                  accent: kpi?.pendingApprovals ? "text-yellow-600 bg-yellow-50" : "text-muted-foreground bg-muted/40",
                },
                {
                  label: "Risiko Margin",
                  value: kpi?.projectedMarginRisk,
                  icon: TrendingUp,
                  accent: kpi?.projectedMarginRisk ? "text-orange-600 bg-orange-50" : "text-muted-foreground bg-muted/40",
                },
                {
                  label: "Risiko Duplikat",
                  value: kpi?.duplicatePurchaseRisk,
                  icon: ShoppingCart,
                  accent: kpi?.duplicatePurchaseRisk ? "text-red-600 bg-red-50" : "text-muted-foreground bg-muted/40",
                },
                {
                  label: "Rata-rata Biaya/KM",
                  value: kpi?.avgFleetCostPerKm != null ? `Rp ${idrFmt.format(kpi.avgFleetCostPerKm)}` : "—",
                  icon: Flame,
                  accent: "text-indigo-600 bg-indigo-50",
                  raw: true,
                },
              ].map((item) => {
                const Icon = item.icon;
                const loading = kpisQ.isLoading;
                return (
                  <Card key={item.label} className="border shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground truncate">{item.label}</p>
                          {loading ? (
                            <Skeleton className="h-7 w-16 mt-1" />
                          ) : (
                            <p className="text-2xl font-bold mt-0.5">
                              {item.raw ? item.value : (item.value ?? 0)}
                            </p>
                          )}
                        </div>
                        <div className={`p-1.5 rounded-md shrink-0 ${item.accent}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Panels 2 & 3: Alerts + Readiness ──────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Panel 2: Operational Alerts */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Alert Operasional
                {alerts.length > 0 && (
                  <Badge variant="destructive" className="ml-auto text-xs">
                    {alerts.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alertsQ.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))
              ) : alertsQ.isError ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Gagal memuat alert.
                </p>
              ) : alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
                  <p className="text-sm font-medium">Semua bersih</p>
                  <p className="text-xs">Tidak ada alert aktif saat ini</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {alerts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-start gap-2 p-2.5 rounded-md border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <AlertIcon type={a.type} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium leading-tight">{a.title}</p>
                          <SeverityBadge severity={a.severity} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{a.detail}</p>
                      </div>
                      <span className="text-sm font-bold text-muted-foreground shrink-0">{a.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Panel 3: Intelligence Readiness */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4 text-indigo-500" />
                Readiness Intelijen
                {readiness && (
                  <span className="ml-auto text-lg font-bold text-indigo-600">
                    {readiness.overallScore}%
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {readinessQ.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))
              ) : readinessQ.isError ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Gagal memuat readiness.
                </p>
              ) : !readiness || readiness.modules.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Belum ada data readiness.
                </p>
              ) : (
                readiness.modules.map((m) => (
                  <div key={m.name} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <ReadinessStatusIcon status={m.status} />
                      <span className="text-sm font-medium flex-1">{m.name}</span>
                      <StaleBadge dateStr={m.lastRefresh} />
                      <span className="text-sm font-bold w-8 text-right">{m.score}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${progressColor(m.score)}`}
                          style={{ width: `${m.score}%` }}
                        />
                      </div>
                      {m.staleCount > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {m.staleCount} stale
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── 8C Panels: Action Center + Risk Heatmap ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Panel 6: Action Center */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-emerald-600" />
                Action Center
                {(actionCenter?.pendingApprovals.length ?? 0) > 0 && (
                  <Badge variant="destructive" className="ml-auto text-xs">
                    {actionCenter!.pendingApprovals.length} menunggu
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {actionCenterQ.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : actionCenterQ.isError ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Gagal memuat action center.</p>
              ) : (
                <>
                  {/* Pending Approvals Queue */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Antrian Persetujuan
                    </p>
                    {!actionCenter || actionCenter.pendingApprovals.length === 0 ? (
                      <div className="flex items-center gap-2 py-3 text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-sm">Tidak ada persetujuan tertunda</span>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {actionCenter.pendingApprovals.map((ap) => (
                          <div
                            key={ap.approvalId}
                            className="flex items-start gap-2 p-2.5 rounded-md border bg-card"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-medium">{ap.requestNumber}</span>
                                <RiskTierBadge tier={ap.riskTier} />
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {ap.vendorName ?? "Vendor tidak diketahui"} — {ap.serviceCategory ?? "—"}
                              </p>
                              {ap.estimatedAmount && (
                                <p className="text-xs text-muted-foreground">
                                  Rp {ap.estimatedAmount.toLocaleString("id-ID")}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-green-700 border-green-200 hover:bg-green-50"
                                disabled={approveMutation.isPending}
                                onClick={() =>
                                  approveMutation.mutate({ approvalId: ap.approvalId })
                                }
                              >
                                <ThumbsUp className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-red-700 border-red-200 hover:bg-red-50"
                                disabled={rejectMutation.isPending}
                                onClick={() => {
                                  setRejectTarget(ap);
                                  setRejectNotes("");
                                }}
                              >
                                <ThumbsDown className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Quick Links */}
                  {actionCenter && actionCenter.quickLinks.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Quick Links Risiko Tinggi
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {actionCenter.quickLinks.map((ql) => (
                          <a
                            key={ql.type}
                            href={ql.href}
                            className="flex items-center justify-between p-2 rounded-md border hover:bg-accent/50 transition-colors"
                          >
                            <span className="text-xs text-muted-foreground truncate">{ql.label}</span>
                            <span className={`text-sm font-bold ml-2 shrink-0 ${ql.count > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                              {ql.count}
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Panel 7: Risk Heatmap */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-red-500" />
                Cross-Module Risk Heatmap
                {heatmap && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(heatmap.generatedAt).toLocaleTimeString("id-ID")}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {heatmapQ.isLoading ? (
                <Skeleton className="h-56 w-full" />
              ) : heatmapQ.isError ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Gagal memuat heatmap.</p>
              ) : !heatmap ? null : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left py-1 pr-2 font-semibold text-muted-foreground w-24">Modul</th>
                        {RISK_COLS.map((c) => (
                          <th key={c.key} className="text-center py-1 px-1 font-semibold text-muted-foreground">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmap.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="py-1 pr-2 font-medium text-muted-foreground text-xs whitespace-nowrap">
                            {row.module}
                          </td>
                          {RISK_COLS.map((c) => (
                            <td key={c.key} className="py-0.5 px-0.5">
                              <HeatmapCellView cell={row.data[c.key]} level={c.key} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Panels 4 & 5: Financial + Refresh Health ───────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Panel 4: Financial Protection */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-600" />
                Perlindungan Finansial
              </CardTitle>
            </CardHeader>
            <CardContent>
              {financialQ.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : financialQ.isError ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Gagal memuat data finansial.
                </p>
              ) : !financial ? null : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <div />
                  <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-muted-foreground pb-1 border-b">
                    <span>Bulan Ini</span>
                    <span>Sepanjang Waktu</span>
                  </div>
                  {[
                    {
                      label: "Estimasi Penghematan",
                      monthly: `Rp ${idrFmt.format(financial.monthly.estimatedSavingsIdr)}`,
                      allTime: `Rp ${idrFmt.format(financial.all_time.estimatedSavingsIdr)}`,
                    },
                    {
                      label: "Duplikat Dicegah",
                      monthly: financial.monthly.preventedDuplicates,
                      allTime: financial.all_time.preventedDuplicates,
                    },
                    {
                      label: "Margin Rendah Dicegah",
                      monthly: financial.monthly.preventedLowMargin,
                      allTime: financial.all_time.preventedLowMargin,
                    },
                    {
                      label: "Peluang Optimasi Vendor",
                      monthly: financial.monthly.vendorOptimizationOpportunities,
                      allTime: financial.all_time.vendorOptimizationOpportunities,
                    },
                    {
                      label: "Unit Armada > Biaya Rata",
                      monthly: financial.monthly.fleetCostSavingUnits,
                      allTime: financial.all_time.fleetCostSavingUnits,
                    },
                  ].map((row) => (
                    <>
                      <span key={`lbl-${row.label}`} className="text-xs text-muted-foreground py-1.5 border-b last:border-0">
                        {row.label}
                      </span>
                      <div key={`val-${row.label}`} className="grid grid-cols-2 gap-2 py-1.5 border-b last:border-0">
                        <span className="text-sm font-semibold">{row.monthly}</span>
                        <span className="text-sm font-semibold text-muted-foreground">{row.allTime}</span>
                      </div>
                    </>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Panel 5: Refresh Health */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-sky-500" />
                Kesehatan Refresh Data
              </CardTitle>
            </CardHeader>
            <CardContent>
              {healthQ.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : healthQ.isError ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Gagal memuat refresh health.
                </p>
              ) : !health || health.sections.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Belum ada log refresh.
                </p>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                  {health.sections.map((s) => (
                    <div
                      key={s.sectionName}
                      className="flex items-center gap-2 py-1.5 border-b last:border-0"
                    >
                      <RefreshStatusIcon status={s.status} />
                      <span className="text-sm flex-1 truncate">{sectionLabel(s.sectionName)}</span>
                      <StaleBadge dateStr={s.lastSuccess} />
                      {s.durationMs != null && (
                        <span className="text-[10px] text-muted-foreground w-14 text-right">
                          {s.durationMs}ms
                        </span>
                      )}
                      {s.failureCount > 0 && (
                        <span className="text-[10px] text-red-600 font-semibold">
                          {s.failureCount} err
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Panel 8: Executive Timeline (full-width) ────────────────────── */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-500" />
              Timeline Eksekutif
              {timeline && (
                <Badge variant="outline" className="ml-auto text-xs">
                  {timeline.total} event
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => qc.invalidateQueries({ queryKey: ["executive-timeline"] })}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {timelineQ.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : timelineQ.isError ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Gagal memuat timeline.</p>
            ) : !timeline || timeline.events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Activity className="h-8 w-8 mb-2" />
                <p className="text-sm font-medium">Belum ada event</p>
                <p className="text-xs">Timeline akan terisi saat aktivitas terjadi</p>
              </div>
            ) : (
              <div className="space-y-0 max-h-96 overflow-y-auto pr-2">
                {timeline.events.map((ev, idx) => (
                  <div
                    key={ev.id}
                    className={`flex items-start gap-3 py-2.5 ${idx < timeline.events.length - 1 ? "border-b" : ""}`}
                  >
                    <EventSeverityDot severity={ev.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium leading-tight truncate max-w-xs">
                          {ev.title}
                        </span>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">
                          {sourceLabel(ev.source)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">
                        {ev.detail}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(ev.createdAt).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {ev.actionUrl && (
                        <a
                          href={ev.actionUrl}
                          className="text-muted-foreground hover:text-primary"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectNotes(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak Persetujuan</DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <div className="space-y-4">
              <div className="p-3 rounded-md border bg-muted/40 text-sm">
                <p className="font-medium">{rejectTarget.requestNumber}</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {rejectTarget.vendorName} — {rejectTarget.serviceCategory ?? "—"}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Alasan Penolakan <span className="text-red-500">*</span>
                </label>
                <Textarea
                  placeholder="Jelaskan alasan penolakan..."
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  rows={3}
                />
                {rejectNotes.trim().length === 0 && (
                  <p className="text-xs text-red-500">Alasan wajib diisi</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setRejectTarget(null); setRejectNotes(""); }}
              disabled={rejectMutation.isPending}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectNotes.trim() || rejectMutation.isPending}
              onClick={() => {
                if (rejectTarget && rejectNotes.trim()) {
                  rejectMutation.mutate({ approvalId: rejectTarget.approvalId, notes: rejectNotes.trim() });
                }
              }}
            >
              {rejectMutation.isPending ? "Menolak..." : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
