/**
 * Sprint 10B-4 — AI Operations Center
 * 7 tabs: Overview · Registry · Analytics · Quality · Failures · Leaderboard · Holding (super_admin)
 */
import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "@/lib/auth-api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModuleStat {
  id: string;
  name: string;
  category: string;
  model: string;
  description: string;
  status: "active" | "idle" | "dormant";
  totalRequests: number;
  lastExecution: string | null;
  successRate: number;
  errorCount: number;
  avgTokensPerCall: number;
  estimatedCostUsd: number;
  freshnessScore: number;
}

interface RegistryData {
  modules: ModuleStat[];
  summary: {
    total: number;
    active: number;
    idle: number;
    dormant: number;
    totalRequests: number;
    totalCostUsd: number;
    avgSuccessRate: number;
  };
  generatedAt: string;
}

interface HealthData {
  healthScore: number;
  grade: string;
  breakdown: { successRate: number; freshness: number; latency: number; failureRate: number };
  moduleCount: number;
  activeModules: number;
  idleModules: number;
  dormantModules: number;
  risks: string[];
  recommendations: string[];
  generatedAt: string;
}

interface AnalyticsData {
  period: string;
  modules: Array<{
    id: string; name: string; category: string; model: string;
    totalRequests: number; successRate: number; errorCount: number;
    avgTokensPerCall: number; estimatedCostUsd: number;
  }>;
  dailyActivity: Array<{ day: string; requests: number }>;
  topIntents: Array<{ intent: string; count: number }>;
  totals: { requests: number; estimatedCostUsd: number; tokensUsed: number };
  generatedAt: string;
}

interface QualityData {
  overallConfidence: number;
  modules: Array<{
    id: string; name: string;
    confidenceScore: number; completionRate: number;
    manualOverrideRate: number; falsePositiveIndicator: number;
  }>;
  summary: { avgConfidence: number; avgCompletionRate: number; avgManualOverrideRate: number; modulesWithData: number };
  generatedAt: string;
}

interface FailureData {
  failures: Array<{
    module: string; moduleName: string; error: string;
    severity: "critical" | "warning" | "info";
    lastOccurrence: string; count: number; context: string | null;
  }>;
  summary: { total: number; critical: number; warning: number; info: number; affectedModules: number };
  generatedAt: string;
}

interface LeaderboardData {
  mostUsed: ModuleStat[];
  highestSuccess: ModuleStat[];
  highestCost: ModuleStat[];
  lowestConfidence: ModuleStat[];
  generatedAt: string;
}

interface HoldingData {
  companies: Array<{
    companyId: string; companyName: string;
    activeModules: number; totalRequests: number;
    avgSuccessRate: number; estimatedCostUsd: number;
    aiTasks: number; intakeSessions: number; docAudits: number;
    lastActivity: string | null; freshnessScore: number;
  }>;
  groupTotals: { companies: number; totalRequests: number; totalCostUsd: number; avgSuccessRate: number };
  topByUsage: Array<{ companyName: string; totalRequests: number }>;
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = "/api";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: decimals });
}

function relativeTime(ts: string | null): string {
  if (!ts) return "Belum pernah";
  const diff = Date.now() - new Date(ts).getTime();
  const h = diff / 3_600_000;
  if (h < 1) return `${Math.round(diff / 60000)} menit lalu`;
  if (h < 24) return `${Math.round(h)} jam lalu`;
  const d = Math.round(h / 24);
  return `${d} hari lalu`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    idle: "bg-yellow-100 text-yellow-800",
    dormant: "bg-gray-100 text-gray-600",
    critical: "bg-red-100 text-red-800",
    warning: "bg-yellow-100 text-yellow-800",
    info: "bg-blue-100 text-blue-800",
  };
  const labels: Record<string, string> = {
    active: "Aktif", idle: "Idle", dormant: "Dormant",
    critical: "Kritis", warning: "Peringatan", info: "Info",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status === "active" && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse inline-block" />}
      {labels[status] ?? status}
    </span>
  );
}

function GradeCircle({ score, grade }: { score: number; grade: string }) {
  const color = score >= 75 ? "text-green-600" : score >= 50 ? "text-yellow-600" : "text-red-600";
  const ring = score >= 75 ? "border-green-400" : score >= 50 ? "border-yellow-400" : "border-red-400";
  return (
    <div className={`w-24 h-24 rounded-full border-4 ${ring} flex flex-col items-center justify-center`}>
      <span className={`text-3xl font-black ${color}`}>{grade}</span>
      <span className="text-xs text-muted-foreground font-medium">{score}%</span>
    </div>
  );
}

