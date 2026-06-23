import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Building2,
  Users,
  Truck,
  ShoppingCart,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Shield,
  Zap,
  Brain,
  MessageSquare,
  BarChart2,
  Activity,
  AlertCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Globe,
  Star,
} from "lucide-react";
import { useLocation } from "wouter";

// ── API helper ────────────────────────────────────────────────────────────────

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

interface CompanyAggregates {
  tasks: number;
  activeTasks: number;
  customers: number;
  vendors: number;
  fleetUnits: number;
  drivers: number;
  purchasingRequests: number;
  pendingApprovals: number;
  onboardingSessions: number;
  waMessages: number;
}

interface CompanyRow {
  companyId: string;
  companyName: string;
  industryType: string | null;
  aiEnabled: boolean;
  createdAt: string | null;
  aggregates: CompanyAggregates;
}

interface CompaniesData {
  generatedAt: string;
  companies: CompanyRow[];
  totals: CompanyAggregates;
}

interface HealthScore {
  companyId: string;
  companyName: string;
  overallScore: number;
  grade: string;
  breakdown: {
    onboardingReadiness: number;
    dataQuality: number;
    fleetReadiness: number;
    purchasingReadiness: number;
    memoryCoverage: number;
  };
}

interface HealthData {
  groupHealthScore: number;
  groupGrade: string;
  companies: HealthScore[];
}

interface AlertItem {
  severity: "critical" | "warning" | "info";
  source: string;
  companyId: string;
  companyName: string;
  message: string;
  count: number;
}

interface AlertsData {
  summary: { critical: number; warning: number; info: number; total: number };
  alerts: { critical: AlertItem[]; warning: AlertItem[]; info: AlertItem[] };
}

interface ExecutiveViewData {
  topByActiveTasks: Array<{ companyId: string; companyName: string; activeTasks: number; riskScore: number }>;
  highestRisk: Array<{ companyId: string; companyName: string; riskScore: number; highRiskFleet: number; highRiskCustomers: number }>;
  mostActive7d: Array<{ companyId: string; companyName: string; waMessages7d: number }>;
  leastActive7d: Array<{ companyId: string; companyName: string; waMessages7d: number }>;
}

interface BriefingData {
  generatedAt: string;
  companyCount: number;
  briefing: string;
  snapshot: Array<{ company_name: string; tasks: number; fleetOk: number; fleetIssue: number; pendingPR: number }>;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-foreground",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Icon className={`h-4 w-4 ${color}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground leading-none">{label}</p>
            <p className={`text-xl font-bold leading-tight mt-0.5 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  const colorMap: Record<string, string> = {
    A: "bg-green-100 text-green-700",
    B: "bg-blue-100 text-blue-700",
    C: "bg-yellow-100 text-yellow-700",
    D: "bg-orange-100 text-orange-700",
    F: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-sm font-bold ${colorMap[grade] ?? "bg-muted text-muted-foreground"}`}
    >
      {grade}
    </span>
  );
}

function AlertBadge({ severity }: { severity: string }) {
  if (severity === "critical")
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100"><XCircle className="h-3 w-3 mr-1" />Kritis</Badge>;
  if (severity === "warning")
    return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100"><AlertTriangle className="h-3 w-3 mr-1" />Peringatan</Badge>;
  return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100"><Info className="h-3 w-3 mr-1" />Info</Badge>;
}

