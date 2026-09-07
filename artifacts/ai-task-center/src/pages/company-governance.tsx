import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";
import {
  Shield, Building2, Activity, AlertTriangle, CheckCircle2,
  XCircle, ChevronRight, BarChart3, Users, Truck, ShoppingCart,
  Database, Lock, Eye, FileCheck, RefreshCw, Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── API helper ────────────────────────────────────────────────────────────────
function apiFetch<T>(path: string): Promise<T> {
  const token = getStoredToken();
  return fetch(`/api/company-governance${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<T>;
  });
}

// ── Shared badges ─────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-green-100 text-green-700 border-green-200" :
    score >= 60 ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
    score >= 40 ? "bg-orange-100 text-orange-700 border-orange-200" :
    "bg-red-100 text-red-700 border-red-200";
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold", color)}>
      <Star className="h-3 w-3" />{score}
    </span>
  );
}

function RiskBadge({ level }: { level: string }) {
  const v: Record<string, string> = {
    low: "bg-green-100 text-green-700", medium: "bg-yellow-100 text-yellow-700", high: "bg-red-100 text-red-700",
  };
  return <span className={cn("px-2 py-0.5 rounded text-xs font-medium capitalize", v[level] ?? "bg-gray-100 text-gray-600")}>{level}</span>;
}

function SeverityBadge({ s }: { s: string }) {
  const v: Record<string, string> = {
    critical: "bg-red-100 text-red-700", warning: "bg-yellow-100 text-yellow-700", info: "bg-blue-100 text-blue-700",
  };
  return <span className={cn("px-2 py-0.5 rounded text-xs font-medium capitalize", v[s] ?? "")}>{s}</span>;
}

// ── A: Isolation Audit ────────────────────────────────────────────────────────
function IsolationAudit() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["gov-isolation"],
    queryFn: () => apiFetch<{
      summary: { totalTables: number; properlyIsolated: number; partiallyIsolated: number; noIsolation: number; isolationScore: number };
      tables: Array<{ table: string; hasCompanyId: boolean; filterEnforced: string; riskLevel: string; notes: string }>;
    }>("/isolation-audit"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Memuat audit...</div>;
  if (!data) return null;
  const { summary, tables } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Tabel",   value: summary.totalTables,       color: "text-foreground" },
          { label: "Terisolasi",    value: summary.properlyIsolated,  color: "text-green-600" },
          { label: "Parsial",       value: summary.partiallyIsolated, color: "text-yellow-600" },
          { label: "Tanpa Isolasi", value: summary.noIsolation,       color: "text-red-600" },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">Isolation Score</CardTitle>
          <ScoreBadge score={summary.isolationScore} />
        </CardHeader>
        <CardContent><Progress value={summary.isolationScore} className="h-2" /></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">Detail Tabel</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 border-y">
                <tr>{["Tabel","company_id?","Filter?","Risiko","Catatan"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y">
                {tables.map((t) => (
                  <tr key={t.table} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono font-medium">{t.table}</td>
                    <td className="px-3 py-2">{t.hasCompanyId ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-400" />}</td>
                    <td className="px-3 py-2 capitalize font-medium">{t.filterEnforced}</td>
                    <td className="px-3 py-2"><RiskBadge level={t.riskLevel} /></td>
                    <td className="px-3 py-2 text-muted-foreground">{t.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── B: Governance Center ──────────────────────────────────────────────────────
function GovernanceCenter() {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-companies"],
    queryFn: () => apiFetch<{
      companies: Array<{
        companyId: string; companyName: string; industryType: string | null;
        email: string | null; phone: string | null; createdAt: string;
        stats: { userCount: number; taskCount: number; fleetCount: number; customerCount: number };
        activeModules: { fleet: boolean; purchasing: boolean; crm: boolean; ai: boolean };
      }>;
    }>("/companies"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Memuat...</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      {data.companies.map((c) => (
        <Card key={c.companyId}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                  {(c.companyName ?? c.companyId).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold">{c.companyName ?? c.companyId}</p>
                  <p className="text-xs text-muted-foreground">{c.companyId} · {c.industryType ?? "Industri belum diisi"}</p>
                </div>
              </div>
              <div className="flex gap-1 flex-wrap justify-end">
                {Object.entries(c.activeModules).map(([mod, active]) => (
                  <Badge key={mod} variant={active ? "default" : "secondary"} className="text-xs">{mod.toUpperCase()}</Badge>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Users", value: c.stats.userCount },
                { label: "Tasks", value: c.stats.taskCount },
                { label: "Fleet", value: c.stats.fleetCount },
                { label: "Customers", value: c.stats.customerCount },
              ].map((s) => (
                <div key={s.label} className="bg-muted/40 rounded-md py-2">
                  <p className="text-base font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── C: Health Score ───────────────────────────────────────────────────────────
function HealthScores() {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-health"],
    queryFn: () => apiFetch<{
      scores: Array<{
        companyId: string; total: number;
        onboarding: number; dataQuality: number; memoryCoverage: number;
        fleetReadiness: number; purchasingReadiness: number;
        breakdown: Record<string, { score: number; label: string; details: string }>;
      }>;
    }>("/health-scores"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Menghitung skor...</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.scores.map((c) => (
        <Card key={c.companyId}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">{c.companyId}</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Total</span>
                <ScoreBadge score={c.total} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.values(c.breakdown).map((b) => (
              <div key={b.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">{b.label}</span>
                  <span className="text-xs font-bold">{b.score}/100</span>
                </div>
                <Progress value={b.score} className="h-1.5" />
                <p className="text-xs text-muted-foreground mt-0.5">{b.details}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── D: Safety Audit ───────────────────────────────────────────────────────────
function SafetyAudit() {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-safety"],
    queryFn: () => apiFetch<{
      summary: { totalRoutes: number; enforced: number; violations: number; highRisk: number; mediumRisk: number; safetyScore: number; verdict: string };
      routes: Array<{ domain: string; route: string; enforced: boolean; mechanism: string; risk: string }>;
    }>("/safety-audit"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Memuat...</div>;
  if (!data) return null;
  const { summary, routes } = data;
  const verdictColor = summary.verdict === "SAFE" ? "text-green-600" : summary.verdict === "CAUTION" ? "text-yellow-600" : "text-red-600";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Route",  value: summary.totalRoutes,           color: "text-foreground" },
          { label: "Aman",         value: summary.enforced,              color: "text-green-600" },
          { label: "Pelanggaran",  value: summary.violations,            color: "text-red-600" },
          { label: "High Risk",    value: summary.highRisk,              color: "text-red-600" },
          { label: "Medium Risk",  value: summary.mediumRisk,            color: "text-yellow-600" },
          { label: "Safety Score", value: `${summary.safetyScore}%`,     color: verdictColor },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">Verdict: <span className={verdictColor}>{summary.verdict}</span></CardTitle>
          <ScoreBadge score={summary.safetyScore} />
        </CardHeader>
        <CardContent>
          <Progress value={summary.safetyScore} className="h-2 mb-4" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 border-y">
                <tr>{["Domain","Route","Status","Mekanisme","Risiko"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y">
                {routes.map((r) => (
                  <tr key={r.route} className={cn("hover:bg-muted/30", !r.enforced && "bg-red-50/30")}>
                    <td className="px-3 py-2 capitalize font-medium">{r.domain}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.route}</td>
                    <td className="px-3 py-2">{r.enforced ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-400" />}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.mechanism}</td>
                    <td className="px-3 py-2"><RiskBadge level={r.risk} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── E: Config Profile ─────────────────────────────────────────────────────────
function ConfigProfile() {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-config"],
    queryFn: () => apiFetch<{
      profile: Record<string, unknown> | null;
      completionScore: number;
      missing: string[];
      fields: Array<{ key: string; label: string; value: unknown; weight: number }>;
    }>("/config-profile"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Memuat...</div>;
  if (!data) return null;
  const { completionScore, missing, fields } = data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">Completion Score</CardTitle>
          <ScoreBadge score={completionScore} />
        </CardHeader>
        <CardContent>
          <Progress value={completionScore} className="h-3 mb-3" />
          {missing.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <p className="text-xs font-medium text-yellow-700 mb-1">Field belum diisi:</p>
              <ul className="space-y-0.5">
                {missing.map(m => (
                  <li key={m} className="text-xs text-yellow-600 flex items-center gap-1">
                    <ChevronRight className="h-3 w-3" />{m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Detail Konfigurasi</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {fields.map((f) => (
            <div key={f.key} className="flex items-center justify-between py-1.5 border-b last:border-0">
              <div>
                <p className="text-sm font-medium">{f.label}</p>
                <p className="text-xs text-muted-foreground">Bobot: {f.weight}%</p>
              </div>
              {f.value !== null && f.value !== undefined && f.value !== ""
                ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                : <XCircle className="h-5 w-5 text-red-400 shrink-0" />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── F: Resource Utilization ───────────────────────────────────────────────────
function ResourceUtilization() {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-resources"],
    queryFn: () => apiFetch<{
      utilization: Array<{
        companyId: string;
        resources: { aiTasks: number; waMessages: number; users: number; fleetUnits: number; vendors: number; customers: number; purchaseRequests: number; storageEstimateKb: number };
      }>;
    }>("/resource-utilization"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Memuat...</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      {data.utilization.map((u) => (
        <Card key={u.companyId}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{u.companyId}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "AI Tasks",        value: u.resources.aiTasks,           icon: Activity },
                { label: "WA Messages",     value: u.resources.waMessages,        icon: Database },
                { label: "Users",           value: u.resources.users,             icon: Users },
                { label: "Fleet Units",     value: u.resources.fleetUnits,        icon: Truck },
                { label: "Vendors",         value: u.resources.vendors,           icon: Building2 },
                { label: "Customers",       value: u.resources.customers,         icon: Building2 },
                { label: "PR Pembelian",    value: u.resources.purchaseRequests,  icon: ShoppingCart },
                { label: "Est. Storage KB", value: u.resources.storageEstimateKb, icon: Database },
              ].map((r) => (
                <div key={r.label} className="bg-muted/40 rounded-md p-2 text-center">
                  <r.icon className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-base font-bold">{r.value.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{r.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── G: Executive Multi-Company View (super_admin only) ────────────────────────
function ExecutiveView() {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-executive"],
    queryFn: () => apiFetch<{
      summary: { totalCompanies: number; avgHealth: number; totalTasks: number; totalFleet: number };
      companies: Array<{
        companyId: string; companyName: string; healthScore: number;
        kpis: { totalTasks: number; openTasks: number; customerCount: number; vendorCount: number; fleetCount: number; fleetHighRisk: number; purchaseRequests: number; pendingApprovals: number; aiAdoption: number };
        signals: { fleetHealth: string; vendorReadiness: string; customerReadiness: string; taskLoad: string };
      }>;
    }>("/executive-view"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Memuat...</div>;
  if (!data) return null;

  const signalColor = (s: string) => s === "green" ? "text-green-600" : s === "yellow" ? "text-yellow-600" : "text-red-600";
  const signalDot   = (s: string) => s === "green" ? "bg-green-500" : s === "yellow" ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Perusahaan", value: data.summary.totalCompanies },
          { label: "Avg Health",       value: `${data.summary.avgHealth}/100` },
          { label: "Total Tasks",      value: data.summary.totalTasks },
          { label: "Total Fleet",      value: data.summary.totalFleet },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>
      {data.companies.map((c) => (
        <Card key={c.companyId}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-semibold">{c.companyName}</p>
                <p className="text-xs text-muted-foreground">{c.companyId}</p>
              </div>
              <ScoreBadge score={c.healthScore} />
            </div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { label: "Tasks",    value: c.kpis.totalTasks },
                { label: "Open",     value: c.kpis.openTasks },
                { label: "Fleet",    value: c.kpis.fleetCount },
                { label: "AI Adopt", value: `${c.kpis.aiAdoption}%` },
              ].map((k) => (
                <div key={k.label} className="bg-muted/40 rounded py-1.5 text-center">
                  <p className="text-sm font-bold">{k.value}</p>
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3 flex-wrap">
              {Object.entries(c.signals).map(([key, val]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className={cn("h-2 w-2 rounded-full", signalDot(val))} />
                  <span className={cn("text-xs font-medium capitalize", signalColor(val))}>
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── H: Alerts ─────────────────────────────────────────────────────────────────
function AlertsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["gov-alerts"],
    queryFn: () => apiFetch<{
      summary: { total: number; critical: number; warning: number; info: number };
      alerts: Array<{ id: string; companyId: string; type: string; severity: string; title: string; description: string; value?: number; threshold?: number }>;
    }>("/alerts"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Memuat alert...</div>;
  if (!data) return null;

  const icons: Record<string, string> = { critical: "🔴", warning: "🟡", info: "🔵" };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Critical", value: data.summary.critical, color: "text-red-600" },
          { label: "Warning",  value: data.summary.warning,  color: "text-yellow-600" },
          { label: "Info",     value: data.summary.info,     color: "text-blue-600" },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>
      {data.alerts.length === 0 ? (
        <Card className="p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
          <p className="font-medium">Tidak ada alert aktif</p>
          <p className="text-sm text-muted-foreground">Semua metrik dalam kondisi normal</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.alerts.map((a) => (
            <Card key={a.id} className={cn(
              "border-l-4",
              a.severity === "critical" ? "border-l-red-500" :
              a.severity === "warning"  ? "border-l-yellow-500" : "border-l-blue-500",
            )}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{icons[a.severity]}</span>
                      <p className="text-sm font-semibold">{a.title}</p>
                      <SeverityBadge s={a.severity} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Perusahaan: <span className="font-medium">{a.companyId}</span></p>
                  </div>
                  {a.value !== undefined && (
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold">{a.value}</p>
                      <p className="text-xs text-muted-foreground">/{a.threshold}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── I: Validation Report ──────────────────────────────────────────────────────
function ValidationReport() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["gov-validation"],
    queryFn: () => apiFetch<{
      timestamp: string;
      summary: { companiesAudited: number; isolationScore: number; safetyScore: number; avgHealthScore: number; safetyViolations: number; readinessScore: number; verdict: string; verdictReason: string };
      checks: Array<{ name: string; score: number; threshold: number; passed: boolean }>;
      companies: Array<{ companyId: string; healthScore: number }>;
    }>("/validation-report"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Menjalankan validasi...</div>;
  if (!data) return null;

  const { summary, checks } = data;
  const isGo = summary.verdict === "GO";

  return (
    <div className="space-y-4">
      <Card className={cn("border-2", isGo ? "border-green-400" : "border-red-400")}>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className={cn("h-16 w-16 rounded-full flex items-center justify-center text-white font-bold text-xl shrink-0", isGo ? "bg-green-500" : "bg-red-500")}>
              {summary.verdict}
            </div>
            <div>
              <p className="text-lg font-bold">{isGo ? "✅ Siap untuk Sprint 10B-2" : "❌ Perbaikan Diperlukan"}</p>
              <p className="text-sm text-muted-foreground">{summary.verdictReason}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(data.timestamp).toLocaleString("id-ID")} · {summary.companiesAudited} perusahaan diaudit
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Isolation Score",   value: `${summary.isolationScore}%` },
          { label: "Safety Score",      value: `${summary.safetyScore}%` },
          { label: "Avg Health",        value: `${summary.avgHealthScore}/100` },
          { label: "Violations",        value: summary.safetyViolations },
          { label: "Readiness Score",   value: `${summary.readinessScore}%` },
          { label: "Companies Audited", value: summary.companiesAudited },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">Checklist Validasi</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.map((c) => (
            <div key={c.name} className="flex items-center justify-between py-2 border-b last:border-0">
              <div className="flex items-center gap-2">
                {c.passed
                  ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                <span className="text-sm font-medium">{c.name}</span>
              </div>
              <div className="text-right">
                <span className={cn("text-sm font-bold", c.passed ? "text-green-600" : "text-red-600")}>{c.score}</span>
                <span className="text-xs text-muted-foreground"> /{c.threshold}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CompanyGovernancePage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [activeTab, setActiveTab] = useState("governance");

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-6 overflow-auto">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Company Governance Center</h1>
          <p className="text-sm text-muted-foreground">Multi-company scaling foundation · Sprint 10B-1</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/60 p-1">
          <TabsTrigger value="governance" className="text-xs"><Building2 className="h-3.5 w-3.5 mr-1" />Governance</TabsTrigger>
          <TabsTrigger value="health"     className="text-xs"><BarChart3  className="h-3.5 w-3.5 mr-1" />Health Score</TabsTrigger>
          <TabsTrigger value="isolation"  className="text-xs"><Database   className="h-3.5 w-3.5 mr-1" />Isolasi DB</TabsTrigger>
          <TabsTrigger value="safety"     className="text-xs"><Lock       className="h-3.5 w-3.5 mr-1" />Safety Audit</TabsTrigger>
          <TabsTrigger value="config"     className="text-xs"><FileCheck  className="h-3.5 w-3.5 mr-1" />Config Profile</TabsTrigger>
          <TabsTrigger value="resources"  className="text-xs"><Activity   className="h-3.5 w-3.5 mr-1" />Resources</TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="executive" className="text-xs"><Eye className="h-3.5 w-3.5 mr-1" />Exec View</TabsTrigger>
          )}
          <TabsTrigger value="alerts"     className="text-xs"><AlertTriangle   className="h-3.5 w-3.5 mr-1" />Alerts</TabsTrigger>
          <TabsTrigger value="validation" className="text-xs"><CheckCircle2    className="h-3.5 w-3.5 mr-1" />Validasi</TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="governance"> <GovernanceCenter    /></TabsContent>
          <TabsContent value="health">     <HealthScores        /></TabsContent>
          <TabsContent value="isolation">  <IsolationAudit      /></TabsContent>
          <TabsContent value="safety">     <SafetyAudit         /></TabsContent>
          <TabsContent value="config">     <ConfigProfile       /></TabsContent>
          <TabsContent value="resources">  <ResourceUtilization /></TabsContent>
          {isSuperAdmin && (
            <TabsContent value="executive"><ExecutiveView       /></TabsContent>
          )}
          <TabsContent value="alerts">     <AlertsPanel         /></TabsContent>
          <TabsContent value="validation"> <ValidationReport    /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
