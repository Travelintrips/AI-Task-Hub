import { useQuery } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  Users,
  TrendingUp,
  ShoppingCart,
  DollarSign,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  BarChart3,
  Shield,
  Target,
  Zap,
} from "lucide-react";

// ── API fetch ─────────────────────────────────────────────────────────────────

async function fetchExecIntel() {
  const token = getStoredToken();
  const res = await fetch("/api/executive/intelligence", {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error("Failed to load executive intelligence");
  return res.json() as Promise<ExecutiveIntelligenceData>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExecutiveIntelligenceData {
  generatedAt: string;
  readinessScore: number;
  dataQualityScore: number;
  goNoGo: "GO" | "NO-GO" | "CONDITIONAL";
  goConditions: string[];
  datasets: Record<string, number>;
  customerIntelligence: {
    memoryCoveragePct: number;
    staleMemoryPct: number;
    snapshotFreshnessHours: number | null;
    totalCustomers: number;
    customersWithMemory: number;
  };
  vendorIntelligence: {
    vendorReadinessPct: number;
    documentCompliancePct: number;
    riskDistribution: { low: number; medium: number; high: number; critical: number };
    totalVendors: number;
  };
  recommendationQuality: {
    acceptancePct: number;
    winPct: number;
    overridePct: number;
    vendorsWithRecData: number;
    highConfidenceAccuracyPct: number;
    totalEvaluated: number;
    overrideCount: number;
    blockedCount: number;
  };
  purchasingIntelligence: {
    totalRequests: number;
    duplicatePreventionCount: number;
    benchmarkDeviationAlerts: number;
    marginProtectionAlerts: number;
    approvalEscalationCount: number;
  };
  executiveRoi: {
    estimatedSavingsIdr: number;
    preventedDuplicatePurchases: number;
    preventedLowMarginPurchases: number;
    vendorOptimizationOpportunities: number;
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreRing({ score, label, size = "lg" }: { score: number; label: string; size?: "sm" | "lg" }) {
  const color =
    score >= 80 ? "text-emerald-600" :
    score >= 60 ? "text-blue-600" :
    score >= 40 ? "text-amber-600" : "text-red-600";
  const ringColor =
    score >= 80 ? "stroke-emerald-500" :
    score >= 60 ? "stroke-blue-500" :
    score >= 40 ? "stroke-amber-500" : "stroke-red-500";

  const r = size === "lg" ? 40 : 28;
  const cx = size === "lg" ? 52 : 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={cx * 2} height={cx * 2} className="-rotate-90" viewBox={`0 0 ${cx * 2} ${cx * 2}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
        <circle cx={cx} cy={cx} r={r} fill="none" strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" className={ringColor} />
        <text x={cx} y={cx} textAnchor="middle" dominantBaseline="middle"
          className={`fill-current ${color} font-bold`}
          fontSize={size === "lg" ? "22" : "16"}
          transform={`rotate(90, ${cx}, ${cx})`}>
          {score}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

function MetricRow({ label, value, suffix = "%", color }: {
  label: string; value: number; suffix?: string; color?: string;
}) {
  const c = color ?? (value >= 70 ? "text-emerald-600" : value >= 40 ? "text-amber-600" : "text-red-600");
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${c}`}>{value.toLocaleString("id-ID")}{suffix}</span>
    </div>
  );
}

function GoNogo({ verdict, conditions }: { verdict: "GO" | "NO-GO" | "CONDITIONAL"; conditions: string[] }) {
  const cfg = {
    "GO":          { bg: "bg-emerald-50 border-emerald-200", icon: CheckCircle2, ic: "text-emerald-600", badge: "bg-emerald-100 text-emerald-800", label: "GO — Ready for Fleet Intelligence" },
    "CONDITIONAL": { bg: "bg-amber-50 border-amber-200",    icon: AlertTriangle, ic: "text-amber-600",   badge: "bg-amber-100 text-amber-800",   label: "CONDITIONAL — Address blockers first" },
    "NO-GO":       { bg: "bg-red-50 border-red-200",        icon: XCircle,       ic: "text-red-600",     badge: "bg-red-100 text-red-800",       label: "NO-GO — Intelligence layer not ready" },
  }[verdict];
  const Icon = cfg.icon;

  return (
    <div className={`h-full rounded-xl border-2 p-5 ${cfg.bg}`}>
      <div className="flex items-start gap-3 mb-3">
        <Icon className={`h-8 w-8 shrink-0 ${cfg.ic}`} />
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">Fleet Intelligence GO/NO-GO</div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${cfg.badge}`}>{verdict}</span>
          <p className="text-sm text-muted-foreground mt-1">{cfg.label}</p>
        </div>
      </div>
      {conditions.length > 0 && (
        <ul className="space-y-1.5 mt-3 border-t pt-3">
          {conditions.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DatasetBar({ name, score }: { name: string; score: number }) {
  const color =
    score >= 80 ? "bg-emerald-500" :
    score >= 60 ? "bg-blue-500" :
    score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-24 shrink-0 capitalize">{name}</span>
      <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold w-8 text-right">{score}</span>
    </div>
  );
}

function formatIdr(val: number): string {
  if (val >= 1_000_000_000) return `Rp ${(val / 1_000_000_000).toFixed(1)}M`;
  if (val >= 1_000_000)     return `Rp ${(val / 1_000_000).toFixed(1)}Jt`;
  return `Rp ${val.toLocaleString("id-ID")}`;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExecutiveIntelligencePage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<ExecutiveIntelligenceData>({
    queryKey: ["/api/executive/intelligence"],
    queryFn: fetchExecIntel,
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-8 w-8 animate-spin" />
          <p className="text-sm">Memuat Executive Intelligence…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <XCircle className="h-10 w-10 text-destructive mx-auto" />
          <p className="font-semibold">Gagal memuat data</p>
          <button onClick={() => refetch()} className="text-sm text-primary underline">Coba lagi</button>
        </div>
      </div>
    );
  }

  const { customerIntelligence: ci, vendorIntelligence: vi,
    recommendationQuality: rq, purchasingIntelligence: pi,
    executiveRoi: roi, datasets } = data;

  const totalRisk = vi.riskDistribution.low + vi.riskDistribution.medium +
    vi.riskDistribution.high + vi.riskDistribution.critical;

  return (
    <div className="flex-1 overflow-auto bg-muted/30">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Executive Intelligence Dashboard</h1>
              <p className="text-xs text-muted-foreground">Sprint 6D — Intelligence Validation & Fleet Intelligence GO/NO-GO</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{new Date(data.generatedAt).toLocaleString("id-ID")}</span>
            <button onClick={() => refetch()} disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50">
              <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5 max-w-7xl mx-auto">

        {/* Scores + GO/NO-GO */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Intelligence Scores
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-around pt-2">
                <ScoreRing score={data.readinessScore} label="Readiness" />
                <ScoreRing score={data.dataQualityScore} label="Data Quality" />
              </div>
              <Separator className="my-4" />
              <div className="space-y-2">
                {Object.entries(datasets).map(([name, score]) => (
                  <DatasetBar key={name} name={name} score={score} />
                ))}
                {Object.keys(datasets).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Jalankan intel refresh untuk melihat dataset scores
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="col-span-1 lg:col-span-2">
            <GoNogo verdict={data.goNoGo} conditions={data.goConditions} />
          </div>
        </div>

        {/* A. Customer Intelligence */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" /> A. Customer Intelligence
            </CardTitle>
            <CardDescription className="text-xs">
              Memory coverage, staleness, and snapshot freshness across {ci.totalCustomers.toLocaleString("id-ID")} customers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-6 mb-4">
              {[
                { score: ci.memoryCoveragePct, label: "Memory Coverage", sub: `${ci.customersWithMemory}/${ci.totalCustomers} customers` },
                { score: 100 - ci.staleMemoryPct, label: "Memory Freshness", sub: `${ci.staleMemoryPct}% stale` },
              ].map(({ score, label, sub }) => (
                <div key={label} className="flex flex-col items-center gap-2 p-4 rounded-lg bg-muted/50">
                  <ScoreRing score={score} label={label} size="sm" />
                  <p className="text-xs text-center text-muted-foreground">{sub}</p>
                </div>
              ))}
              <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-muted/50">
                <div className="h-16 flex items-center justify-center">
                  <span className={`text-3xl font-bold ${ci.snapshotFreshnessHours != null && ci.snapshotFreshnessHours < 48 ? "text-emerald-600" : "text-amber-600"}`}>
                    {ci.snapshotFreshnessHours != null ? `${ci.snapshotFreshnessHours}h` : "—"}
                  </span>
                </div>
                <p className="text-xs text-center text-muted-foreground">Avg Snapshot Age</p>
              </div>
            </div>
            <Separator className="mb-3" />
            <MetricRow label="Memory coverage" value={ci.memoryCoveragePct} />
            <MetricRow label="Stale memory" value={ci.staleMemoryPct}
              color={ci.staleMemoryPct > 30 ? "text-red-600" : ci.staleMemoryPct > 15 ? "text-amber-600" : "text-emerald-600"} />
          </CardContent>
        </Card>

        {/* B. Vendor Intelligence */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600" /> B. Vendor Intelligence
            </CardTitle>
            <CardDescription className="text-xs">
              Readiness, compliance, and risk across {vi.totalVendors} active vendors
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex justify-around p-4 rounded-lg bg-muted/50">
                  <ScoreRing score={vi.vendorReadinessPct} label="Vendor Readiness" size="sm" />
                  <ScoreRing score={vi.documentCompliancePct} label="Doc Compliance" size="sm" />
                </div>
                <MetricRow label="Vendor readiness ≥60" value={vi.vendorReadinessPct} />
                <MetricRow label="Document compliance ≥80%" value={vi.documentCompliancePct} />
                <MetricRow label="Total active vendors" value={vi.totalVendors} suffix="" color="text-foreground" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-3">Risk Distribution</p>
                <div className="space-y-2.5">
                  {([
                    { label: "Low Risk",      color: "bg-emerald-500", count: vi.riskDistribution.low },
                    { label: "Medium Risk",   color: "bg-amber-500",   count: vi.riskDistribution.medium },
                    { label: "High Risk",     color: "bg-orange-500",  count: vi.riskDistribution.high },
                    { label: "Critical Risk", color: "bg-red-600",     count: vi.riskDistribution.critical },
                  ] as const).map(({ label, color, count }) => (
                    <div key={label} className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${color} shrink-0`} />
                      <span className="text-xs text-muted-foreground flex-1">{label}</span>
                      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`}
                          style={{ width: `${totalRisk ? (count / totalRisk) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs font-semibold w-6 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* C. Recommendation Quality */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-cyan-600" /> C. Recommendation Quality
            </CardTitle>
            <CardDescription className="text-xs">
              AI recommendation acceptance, override rates, and confidence accuracy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {([
                { label: "Acceptance %",        value: rq.acceptancePct,            suffix: "%" },
                { label: "Win Rate %",           value: rq.winPct,                   suffix: "%" },
                { label: "Override %",           value: rq.overridePct,              suffix: "%",
                  color: rq.overridePct > 30 ? "text-red-600" : rq.overridePct > 15 ? "text-amber-600" : "text-emerald-600" },
                { label: "High-Conf Accuracy",   value: rq.highConfidenceAccuracyPct, suffix: "%" },
              ] as const).map(({ label, value, suffix, ...rest }) => {
                const color = "color" in rest ? rest.color
                  : value >= 60 ? "text-emerald-600" : value >= 40 ? "text-amber-600" : "text-red-600";
                return (
                  <div key={label} className="text-center p-3 rounded-lg bg-muted/50">
                    <p className={`text-2xl font-bold ${color}`}>{value}{suffix}</p>
                    <p className="text-xs text-muted-foreground mt-1">{label}</p>
                  </div>
                );
              })}
            </div>
            <Separator className="my-3" />
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-lg font-bold">{rq.totalEvaluated}</p>
                <p className="text-xs text-muted-foreground">Total Evaluated</p>
              </div>
              <div>
                <p className="text-lg font-bold text-amber-600">{rq.overrideCount}</p>
                <p className="text-xs text-muted-foreground">Overridden (High Risk → Approved)</p>
              </div>
              <div>
                <p className="text-lg font-bold text-emerald-600">{rq.blockedCount}</p>
                <p className="text-xs text-muted-foreground">Blocked by AI</p>
              </div>
            </div>
            {rq.vendorsWithRecData === 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                Belum ada data outcome rekomendasi — jalankan minimal satu siklus CMM untuk mulai mengisi metrik ini.
              </div>
            )}
          </CardContent>
        </Card>

        {/* D. Purchasing Intelligence */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-orange-600" /> D. Purchasing Intelligence
            </CardTitle>
            <CardDescription className="text-xs">
              Duplicate prevention, price alerts, margin protection across {pi.totalRequests} purchase requests
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {([
                { label: "Duplicate Prevention", value: pi.duplicatePreventionCount,  icon: Shield,        color: "text-emerald-600", bg: "bg-emerald-50" },
                { label: "Benchmark Alerts",     value: pi.benchmarkDeviationAlerts,  icon: AlertTriangle, color: "text-amber-600",   bg: "bg-amber-50"   },
                { label: "Margin Alerts",        value: pi.marginProtectionAlerts,    icon: AlertCircle,   color: "text-red-600",     bg: "bg-red-50"     },
                { label: "Escalations",          value: pi.approvalEscalationCount,   icon: Zap,           color: "text-violet-600",  bg: "bg-violet-50"  },
              ] as const).map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className={`text-center p-4 rounded-lg border ${bg}`}>
                  <Icon className={`h-5 w-5 mx-auto mb-2 ${color}`} />
                  <p className={`text-3xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* E. Executive ROI */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-600" /> E. Executive ROI
            </CardTitle>
            <CardDescription className="text-xs">Measurable value delivered by the AI intelligence layer</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
                <p className="text-xs text-emerald-700 font-medium mb-1">Estimated Savings</p>
                <p className="text-xl font-bold text-emerald-700">{formatIdr(roi.estimatedSavingsIdr)}</p>
                <p className="text-xs text-muted-foreground mt-1">from below-market approvals</p>
              </div>
              <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-center">
                <p className="text-xs text-blue-700 font-medium mb-1">Prevented Duplicates</p>
                <p className="text-3xl font-bold text-blue-700">{roi.preventedDuplicatePurchases}</p>
                <p className="text-xs text-muted-foreground mt-1">rejected duplicate requests</p>
              </div>
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-center">
                <p className="text-xs text-red-700 font-medium mb-1">Low-Margin Blocked</p>
                <p className="text-3xl font-bold text-red-700">{roi.preventedLowMarginPurchases}</p>
                <p className="text-xs text-muted-foreground mt-1">negative-margin purchases stopped</p>
              </div>
              <div className="p-4 rounded-lg bg-violet-50 border border-violet-200 text-center">
                <p className="text-xs text-violet-700 font-medium mb-1">Vendor Opportunities</p>
                <p className="text-3xl font-bold text-violet-700">{roi.vendorOptimizationOpportunities}</p>
                <p className="text-xs text-muted-foreground mt-1">vendors needing optimization</p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