function formatBriefing(text: string) {
  return text.split("\n").map((line, i) => {
    const bold = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const isBullet = line.trim().startsWith("-") || line.trim().startsWith("•");
    return (
      <p
        key={i}
        className={`text-sm ${isBullet ? "ml-4 text-muted-foreground" : "font-medium"} leading-relaxed`}
        dangerouslySetInnerHTML={{ __html: bold }}
      />
    );
  });
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HoldingDashboardPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [expandedAlerts, setExpandedAlerts] = useState<Record<string, boolean>>({
    critical: true,
    warning: false,
    info: false,
  });
  const [activeTab, setActiveTab] = useState<"overview" | "health" | "comparison" | "alerts" | "briefing">("overview");

  if (user?.role !== "super_admin") {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="font-semibold">Akses Ditolak</p>
          <p className="text-sm text-muted-foreground">Halaman ini hanya untuk super_admin.</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/")}>Kembali ke Dashboard</Button>
        </div>
      </div>
    );
  }

  const { data: companiesData, isLoading: loadingCompanies, refetch: refetchCompanies } = useQuery<CompaniesData>({
    queryKey: ["holding-companies"],
    queryFn: () => apiFetch("/api/holding/companies"),
    staleTime: 60_000,
  });

  const { data: healthData, isLoading: loadingHealth } = useQuery<HealthData>({
    queryKey: ["holding-health"],
    queryFn: () => apiFetch("/api/holding/health-scores"),
    staleTime: 60_000,
    enabled: activeTab === "health" || activeTab === "overview",
  });

  const { data: alertsData, isLoading: loadingAlerts } = useQuery<AlertsData>({
    queryKey: ["holding-alerts"],
    queryFn: () => apiFetch("/api/holding/alerts"),
    staleTime: 60_000,
    enabled: activeTab === "alerts" || activeTab === "overview",
  });

  const { data: execView, isLoading: loadingExec } = useQuery<ExecutiveViewData>({
    queryKey: ["holding-exec-view"],
    queryFn: () => apiFetch("/api/holding/executive-view"),
    staleTime: 60_000,
    enabled: activeTab === "overview",
  });

  const briefingMutation = useMutation<BriefingData>({
    mutationFn: () => apiFetch("/api/holding/briefing", { method: "POST" }),
  });

  const isLoading = loadingCompanies || loadingHealth || loadingAlerts || loadingExec;

  const tabs = [
    { id: "overview", label: "Ikhtisar", icon: Globe },
    { id: "health", label: "Health Score", icon: Activity },
    { id: "comparison", label: "Perbandingan", icon: BarChart2 },
    { id: "alerts", label: "Alerts", icon: AlertTriangle },
    { id: "briefing", label: "AI Briefing", icon: Brain },
  ] as const;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Globe className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Holding Dashboard</h1>
            <Badge variant="outline" className="text-xs">super_admin</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Visibilitas konsolidasi seluruh perusahaan dalam grup
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchCompanies()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Alert summary banner */}
      {alertsData && alertsData.summary.critical > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          <p className="text-sm text-red-700 font-medium">
            {alertsData.summary.critical} alert kritis membutuhkan perhatian segera di seluruh grup
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-red-600 hover:text-red-700 hover:bg-red-100 h-7"
            onClick={() => setActiveTab("alerts")}
          >
            Lihat →
          </Button>
        </div>
      )}

      {/* Group KPI cards */}
      {companiesData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard icon={Building2} label="Perusahaan" value={companiesData.companies.length} />
          <StatCard icon={Zap} label="Tugas Aktif" value={companiesData.totals.activeTasks} color="text-orange-600" />
          <StatCard icon={Users} label="Pelanggan" value={companiesData.totals.customers} />
          <StatCard icon={Truck} label="Armada" value={companiesData.totals.fleetUnits} />
          <StatCard
            icon={ShoppingCart}
            label="PR Menunggu"
            value={companiesData.totals.pendingApprovals}
            color={companiesData.totals.pendingApprovals > 0 ? "text-red-600" : "text-green-600"}
          />
        </div>
      )}

      {/* Group health score banner */}
      {healthData && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-4">
              <div className="text-center shrink-0">
                <p className="text-xs text-muted-foreground">Health Score Grup</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-3xl font-bold text-primary">{healthData.groupHealthScore}</span>
                  <GradeBadge grade={healthData.groupGrade} />
                </div>
              </div>
              <div className="flex-1">
                <Progress value={healthData.groupHealthScore} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  Rata-rata dari {healthData.companies.length} perusahaan
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.id === "alerts" && alertsData && alertsData.summary.critical > 0 && (
              <span className="h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                {alertsData.summary.critical}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: OVERVIEW ─────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="space-y-5">
          {/* Per-company table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Agregasi Per Perusahaan</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCompanies ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Memuat data perusahaan...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left py-2 pr-3 font-medium">Perusahaan</th>
                        <th className="text-right py-2 px-2 font-medium">Tugas Aktif</th>
                        <th className="text-right py-2 px-2 font-medium">Pelanggan</th>
                        <th className="text-right py-2 px-2 font-medium">Vendor</th>
                        <th className="text-right py-2 px-2 font-medium">Armada</th>
                        <th className="text-right py-2 px-2 font-medium">Driver</th>
                        <th className="text-right py-2 px-2 font-medium">PR Pending</th>
                        <th className="text-right py-2 pl-2 font-medium">AI On</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {companiesData?.companies.map((c) => (
                        <tr key={c.companyId} className="hover:bg-muted/30">
                          <td className="py-2 pr-3">
                            <div>
                              <p className="font-medium">{c.companyName}</p>
                              <p className="text-xs text-muted-foreground">{c.companyId}</p>
                            </div>
                          </td>
                          <td className="text-right py-2 px-2">
                            <span className={c.aggregates.activeTasks > 0 ? "text-orange-600 font-medium" : ""}>
                              {c.aggregates.activeTasks}
                            </span>
                          </td>
                          <td className="text-right py-2 px-2">{c.aggregates.customers}</td>
                          <td className="text-right py-2 px-2">{c.aggregates.vendors}</td>
                          <td className="text-right py-2 px-2">{c.aggregates.fleetUnits}</td>
                          <td className="text-right py-2 px-2">{c.aggregates.drivers}</td>
                          <td className="text-right py-2 px-2">
                            {c.aggregates.pendingApprovals > 0 ? (
                              <span className="text-red-600 font-medium">{c.aggregates.pendingApprovals}</span>
                            ) : (
                              <span className="text-green-600">0</span>
                            )}
                          </td>
                          <td className="text-right py-2 pl-2">
                            {c.aiEnabled ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 ml-auto" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      {companiesData && (
                        <tr className="bg-muted/30 font-semibold">
                          <td className="py-2 pr-3 text-xs uppercase tracking-wide text-muted-foreground">Total Grup</td>
                          <td className="text-right py-2 px-2">{companiesData.totals.activeTasks}</td>
                          <td className="text-right py-2 px-2">{companiesData.totals.customers}</td>
                          <td className="text-right py-2 px-2">{companiesData.totals.vendors}</td>
                          <td className="text-right py-2 px-2">{companiesData.totals.fleetUnits}</td>
                          <td className="text-right py-2 px-2">{companiesData.totals.drivers}</td>
                          <td className="text-right py-2 px-2">{companiesData.totals.pendingApprovals}</td>
                          <td className="text-right py-2 pl-2">—</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Executive view: top & high risk */}
          {execView && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                    Paling Aktif (Tugas)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {execView.topByActiveTasks.slice(0, 5).map((c, i) => (
                    <div key={c.companyId} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.companyName}</p>
                        <Progress value={Math.min(100, (c.activeTasks / Math.max(1, execView.topByActiveTasks[0]?.activeTasks ?? 1)) * 100)} className="h-1 mt-0.5" />
                      </div>
                      <span className="text-sm font-bold text-orange-600 shrink-0">{c.activeTasks}</span>
                    </div>
                  ))}
                  {execView.topByActiveTasks.length === 0 && (
                    <p className="text-xs text-muted-foreground">Tidak ada data</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    Risiko Tertinggi
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {execView.highestRisk.slice(0, 5).map((c, i) => (
                    <div key={c.companyId} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.companyName}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.highRiskFleet} armada bermasalah · {c.highRiskCustomers} pelanggan risiko
                        </p>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${c.riskScore > 5 ? "text-red-600" : c.riskScore > 2 ? "text-orange-600" : "text-green-600"}`}>
                        {c.riskScore}
                      </span>
                    </div>
                  ))}
                  {execView.highestRisk.length === 0 && (
                    <p className="text-xs text-muted-foreground">Tidak ada data</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-green-600" />
                    Paling Aktif WA (7 hari)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {execView.mostActive7d.slice(0, 5).map((c, i) => (
                    <div key={c.companyId} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                      <p className="text-sm font-medium flex-1 truncate">{c.companyName}</p>
                      <span className="text-sm font-bold text-green-600 shrink-0">{c.waMessages7d} msg</span>
                    </div>
                  ))}
                  {execView.mostActive7d.length === 0 && (
                    <p className="text-xs text-muted-foreground">Tidak ada data</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-muted-foreground" />
                    Paling Tidak Aktif WA (7 hari)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {execView.leastActive7d.slice(0, 5).map((c, i) => (
                    <div key={c.companyId} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                      <p className="text-sm font-medium flex-1 truncate">{c.companyName}</p>
                      <span className="text-sm font-bold text-muted-foreground shrink-0">{c.waMessages7d} msg</span>
                    </div>
                  ))}
                  {execView.leastActive7d.length === 0 && (
                    <p className="text-xs text-muted-foreground">Tidak ada data</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: HEALTH SCORE ─────────────────────────────────────── */}
      {activeTab === "health" && (
        <div className="space-y-4">
          {loadingHealth ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Menghitung health score...</div>
          ) : (
            healthData?.companies.map((c) => (
              <Card key={c.companyId}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-4">
                    <div className="text-center shrink-0 w-16">
                      <GradeBadge grade={c.grade} />
                      <p className="text-lg font-bold mt-1">{c.overallScore}</p>
                      <p className="text-xs text-muted-foreground leading-none">/ 100</p>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div>
                        <p className="font-medium text-sm">{c.companyName}</p>
                        <p className="text-xs text-muted-foreground">{c.companyId}</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                        {[
                          { label: "Onboarding", val: c.breakdown.onboardingReadiness },
                          { label: "Data Quality", val: c.breakdown.dataQuality },
                          { label: "Fleet", val: c.breakdown.fleetReadiness },
                          { label: "Purchasing", val: c.breakdown.purchasingReadiness },
                          { label: "Memory", val: c.breakdown.memoryCoverage },
                        ].map((b) => (
                          <div key={b.label}>
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-muted-foreground">{b.label}</span>
                              <span className="font-medium">{b.val}%</span>
                            </div>
                            <Progress
                              value={b.val}
                              className={`h-1.5 ${b.val < 40 ? "[&>div]:bg-red-500" : b.val < 70 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500"}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── TAB: COMPARISON ───────────────────────────────────────── */}
      {activeTab === "comparison" && (
        <ComparisonTab />
      )}

      {/* ── TAB: ALERTS ───────────────────────────────────────────── */}
      {activeTab === "alerts" && (
        <div className="space-y-4">
          {loadingAlerts ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Mengumpulkan alerts...</div>
          ) : alertsData ? (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard icon={XCircle} label="Kritis" value={alertsData.summary.critical} color="text-red-600" />
                <StatCard icon={AlertTriangle} label="Peringatan" value={alertsData.summary.warning} color="text-yellow-600" />
                <StatCard icon={Info} label="Info" value={alertsData.summary.info} color="text-blue-600" />
              </div>

              {(["critical", "warning", "info"] as const).map((sev) => {
                const items = alertsData.alerts[sev];
                if (items.length === 0) return null;
                const isExpanded = expandedAlerts[sev];
                const borderColor = sev === "critical" ? "border-red-200" : sev === "warning" ? "border-yellow-200" : "border-blue-200";
                const bgColor = sev === "critical" ? "bg-red-50" : sev === "warning" ? "bg-yellow-50" : "bg-blue-50";

                return (
                  <Card key={sev} className={`border ${borderColor}`}>
                    <button
                      className="w-full flex items-center justify-between px-4 py-3"
                      onClick={() => setExpandedAlerts((p) => ({ ...p, [sev]: !p[sev] }))}
                    >
                      <div className="flex items-center gap-2">
                        <AlertBadge severity={sev} />
                        <span className="font-medium text-sm">{items.length} alert</span>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    {isExpanded && (
                      <div className={`${bgColor} border-t ${borderColor} divide-y divide-current/10`}>
                        {items.map((alert, i) => (
                          <div key={i} className="px-4 py-3 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm">{alert.message}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs h-5">{alert.companyName}</Badge>
                                <span className="text-xs text-muted-foreground">{alert.source}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}

              {alertsData.summary.total === 0 && (
                <div className="py-12 text-center space-y-2">
                  <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                  <p className="font-medium">Semua bersih!</p>
                  <p className="text-sm text-muted-foreground">Tidak ada alert aktif di seluruh grup.</p>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ── TAB: AI BRIEFING ──────────────────────────────────────── */}
      {activeTab === "briefing" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                Holding Executive Briefing
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Ringkasan AI dari seluruh perusahaan dalam grup. Generate setiap hari sebelum rapat pagi.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={() => briefingMutation.mutate()}
                disabled={briefingMutation.isPending}
                className="w-full sm:w-auto"
              >
                {briefingMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Sedang membuat briefing...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    Generate Briefing Sekarang
                  </>
                )}
              </Button>

              {briefingMutation.data && (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Star className="h-3.5 w-3.5 text-yellow-500" />
                    <span>Dibuat: {new Date(briefingMutation.data.generatedAt).toLocaleString("id-ID")}</span>
                    <span>·</span>
                    <span>{briefingMutation.data.companyCount} perusahaan dianalisis</span>
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                    {formatBriefing(briefingMutation.data.briefing)}
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Snapshot Data</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {briefingMutation.data.snapshot.map((s) => (
                        <div key={s.company_name} className="rounded border px-3 py-2 text-xs">
                          <p className="font-medium">{s.company_name}</p>
                          <p className="text-muted-foreground mt-0.5">
                            {s.tasks} tugas · Armada {s.fleetOk}✓ {s.fleetIssue > 0 ? `${s.fleetIssue}⚠` : ""} · {s.pendingPR} PR pending
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {briefingMutation.isError && (
                <p className="text-sm text-red-600">Gagal membuat briefing. Coba lagi.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Comparison Tab (lazy-loaded data) ─────────────────────────────────────────

function ComparisonTab() {
  const { data, isLoading } = useQuery<{
    companies: Array<{
      companyId: string;
      companyName: string;
      metrics: { tasks: number; fleet: number; vendors: number; customers: number; waUsage: number; aiUsage: number; onboarding: number };
    }>;
    comparison: Array<{
      metric: string;
      values: Array<{ companyId: string; companyName: string; value: number }>;
    }>;
  }>({
    queryKey: ["holding-comparison"],
    queryFn: () => apiFetch("/api/holding/comparison"),
    staleTime: 60_000,
  });

  const metricLabels: Record<string, string> = {
    tasks: "Total Tugas",
    fleet: "Unit Armada",
    vendors: "Vendor",
    customers: "Pelanggan",
    waUsage: "Pesan WA",
    aiUsage: "Tugas AI (30hr)",
    onboarding: "Sesi Onboarding",
  };

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Memuat data perbandingan...</div>;
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.comparison.map((c) => {
        const maxVal = Math.max(...c.values.map((v) => v.value), 1);
        return (
          <Card key={c.metric}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{metricLabels[c.metric] ?? c.metric}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[...c.values]
                  .sort((a, b) => b.value - a.value)
                  .map((v) => (
                    <div key={v.companyId} className="flex items-center gap-3">
                      <p className="text-sm w-32 shrink-0 truncate" title={v.companyName}>{v.companyName}</p>
                      <div className="flex-1">
                        <Progress value={(v.value / maxVal) * 100} className="h-2" />
                      </div>
                      <span className="text-sm font-bold w-12 text-right shrink-0">{v.value.toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