function ProgressBar({ value, max = 100, color = "bg-blue-500" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

interface TabDef {
  id: string;
  label: string;
  superAdminOnly?: boolean;
}

const TABS: TabDef[] = [
  { id: "overview",     label: "Overview" },
  { id: "registry",    label: "Registry" },
  { id: "analytics",   label: "Analytics" },
  { id: "quality",     label: "Quality" },
  { id: "failures",    label: "Failures" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "holding",     label: "Holding", superAdminOnly: true },
];

type TabId = "overview" | "registry" | "analytics" | "quality" | "failures" | "leaderboard" | "holding";

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ health, registry }: { health: HealthData | null; registry: RegistryData | null }) {
  if (!health || !registry) return <p className="text-muted-foreground text-sm py-8 text-center">Memuat data...</p>;
  const { breakdown, risks, recommendations } = health;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "AI Health", value: `${health.healthScore}%`, sub: `Grade ${health.grade}`, color: health.healthScore >= 75 ? "text-green-600" : "text-yellow-600" },
          { label: "Modul Aktif", value: `${health.activeModules}/${health.moduleCount}`, sub: "dalam 24 jam", color: "text-blue-600" },
          { label: "Total Requests", value: fmt(registry.summary.totalRequests), sub: "semua modul", color: "text-purple-600" },
          { label: "Estimasi Biaya", value: `$${registry.summary.totalCostUsd}`, sub: "total akumulasi", color: "text-orange-600" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">AI Health Breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Success Rate", value: breakdown.successRate, color: "bg-green-500" },
              { label: "Freshness (aktifitas)", value: breakdown.freshness, color: "bg-blue-500" },
              { label: "Latency Score", value: breakdown.latency, color: "bg-purple-500" },
              { label: "Non-Failure Rate", value: 100 - breakdown.failureRate, color: "bg-orange-500" },
            ].map((b) => (
              <div key={b.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="font-medium">{b.value}%</span>
                </div>
                <ProgressBar value={b.value} color={b.color} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Status Modul</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "🟢 Aktif (≤24 jam)", count: health.activeModules, color: "text-green-600" },
              { label: "🟡 Idle (≤7 hari)", count: health.idleModules, color: "text-yellow-600" },
              { label: "⚫ Dormant (>7 hari)", count: health.dormantModules, color: "text-gray-500" },
            ].map((s) => (
              <div key={s.label} className="flex justify-between items-center py-1 border-b last:border-0">
                <span className="text-sm">{s.label}</span>
                <span className={`font-bold ${s.color}`}>{s.count}</span>
              </div>
            ))}
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-1">Avg Success Rate</p>
              <ProgressBar value={registry.summary.avgSuccessRate} color="bg-green-500" />
              <p className="text-xs text-right mt-1">{registry.summary.avgSuccessRate}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {risks.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-orange-700">⚠ Risiko & Rekomendasi</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {risks.map((r, i) => (
              <p key={i} className="text-xs text-orange-700">• {r}</p>
            ))}
            <div className="pt-2 border-t border-orange-200 mt-2">
              {recommendations.map((r, i) => (
                <p key={i} className="text-xs text-green-700">✓ {r}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Registry Tab ──────────────────────────────────────────────────────────────

function RegistryTab({ registry }: { registry: RegistryData | null }) {
  if (!registry) return <p className="text-muted-foreground text-sm py-8 text-center">Memuat registry...</p>;
  const catColors: Record<string, string> = {
    conversation: "bg-blue-100 text-blue-700",
    routing: "bg-purple-100 text-purple-700",
    validation: "bg-green-100 text-green-700",
    memory: "bg-pink-100 text-pink-700",
    intelligence: "bg-orange-100 text-orange-700",
    reporting: "bg-yellow-100 text-yellow-700",
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-3 text-sm">
        <span className="text-muted-foreground">Total: <strong>{registry.summary.total}</strong></span>
        <span className="text-green-600">Aktif: <strong>{registry.summary.active}</strong></span>
        <span className="text-yellow-600">Idle: <strong>{registry.summary.idle}</strong></span>
        <span className="text-gray-500">Dormant: <strong>{registry.summary.dormant}</strong></span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {["Modul", "Kategori", "Model", "Status", "Requests", "Success%", "Biaya USD", "Error", "Terakhir Jalan"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {registry.modules.map((m) => (
              <tr key={m.id} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.description.substring(0, 50)}…</p>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${catColors[m.category] ?? "bg-gray-100"}`}>
                    {m.category}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{m.model}</td>
                <td className="px-3 py-2"><StatusBadge status={m.status} /></td>
                <td className="px-3 py-2 font-mono">{fmt(m.totalRequests)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <ProgressBar value={m.successRate} color={m.successRate >= 80 ? "bg-green-500" : "bg-yellow-500"} />
                    <span className="text-xs w-8 text-right">{m.successRate}%</span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">${m.estimatedCostUsd}</td>
                <td className="px-3 py-2 text-center">
                  {m.errorCount > 0 ? <span className="text-red-600 font-medium">{m.errorCount}</span> : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{relativeTime(m.lastExecution)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ analytics }: { analytics: AnalyticsData | null }) {
  if (!analytics) return <p className="text-muted-foreground text-sm py-8 text-center">Memuat analitik...</p>;
  const maxReq = Math.max(...analytics.modules.map((m) => m.totalRequests), 1);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Requests", value: fmt(analytics.totals.requests) },
          { label: "Token Digunakan", value: fmt(analytics.totals.tokensUsed) },
          { label: "Estimasi Biaya", value: `$${analytics.totals.estimatedCostUsd}` },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Penggunaan per Modul</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {analytics.modules.map((m) => (
            <div key={m.id} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground">{fmt(m.totalRequests)} req · ${m.estimatedCostUsd} · {m.successRate}% sukses</span>
              </div>
              <div className="flex gap-1 items-center">
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${Math.max(2, (m.totalRequests / maxReq) * 100)}%` }}
                  />
                </div>
                <span className="text-xs w-8 text-right text-muted-foreground">{m.avgTokensPerCall > 0 ? `~${m.avgTokensPerCall}` : "—"}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {analytics.topIntents.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top Intent AI (30 hari)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analytics.topIntents.map((t, i) => (
                <div key={i} className="flex justify-between text-sm py-1 border-b last:border-0">
                  <span className="font-mono text-xs">{t.intent || "(no intent)"}</span>
                  <span className="font-medium">{fmt(t.count)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Quality Tab ───────────────────────────────────────────────────────────────

function QualityTab({ quality }: { quality: QualityData | null }) {
  if (!quality) return <p className="text-muted-foreground text-sm py-8 text-center">Memuat metrik kualitas...</p>;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-6">
        <GradeCircle
          score={quality.overallConfidence}
          grade={quality.overallConfidence >= 80 ? "A" : quality.overallConfidence >= 65 ? "B" : quality.overallConfidence >= 50 ? "C" : "D"}
        />
        <div className="space-y-1">
          <p className="text-sm font-medium">Overall AI Confidence</p>
          <p className="text-2xl font-bold">{quality.overallConfidence}%</p>
          <p className="text-xs text-muted-foreground">
            {quality.summary.modulesWithData} dari {quality.modules.length} modul memiliki data
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Avg Confidence", value: `${quality.summary.avgConfidence}%` },
          { label: "Avg Completion Rate", value: `${quality.summary.avgCompletionRate}%` },
          { label: "Manual Override", value: `${quality.summary.avgManualOverrideRate}%` },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Kualitas per Modul</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2">Modul</th>
                <th className="text-right py-2">Confidence</th>
                <th className="text-right py-2">Completion</th>
                <th className="text-right py-2">Override</th>
                <th className="text-right py-2">False Positive</th>
              </tr>
            </thead>
            <tbody>
              {quality.modules.map((m) => (
                <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 font-medium">{m.name}</td>
                  <td className="py-2 text-right">
                    <span className={m.confidenceScore >= 75 ? "text-green-600" : m.confidenceScore > 0 ? "text-yellow-600" : "text-gray-400"}>
                      {m.confidenceScore > 0 ? `${m.confidenceScore}%` : "—"}
                    </span>
                  </td>
                  <td className="py-2 text-right">{m.completionRate > 0 ? `${m.completionRate}%` : "—"}</td>
                  <td className="py-2 text-right">{m.manualOverrideRate > 0 ? `${m.manualOverrideRate}%` : "—"}</td>
                  <td className="py-2 text-right">
                    <span className={m.falsePositiveIndicator > 20 ? "text-red-500" : "text-gray-500"}>
                      {m.falsePositiveIndicator > 0 ? `${m.falsePositiveIndicator}%` : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Failures Tab ──────────────────────────────────────────────────────────────

function FailuresTab({ failures }: { failures: FailureData | null }) {
  if (!failures) return <p className="text-muted-foreground text-sm py-8 text-center">Memuat data kegagalan...</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Failure", value: failures.summary.total, color: "text-gray-800" },
          { label: "Kritis", value: failures.summary.critical, color: "text-red-600" },
          { label: "Peringatan", value: failures.summary.warning, color: "text-yellow-600" },
          { label: "Info", value: failures.summary.info, color: "text-blue-600" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {failures.failures.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-4xl mb-2">✅</p>
            <p className="font-medium text-green-700">Tidak ada failure terdeteksi</p>
            <p className="text-xs text-muted-foreground mt-1">Semua modul AI berjalan normal</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">AI Failure Center</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left py-2">Modul</th>
                  <th className="text-left py-2">Error</th>
                  <th className="text-center py-2">Severity</th>
                  <th className="text-right py-2">Frekuensi</th>
                  <th className="text-right py-2">Terakhir</th>
                </tr>
              </thead>
              <tbody>
                {failures.failures.map((f, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 font-medium">{f.moduleName}</td>
                    <td className="py-2 text-xs text-muted-foreground max-w-48 truncate">{f.error}</td>
                    <td className="py-2 text-center"><StatusBadge status={f.severity} /></td>
                    <td className="py-2 text-right font-mono">{f.count}×</td>
                    <td className="py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{relativeTime(f.lastOccurrence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Leaderboard Tab ───────────────────────────────────────────────────────────

function LeaderboardTab({ leaderboard }: { leaderboard: LeaderboardData | null }) {
  if (!leaderboard) return <p className="text-muted-foreground text-sm py-8 text-center">Memuat leaderboard...</p>;

  const sections = [
    { title: "🏆 Paling Banyak Digunakan", modules: leaderboard.mostUsed, key: "totalRequests" as keyof ModuleStat, label: "requests", fmt: (v: number) => fmt(v) },
    { title: "✅ Tingkat Sukses Tertinggi", modules: leaderboard.highestSuccess, key: "successRate" as keyof ModuleStat, label: "% sukses", fmt: (v: number) => `${v}%` },
    { title: "💰 Biaya Tertinggi", modules: leaderboard.highestCost, key: "estimatedCostUsd" as keyof ModuleStat, label: "USD", fmt: (v: number) => `$${v}` },
    { title: "⚠ Confidence Terendah", modules: leaderboard.lowestConfidence, key: "successRate" as keyof ModuleStat, label: "% sukses", fmt: (v: number) => `${v}%` },
  ];

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {sections.map((section) => (
        <Card key={section.title}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{section.title}</CardTitle></CardHeader>
          <CardContent>
            {section.modules.filter((m) => m.totalRequests > 0 || section.key === "estimatedCostUsd").length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Belum ada data</p>
            ) : (
              <div className="space-y-2">
                {section.modules.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-3 py-1 border-b last:border-0">
                    <span className="text-lg font-black text-muted-foreground w-6 text-center">
                      {["🥇", "🥈", "🥉", "4", "5"][i] ?? i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.category}</p>
                    </div>
                    <span className="font-bold text-sm">{section.fmt(m[section.key] as number)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Holding Tab ───────────────────────────────────────────────────────────────

function HoldingTab({ holding }: { holding: HoldingData | null }) {
  if (!holding) return <p className="text-muted-foreground text-sm py-8 text-center">Memuat data holding...</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Perusahaan", value: holding.groupTotals.companies },
          { label: "Total Requests", value: fmt(holding.groupTotals.totalRequests) },
          { label: "Total Biaya", value: `$${holding.groupTotals.totalCostUsd}` },
          { label: "Avg Success", value: `${holding.groupTotals.avgSuccessRate}%` },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">AI Metrics per Perusahaan</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2">Perusahaan</th>
                <th className="text-right py-2">Modul Aktif</th>
                <th className="text-right py-2">Requests</th>
                <th className="text-right py-2">Success%</th>
                <th className="text-right py-2">Biaya USD</th>
                <th className="text-right py-2">AI Tasks</th>
                <th className="text-right py-2">Intake</th>
                <th className="text-right py-2">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {holding.companies.map((c) => (
                <tr key={c.companyId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 font-medium">{c.companyName}</td>
                  <td className="py-2 text-right">{c.activeModules}</td>
                  <td className="py-2 text-right font-mono">{fmt(c.totalRequests)}</td>
                  <td className="py-2 text-right">
                    <span className={c.avgSuccessRate >= 80 ? "text-green-600" : c.avgSuccessRate > 0 ? "text-yellow-600" : "text-gray-400"}>
                      {c.avgSuccessRate > 0 ? `${c.avgSuccessRate}%` : "—"}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono text-xs">${c.estimatedCostUsd}</td>
                  <td className="py-2 text-right">{fmt(c.aiTasks)}</td>
                  <td className="py-2 text-right">{fmt(c.intakeSessions)}</td>
                  <td className="py-2 text-right">
                    <span className={c.freshnessScore >= 75 ? "text-green-600" : c.freshnessScore >= 25 ? "text-yellow-600" : "text-gray-400"}>
                      {c.freshnessScore}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AiOperationsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(false);

  const [registry, setRegistry] = useState<RegistryData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [quality, setQuality] = useState<QualityData | null>(null);
  const [failures, setFailures] = useState<FailureData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [holding, setHolding] = useState<HoldingData | null>(null);

  const role = user?.role;
  const isSuperAdmin = role === "super_admin";

  if (!user || (role !== "super_admin" && role !== "company_admin" && role !== "owner" && role !== "supervisor")) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <p className="text-4xl">🔒</p>
        <p className="font-semibold text-lg">Akses Ditolak</p>
        <p className="text-muted-foreground text-sm">Halaman ini memerlukan minimal role company_admin.</p>
        <Button variant="outline" onClick={() => navigate("/")}>Kembali ke Dashboard</Button>
      </div>
    );
  }

  async function loadTab(tab: TabId) {
    setActiveTab(tab);
    setLoading(true);
    try {
      if (tab === "overview") {
        const [h, r] = await Promise.all([
          apiFetch<HealthData>("/ai-ops/health"),
          apiFetch<RegistryData>("/ai-ops/registry"),
        ]);
        setHealth(h);
        setRegistry(r);
      } else if (tab === "registry" && !registry) {
        setRegistry(await apiFetch<RegistryData>("/ai-ops/registry"));
      } else if (tab === "analytics") {
        setAnalytics(await apiFetch<AnalyticsData>("/ai-ops/analytics"));
      } else if (tab === "quality") {
        setQuality(await apiFetch<QualityData>("/ai-ops/quality"));
      } else if (tab === "failures") {
        setFailures(await apiFetch<FailureData>("/ai-ops/failures"));
      } else if (tab === "leaderboard") {
        setLeaderboard(await apiFetch<LeaderboardData>("/ai-ops/leaderboard"));
      } else if (tab === "holding" && isSuperAdmin) {
        setHolding(await apiFetch<HoldingData>("/ai-ops/holding"));
      }
    } catch (err) {
      toast({ title: "Gagal memuat data", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (!health && !registry && !loading) {
    loadTab("overview");
  }

  const visibleTabs = TABS.filter((t) => !t.superAdminOnly || isSuperAdmin);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              🤖 AI Operations Center
              <Badge variant="outline" className="text-xs">Sprint 10B-4</Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Monitoring & observability untuk semua modul AI
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadTab(activeTab)}
              disabled={loading}
            >
              ↻ Refresh
            </Button>
            {isSuperAdmin && (
              <Badge className="bg-purple-100 text-purple-800 border-purple-200">super_admin</Badge>
            )}
          </div>
        </div>

        <div className="flex gap-1 mt-4 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => loadTab(tab.id as TabId)}
              className={`px-4 py-1.5 rounded-t text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {tab.label}
              {tab.superAdminOnly && <span className="ml-1 text-xs opacity-60">★</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {activeTab === "overview" && <OverviewTab health={health} registry={registry} />}
        {activeTab === "registry" && <RegistryTab registry={registry} />}
        {activeTab === "analytics" && <AnalyticsTab analytics={analytics} />}
        {activeTab === "quality" && <QualityTab quality={quality} />}
        {activeTab === "failures" && <FailuresTab failures={failures} />}
        {activeTab === "leaderboard" && <LeaderboardTab leaderboard={leaderboard} />}
        {activeTab === "holding" && isSuperAdmin && <HoldingTab holding={holding} />}
      </div>
    </div>
  );
}
