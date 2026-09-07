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
  ShieldCheck,
  ShieldOff,
  Shield,
  Play,
  MessageSquare,
  ClipboardList,
  Award,
  Database,
  Bell,
  BellOff,
  Send,
  Eye,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useLocation } from "wouter";
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
  activeDrivers: number;
  driverOnboardingRate: number;
  simExpiringCount: number;
  avgFuelScore: number | null;
  incidentsPer100Trips: number;
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

// Sprint 8D types

interface AiRisk {
  severity: string;
  text: string;
  entityType: string;
  entityId: string;
}

interface AiAction {
  priority: string;
  text: string;
  actionUrl: string;
}

interface AiSummaryData {
  id: number;
  company_id: string;
  summary: string;
  risks: AiRisk[];
  actions: AiAction[];
  context_hash: string | null;
  generated_by: string;
  generated_at: string;
}

interface AiSummaryResponse {
  cached: boolean;
  cacheExpiresAt: string | null;
  data: AiSummaryData | null;
}

interface AiSummaryHistoryResponse {
  total: number;
  history: AiSummaryData[];
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

// ── Data Health Widget (Sprint 10A-1.1) ───────────────────────────────────────

interface DataHealth {
  status: "ok" | "warn" | "drift" | "unknown";
  typeMismatches: number;
  missingColumns: number;
  missingTables: number;
  criticalCompanyIdMismatches: { table: string; col: string; drizzle: string; actual: string }[];
  generatedAt: string | null;
}

function DataHealthWidget() {
  const q = useQuery<DataHealth>({
    queryKey: ["data-health"],
    queryFn: () => apiFetch("/api/executive/data-health"),
    refetchInterval: 300_000, // refresh every 5 min
    retry: false,
  });
  const d = q.data;
  const statusColor = {
    ok: "text-green-600 bg-green-50 border-green-200",
    warn: "text-yellow-700 bg-yellow-50 border-yellow-200",
    drift: "text-red-700 bg-red-50 border-red-200",
    unknown: "text-gray-600 bg-gray-50 border-gray-200",
  };
  const statusLabel = {
    ok: "✅ Schema OK",
    warn: "⚠️ Peringatan",
    drift: "🔴 Schema Drift",
    unknown: "❓ Belum Diketahui",
  };
  return (
    <Card className="mt-4 border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Database className="h-4 w-4 text-indigo-600" />
          Data Health — Schema Consistency
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading && <div className="text-sm text-muted-foreground">Memuat data health...</div>}
        {q.isError && <div className="text-sm text-red-600">Gagal memuat data health (butuh login admin)</div>}
        {d && (
          <div className="space-y-3">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${statusColor[d.status]}`}>
              {statusLabel[d.status]}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Type Mismatch", value: d.typeMismatches, warn: d.typeMismatches > 0 },
                { label: "Kolom Hilang", value: d.missingColumns, warn: d.missingColumns > 0 },
                { label: "Tabel Hilang", value: d.missingTables, warn: d.missingTables > 0 },
              ].map((item) => (
                <div key={item.label} className={`rounded-lg p-3 border ${item.warn ? "border-orange-200 bg-orange-50" : "border-gray-100 bg-gray-50"}`}>
                  <div className={`text-2xl font-bold ${item.warn ? "text-orange-700" : "text-gray-700"}`}>{item.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>
            {d.criticalCompanyIdMismatches.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                <div className="text-xs font-semibold text-red-800 mb-1.5">🔴 Company ID Type Mismatch (kritis)</div>
                {d.criticalCompanyIdMismatches.map((m) => (
                  <div key={m.table} className="text-xs font-mono text-red-700">
                    {m.table}.{m.col}: DB={m.actual} vs Drizzle={m.drizzle}
                  </div>
                ))}
                <div className="text-xs text-red-600 mt-1.5">
                  Gunakan <code className="bg-red-100 px-1 rounded">companyFilter()</code> — lihat <code>src/lib/company-id.ts</code>
                </div>
              </div>
            )}
            {d.generatedAt && (
              <div className="text-xs text-muted-foreground">
                Diperbarui: {new Date(d.generatedAt).toLocaleString("id-ID")}
                {" · "}
                <button
                  onClick={() => q.refetch()}
                  className="text-indigo-600 hover:underline"
                >
                  Refresh
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function ConversationIntakeWidget() {
  const [, navigate] = useLocation();
  const statsQ = useQuery<{ active: number; waitingUser: number; waitingDocument: number; completedToday: number; expiredToday: number }>({
    queryKey: ["intake-stats-ecc"],
    queryFn: () => apiFetch("/intake-sessions/stats"),
    refetchInterval: 30_000,
  });
  const s = statsQ.data;
  return (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Conversation Intake
      </h2>
      <Card className="border shadow-sm">
        <CardContent className="pt-4">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-blue-100 shrink-0">
              <MessageSquare className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold">Sesi WhatsApp Aktif</span>
                {(s?.active ?? 0) > 0 && (
                  <Badge className="bg-blue-100 text-blue-800 border-0 text-xs">{s?.active} aktif</Badge>
                )}
              </div>
              <div className="grid grid-cols-5 gap-2 text-center">
                {[
                  { label: "Aktif",          value: s?.active ?? 0,          color: "text-blue-600" },
                  { label: "Menunggu Jawab", value: s?.waitingUser ?? 0,      color: "text-orange-600" },
                  { label: "Menunggu Dok",   value: s?.waitingDocument ?? 0,  color: "text-purple-600" },
                  { label: "Selesai",        value: s?.completedToday ?? 0,   color: "text-green-600" },
                  { label: "Kedaluwarsa",    value: s?.expiredToday ?? 0,     color: "text-gray-500" },
                ].map((item) => (
                  <div key={item.label}>
                    <div className={`text-xl font-bold ${item.color}`}>{item.value}</div>
                    <div className="text-xs text-muted-foreground leading-tight">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={() => navigate("/conversation-intake")}>
              Lihat Semua Sesi →
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export default function ExecutiveCommandPage() {
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<PendingApproval | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);

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

  // Sprint 8D queries
  const summaryQ = useQuery<AiSummaryResponse>({
    queryKey: ["executive-ai-summary"],
    queryFn: () => apiFetch("/api/executive/ai-summary/latest"),
    retry: 1,
    staleTime: 5 * 60_000,
  });

  const historyQ = useQuery<AiSummaryHistoryResponse>({
    queryKey: ["executive-ai-summary-history"],
    queryFn: () => apiFetch("/api/executive/ai-summary/history?limit=10"),
    enabled: showHistory,
    retry: 1,
    staleTime: 60_000,
  });

  const generateMutation = useMutation({
    mutationFn: (force: boolean) =>
      apiFetch("/api/executive/ai-summary", {
        method: "POST",
        body: JSON.stringify({ force }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["executive-ai-summary"] });
      qc.invalidateQueries({ queryKey: ["executive-ai-summary-history"] });
    },
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

  const gateQ = useQuery<{ latestRun: { passRate: number; passedCases: number; failedCases: number; totalCases: number; qualityGatePassed: boolean | null; startedAt: string } | null; aiProductionMode: string }>({
    queryKey: ["exec-conv-test-gate"],
    queryFn: () => apiFetch("/api/conversation-tests/latest-gate"),
    staleTime: 60_000,
    retry: 1,
  });

  const runTestsMut = useMutation({
    mutationFn: () => apiFetch("/api/conversation-tests/run", {
      method: "POST",
      body: JSON.stringify({ runName: `Run dari Command Center ${new Date().toLocaleString("id-ID")}` }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exec-conv-test-gate"] }),
  });

  const qualityGateQ = useQuery<{
    data: {
      runId: number; successRate: number; passed: number; failed: number;
      total: number; certified: boolean; goDecision: string; startedAt: string;
    } | null;
  }>({
    queryKey: ["executive-quality-gate"],
    queryFn: () => apiFetch("/api/quality-gate/latest"),
    staleTime: 120_000,
    retry: 1,
  });

  const [, navigate] = useLocation();

  const kpi = kpisQ.data;
  const alerts = alertsQ.data?.alerts ?? [];
  const readiness = readinessQ.data;
  const financial = financialQ.data;
  const health = healthQ.data;
  const actionCenter = actionCenterQ.data;
  const timeline = timelineQ.data;
  const heatmap = heatmapQ.data;
  const gate = gateQ.data;

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
                {
                  label: "Driver Aktif",
                  value: kpi?.activeDrivers,
                  icon: Users,
                  accent: "text-emerald-600 bg-emerald-50",
                },
                {
                  label: "Onboarding Driver (%)",
                  value: kpi?.driverOnboardingRate != null ? `${kpi.driverOnboardingRate}%` : "—",
                  icon: CheckCircle2,
                  accent: (kpi?.driverOnboardingRate ?? 0) >= 80 ? "text-emerald-600 bg-emerald-50" : "text-orange-600 bg-orange-50",
                  raw: true,
                },
                {
                  label: "SIM Kadaluarsa ≤30 Hari",
                  value: kpi?.simExpiringCount,
                  icon: AlertCircle,
                  accent: kpi?.simExpiringCount ? "text-red-600 bg-red-50" : "text-muted-foreground bg-muted/40",
                },
                {
                  label: "Rata-rata Efisiensi BBM",
                  value: kpi?.avgFuelScore != null ? `${kpi.avgFuelScore} KM/L` : "—",
                  icon: Award,
                  accent: "text-blue-600 bg-blue-50",
                  raw: true,
                },
                {
                  label: "Insiden per 100 Trip",
                  value: kpi?.incidentsPer100Trips != null ? `${kpi.incidentsPer100Trips}` : "—",
                  icon: ShieldAlert,
                  accent: (kpi?.incidentsPer100Trips ?? 0) > 5 ? "text-red-600 bg-red-50" : "text-muted-foreground bg-muted/40",
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

        {/* ── Conversation Intake Widget ─────────────────────────────────── */}
        <ConversationIntakeWidget />

        {/* ── AI Quality Gate Widget ─────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            AI Quality Gate
          </h2>
          <Card className="border shadow-sm">
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {gate?.latestRun?.qualityGatePassed === true ? (
                    <div className="p-2 rounded-lg bg-green-100"><ShieldCheck className="h-5 w-5 text-green-600" /></div>
                  ) : gate?.latestRun?.qualityGatePassed === false ? (
                    <div className="p-2 rounded-lg bg-red-100"><ShieldOff className="h-5 w-5 text-red-600" /></div>
                  ) : (
                    <div className="p-2 rounded-lg bg-muted"><Shield className="h-5 w-5 text-muted-foreground" /></div>
                  )}
                  <div>
                    <div className="text-sm font-semibold">
                      {gate?.latestRun?.qualityGatePassed === true ? "Quality Gate Lulus" :
                        gate?.latestRun?.qualityGatePassed === false ? "Quality Gate Gagal" :
                        "Belum Diuji"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Mode AI:{" "}
                      <span className={`font-medium ${gate?.aiProductionMode === "production" ? "text-green-600" : gate?.aiProductionMode === "test" ? "text-blue-600" : "text-muted-foreground"}`}>
                        {gate?.aiProductionMode === "production" ? "Produksi" : gate?.aiProductionMode === "test" ? "Test" : "Nonaktif"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {gate?.latestRun ? (
                    <>
                      <div className={`text-2xl font-bold ${(gate.latestRun.passRate ?? 0) >= 90 ? "text-green-600" : "text-red-600"}`}>
                        {gate.latestRun.passRate}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {gate.latestRun.passedCases}/{gate.latestRun.totalCases} kasus lulus
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(gate.latestRun.startedAt).toLocaleDateString("id-ID")}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">Belum ada test run</div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runTestsMut.mutate()}
                  disabled={runTestsMut.isPending}
                >
                  {runTestsMut.isPending ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                  Jalankan Test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate("/conversation-tests")}>
                  Lihat Detail →
                </Button>
              </div>
            </CardContent>
          </Card>
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

        {/* ── Panel 9: AI Executive Summary (full-width) ───────────────────── */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-500" />
              Ringkasan Eksekutif AI
              {summaryQ.data && (
                <Badge
                  variant="outline"
                  className={`ml-2 text-[10px] px-1.5 py-0 ${
                    summaryQ.data.cached
                      ? "text-green-700 bg-green-50 border-green-200"
                      : "text-blue-700 bg-blue-50 border-blue-200"
                  }`}
                >
                  {summaryQ.data.cached ? "Cache" : "Baru"}
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 ml-auto"
                onClick={() => setShowHistory((v) => !v)}
              >
                <ListChecks className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">{showHistory ? "Sembunyikan" : "Riwayat"}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs"
                disabled={generateMutation.isPending}
                onClick={() => generateMutation.mutate(false)}
              >
                {generateMutation.isPending ? (
                  <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Membuat...</>
                ) : (
                  <><Zap className="h-3 w-3 mr-1" /> Generate Baru</>
                )}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {generateMutation.isError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                Gagal membuat ringkasan. Coba lagi.
              </div>
            )}

            {summaryQ.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : summaryQ.isError ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Gagal memuat ringkasan.</p>
            ) : !summaryQ.data?.data ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Brain className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm font-medium">Belum ada ringkasan AI</p>
                <p className="text-xs mb-4">Klik "Generate Baru" untuk membuat ringkasan pertama</p>
                <Button
                  size="sm"
                  onClick={() => generateMutation.mutate(false)}
                  disabled={generateMutation.isPending}
                >
                  <Zap className="h-3.5 w-3.5 mr-1" />
                  {generateMutation.isPending ? "Membuat..." : "Generate Ringkasan"}
                </Button>
              </div>
            ) : (() => {
              const d = summaryQ.data.data!;
              return (
                <div className="space-y-4">
                  {/* Meta info */}
                  <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                    <span>
                      Dibuat:{" "}
                      {new Date(d.generated_at).toLocaleString("id-ID", {
                        day: "2-digit", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    <span>Oleh: {d.generated_by}</span>
                    {summaryQ.data.cacheExpiresAt && (
                      <span>
                        Cache s/d:{" "}
                        {new Date(summaryQ.data.cacheExpiresAt).toLocaleString("id-ID", {
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    )}
                    {d.context_hash && (
                      <code className="bg-muted px-1 rounded font-mono text-[10px]">
                        {d.context_hash}
                      </code>
                    )}
                  </div>

                  {/* Summary paragraph */}
                  <div className="bg-muted/40 rounded-lg p-4 border">
                    <p className="text-sm leading-relaxed">{d.summary}</p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Risks */}
                    {d.risks.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          Risiko Teridentifikasi
                        </p>
                        <div className="space-y-1.5">
                          {d.risks.map((risk, i) => {
                            const sev = risk.severity?.toUpperCase();
                            const colorMap: Record<string, string> = {
                              CRITICAL: "bg-red-50 border-red-200 text-red-800",
                              HIGH: "bg-orange-50 border-orange-200 text-orange-800",
                              MEDIUM: "bg-yellow-50 border-yellow-200 text-yellow-800",
                              LOW: "bg-blue-50 border-blue-200 text-blue-800",
                            };
                            const cls = colorMap[sev] ?? "bg-muted/40 border text-foreground";
                            return (
                              <div key={i} className={`rounded border px-3 py-2 ${cls}`}>
                                <div className="flex items-center gap-2 mb-0.5">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  <span className="text-[10px] font-bold">{sev}</span>
                                  <span className="text-[10px] opacity-70">{risk.entityType}</span>
                                </div>
                                <p className="text-xs leading-snug">{risk.text}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Recommended actions */}
                    {d.actions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          Rekomendasi Tindakan
                        </p>
                        <div className="space-y-1.5">
                          {d.actions.map((action, i) => {
                            const prio = action.priority?.toUpperCase();
                            const colorMap: Record<string, string> = {
                              HIGH: "text-orange-700",
                              MEDIUM: "text-yellow-700",
                              LOW: "text-blue-700",
                            };
                            const cls = colorMap[prio] ?? "text-foreground";
                            return (
                              <div key={i} className="flex items-start gap-2 border rounded px-3 py-2 bg-muted/20">
                                <CheckCircle2 className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cls}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <span className={`text-[10px] font-bold ${cls}`}>{prio}</span>
                                  </div>
                                  <p className="text-xs leading-snug">{action.text}</p>
                                </div>
                                {action.actionUrl && (
                                  <a href={action.actionUrl} className="text-muted-foreground hover:text-primary shrink-0 mt-0.5">
                                    <Link2 className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* History drawer */}
            {showHistory && (
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Riwayat Ringkasan
                </p>
                {historyQ.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : historyQ.isError ? (
                  <p className="text-sm text-muted-foreground text-center py-3">Gagal memuat riwayat.</p>
                ) : !historyQ.data || historyQ.data.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">Belum ada riwayat.</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {historyQ.data.history.map((h) => (
                      <div key={h.id} className="border rounded p-3 bg-muted/20 space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                          <span className="font-medium text-foreground">#{h.id}</span>
                          <span>
                            {new Date(h.generated_at).toLocaleString("id-ID", {
                              day: "2-digit", month: "short", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </span>
                          <span>oleh {h.generated_by}</span>
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                            {h.risks.length} risiko · {h.actions.length} aksi
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{h.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Panel: Quality Gate Widget ───────────────────────────────── */}
        {(() => {
          const qg = qualityGateQ.data?.data;
          return (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Quality Gate
              </h2>
              <Card className="border shadow-sm">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg shrink-0 ${qg?.certified ? "bg-green-100" : qg ? "bg-red-100" : "bg-muted/40"}`}>
                      {qg?.certified
                        ? <Award className="h-5 w-5 text-green-600" />
                        : qg
                        ? <ShieldOff className="h-5 w-5 text-red-600" />
                        : <ClipboardList className="h-5 w-5 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm font-semibold">Sprint 9D Certification</span>
                        {qg ? (
                          <Badge className={`border-0 text-xs ${qg.goDecision === "GO" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                            {qg.goDecision === "GO" ? "🟢 GO" : "🔴 NO-GO"}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Belum ada run</Badge>
                        )}
                      </div>
                      {qg ? (
                        <div className="grid grid-cols-5 gap-2 text-center">
                          {[
                            { label: "Total",    value: qg.total,    color: "text-foreground" },
                            { label: "Passed",   value: qg.passed,   color: "text-green-600" },
                            { label: "Failed",   value: qg.failed,   color: qg.failed > 0 ? "text-red-600" : "text-muted-foreground" },
                            { label: "Rate",     value: `${(qg.successRate ?? 0).toFixed(0)}%`, color: (qg.successRate ?? 0) >= 95 ? "text-green-600" : "text-red-600" },
                            { label: "Build",    value: `#${qg.runId}`, color: "text-muted-foreground" },
                          ].map((item) => (
                            <div key={item.label}>
                              <div className={`text-xl font-bold ${item.color}`}>{item.value}</div>
                              <div className="text-xs text-muted-foreground leading-tight">{item.label}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Belum ada quality gate run. Jalankan dari halaman Certification Report.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" onClick={() => navigate("/quality-gate/report")}>
                      Lihat Certification Report →
                    </Button>
                    {qualityGateQ.isError && (
                      <span className="text-xs text-muted-foreground self-center">
                        (data tidak tersedia)
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </section>
          );
        })()}

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

      {/* WA First Operations Widget */}
      <WaAdoptionWidget />
    </div>
  );
}

// ── WhatsApp First Operations Adoption Widget ─────────────────────────────────

interface WaMetrics {
  totalExecs: number;
  uniqueUsersLast7d: number;
  byCommand: Array<{ command: string; execCount: number; successRate: number; roles: string[] }>;
  byRole: Array<{ role: string; count: number }>;
}

interface WaCmdLog {
  id: number;
  phone: string;
  role: string;
  command: string;
  args: string | null;
  result: string;
  replyPreview: string | null;
  executedAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  customer: "Customer", vendor: "Vendor", driver: "Driver",
  staff: "Staff", supervisor: "Supervisor", company_admin: "Admin",
  owner: "Owner", super_admin: "Super Admin",
};

const ROLE_COLOR: Record<string, string> = {
  customer: "bg-blue-100 text-blue-700",
  vendor: "bg-purple-100 text-purple-700",
  driver: "bg-orange-100 text-orange-700",
  staff: "bg-gray-100 text-gray-700",
  supervisor: "bg-yellow-100 text-yellow-800",
  company_admin: "bg-green-100 text-green-700",
  owner: "bg-red-100 text-red-700",
  super_admin: "bg-red-200 text-red-900",
  ok: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
  unauthorized: "bg-yellow-100 text-yellow-800",
};

// ── Sprint 10A-5: Daily Briefing Widget ───────────────────────────────────────

interface BriefingSettings {
  enabled: boolean;
  time: string;
  recipients: string[];
}

interface BriefingLog {
  id: number;
  recipient_phone: string;
  recipient_role: string | null;
  status: string;
  message_preview: string | null;
  sent_at: string | null;
  error_message: string | null;
  delivery_provider: string;
  created_at: string;
}

interface BriefingSettingsResponse {
  settings: BriefingSettings;
  nextRun: string;
  recentLogs: BriefingLog[];
}

interface BriefingPreview {
  message: string;
  generatedAt: string;
}

function DailyBriefingWidget() {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editEnabled, setEditEnabled] = useState<boolean | null>(null);
  const [editTime, setEditTime] = useState<string | null>(null);

  const q = useQuery<BriefingSettingsResponse>({
    queryKey: ["briefing-settings"],
    queryFn: () => apiFetch("/api/executive/briefing/settings"),
    refetchInterval: 60_000,
  });

  const settings = q.data?.settings;
  const nextRun = q.data?.nextRun;
  const recentLogs = q.data?.recentLogs ?? [];

  const currentEnabled = editEnabled ?? settings?.enabled ?? false;
  const currentTime = editTime ?? settings?.time ?? "07:00";

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch("/api/executive/briefing/settings", {
        method: "PUT",
        body: JSON.stringify({
          enabled: currentEnabled,
          time: currentTime,
          recipients: settings?.recipients ?? ["owner", "super_admin", "company_admin"],
        }),
      });
      setEditEnabled(null);
      setEditTime(null);
      await qc.invalidateQueries({ queryKey: ["briefing-settings"] });
      setSendResult("✅ Pengaturan disimpan");
    } catch {
      setSendResult("❌ Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTest() {
    setSending(true);
    setSendResult(null);
    try {
      const r = await apiFetch("/api/executive/briefing/send", {
        method: "POST",
        body: JSON.stringify({ force: true }),
      });
      if (r.sent > 0) {
        setSendResult(`✅ Briefing terkirim ke ${r.sent} penerima`);
      } else if (r.skipped > 0) {
        setSendResult(`⚠️ Dilewati (${r.skipped}): tidak ada penerima dengan HP atau WA tidak aktif`);
      } else {
        setSendResult(`❌ Gagal: ${r.failed} error`);
      }
      await qc.invalidateQueries({ queryKey: ["briefing-settings"] });
    } catch {
      setSendResult("❌ Gagal mengirim briefing");
    } finally {
      setSending(false);
    }
  }

  async function handlePreview() {
    setLoadingPreview(true);
    setShowPreview(true);
    try {
      const r = await apiFetch("/api/executive/briefing/preview") as BriefingPreview;
      setPreview(r.message);
    } catch {
      setPreview("❌ Gagal memuat preview");
    } finally {
      setLoadingPreview(false);
    }
  }

  const lastSent = recentLogs.find((l) => l.status === "sent");
  const isDirty = editEnabled !== null || editTime !== null;

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4 text-blue-500" />
          Briefing Harian Otomatis
          <span className={`ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full ${
            currentEnabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}>
            {currentEnabled ? "Aktif" : "Nonaktif"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Settings row */}
        <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/40 rounded-lg">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditEnabled(!currentEnabled)}
              className="flex items-center gap-1 text-sm font-medium"
            >
              {currentEnabled
                ? <ToggleRight className="h-5 w-5 text-green-600" />
                : <ToggleLeft className="h-5 w-5 text-gray-400" />}
              {currentEnabled ? "Aktif" : "Nonaktif"}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Jam:</span>
            <input
              type="time"
              value={currentTime}
              onChange={(e) => setEditTime(e.target.value)}
              className="h-7 text-xs border rounded px-2 bg-background"
            />
            <span className="text-xs text-muted-foreground">WIB</span>
          </div>
          {isDirty && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs">
              {saving ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : null}
              Simpan
            </Button>
          )}
        </div>

        {/* Info row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground mb-0.5">Jadwal berikutnya</div>
            <div className="font-medium">
              {nextRun
                ? new Date(nextRun).toLocaleString("id-ID", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " WIB"
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Terakhir dikirim</div>
            <div className="font-medium">
              {lastSent?.sent_at
                ? new Date(lastSent.sent_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                : "Belum pernah"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Penerima (role)</div>
            <div className="font-medium truncate">
              {settings?.recipients?.join(", ") ?? "owner, super_admin, company_admin"}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handlePreview} disabled={loadingPreview} className="h-8 text-xs">
            {loadingPreview ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
            Preview Pesan
          </Button>
          <Button size="sm" onClick={handleSendTest} disabled={sending} className="h-8 text-xs">
            {sending ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
            Kirim Test Sekarang
          </Button>
        </div>

        {sendResult && (
          <div className={`text-xs px-3 py-2 rounded ${sendResult.startsWith("✅") ? "bg-green-50 text-green-700" : sendResult.startsWith("⚠️") ? "bg-yellow-50 text-yellow-700" : "bg-red-50 text-red-700"}`}>
            {sendResult}
          </div>
        )}

        {/* Preview dialog */}
        {showPreview && (
          <div className="border rounded-lg p-3 bg-gray-50 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600">📱 Preview Pesan WA</span>
              <button onClick={() => setShowPreview(false)} className="text-xs text-muted-foreground hover:text-foreground">✕ Tutup</button>
            </div>
            {loadingPreview
              ? <div className="text-xs text-muted-foreground animate-pulse">Memuat...</div>
              : <pre className="text-[11px] whitespace-pre-wrap font-sans text-gray-800 max-h-64 overflow-y-auto">{preview}</pre>}
          </div>
        )}

        {/* Recent logs */}
        {recentLogs.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Log Pengiriman Terbaru</div>
            <div className="space-y-1">
              {recentLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="flex items-center gap-2 text-[11px]">
                  <span className={`w-14 text-center font-medium px-1 py-0.5 rounded text-[10px] ${
                    log.status === "sent" ? "bg-green-100 text-green-700"
                    : log.status === "failed" ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-600"
                  }`}>
                    {log.status.toUpperCase()}
                  </span>
                  <span className="text-muted-foreground">{log.recipient_phone.slice(-4).padStart(8, "•")}</span>
                  <span className="text-muted-foreground">{log.recipient_role ?? "manual"}</span>
                  <span className="ml-auto text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WaAdoptionWidget() {
  const [testPhone, setTestPhone] = useState("");
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<{ handled: boolean } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const metricsQ = useQuery<WaMetrics>({
    queryKey: ["wa-metrics"],
    queryFn: () => apiFetch("/api/wa-commands/metrics?days=7"),
    refetchInterval: 30_000,
  });

  const logsQ = useQuery<{ logs: WaCmdLog[] }>({
    queryKey: ["wa-cmd-logs"],
    queryFn: () => apiFetch("/api/wa-commands/logs?limit=20&days=7"),
    refetchInterval: 15_000,
  });

  const metrics = metricsQ.data;
  const logs = logsQ.data?.logs ?? [];

  async function runTest() {
    if (!testPhone || !testText) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const r = await apiFetch("/api/wa-commands/test", {
        method: "POST",
        body: JSON.stringify({ phone: testPhone, text: testText }),
      });
      setTestResult(r);
    } catch {
      setTestResult({ handled: false });
    } finally {
      setTestLoading(false);
      metricsQ.refetch();
      logsQ.refetch();
    }
  }

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="h-5 w-5 text-green-600" />
        <h2 className="text-xl font-bold">WhatsApp First Operations</h2>
        <Badge variant="outline" className="ml-2 text-xs">Sprint 10A-1</Badge>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Total Eksekusi (7 hari)</p>
            <p className="text-2xl font-bold">{metrics?.totalExecs ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Pengguna Unik</p>
            <p className="text-2xl font-bold">{metrics?.uniqueUsersLast7d ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Perintah Tersedia</p>
            <p className="text-2xl font-bold">{metrics?.byCommand?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Role Aktif</p>
            <p className="text-2xl font-bold">{metrics?.byRole?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top commands */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Perintah Terpopuler</CardTitle>
          </CardHeader>
          <CardContent>
            {(!metrics || metrics.byCommand.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-6">Belum ada data perintah</p>
            ) : (
              <div className="space-y-2">
                {metrics.byCommand.slice(0, 8).map((cmd) => (
                  <div key={cmd.command} className="flex items-center gap-2">
                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded w-32 shrink-0">
                      {cmd.command}
                    </code>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${Math.min((cmd.execCount / (metrics.byCommand[0]?.execCount || 1)) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">{cmd.execCount}</span>
                    <span className="text-xs text-green-600 w-12 text-right">{cmd.successRate}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent logs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Log Eksekusi Terbaru</CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Belum ada log</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 text-xs py-1 border-b last:border-0">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${ROLE_COLOR[log.result] ?? "bg-gray-100"}`}>
                      {log.result.toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono font-semibold">{log.command}</code>
                        {log.args && <span className="text-muted-foreground truncate">{log.args}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className={`px-1 py-px rounded ${ROLE_COLOR[log.role] ?? "bg-gray-100"}`}>
                          {ROLE_LABEL[log.role] ?? log.role}
                        </span>
                        <span>{log.phone.slice(-4).padStart(log.phone.length, "•")}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(log.executedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Data Health Widget — Sprint 10A-1.1 */}
      <DataHealthWidget />

      {/* Daily Briefing Widget — Sprint 10A-5 */}
      <DailyBriefingWidget />

      {/* Test console */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Play className="h-4 w-4" />
            Uji Perintah WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Nomor HP (contoh: 628123456789)"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-full sm:w-64"
            />
            <input
              type="text"
              placeholder="Teks perintah (contoh: MENU)"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runTest(); }}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex-1"
            />
            <Button
              size="sm"
              onClick={runTest}
              disabled={testLoading || !testPhone || !testText}
              className="shrink-0"
            >
              {testLoading ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              Kirim
            </Button>
          </div>
          {testResult !== null && (
            <div className={`mt-2 px-3 py-2 rounded text-sm ${testResult.handled ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
              {testResult.handled
                ? "✅ Perintah berhasil diproses — balasan sudah dikirim via WhatsApp."
                : "⚠️ Perintah tidak dikenali — akan diproses melalui jalur AI normal."}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["MENU", "STATUS CST-001", "APPROVAL", "DASHBOARD", "BBM B1234XYZ 40 125000", "RUSAK B1234XYZ Rem bunyi", "DAFTAR VENDOR"].map((ex) => (
              <button
                key={ex}
                onClick={() => setTestText(ex)}
                className="text-[11px] font-mono bg-muted hover:bg-muted/80 px-2 py-0.5 rounded border transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
