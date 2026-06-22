import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Truck, AlertTriangle, CheckCircle, Wrench, TrendingUp, TrendingDown,
  RefreshCw, Send, Zap, Activity, BarChart2, Navigation, Shield,
  ChevronRight, User, Fuel, FileWarning, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const API = "/api";

function useFleetStats() {
  return useQuery({
    queryKey: ["fleet-units-stats"],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/units`, { credentials: "include" });
      const data = await r.json() as { data: Array<{ status: string }> };
      const units = data.data ?? [];
      return {
        total: units.length,
        available: units.filter((u) => u.status === "available").length,
        onRoute: units.filter((u) => u.status === "on_route").length,
        maintenance: units.filter((u) => u.status === "maintenance").length,
        inactive: units.filter((u) => u.status === "inactive").length,
      };
    },
    refetchInterval: 60000,
  });
}

function useRiskScores() {
  return useQuery({
    queryKey: ["fleet-risk-scores"],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/risk-scores`, { credentials: "include" });
      const d = await r.json() as { data: Array<Record<string, unknown>> };
      return d.data ?? [];
    },
  });
}

function useCostSummary() {
  return useQuery({
    queryKey: ["fleet-cost-summary"],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/cost-per-km/summary`, { credentials: "include" });
      const d = await r.json() as { data: Array<Record<string, unknown>>; bestUnit?: Record<string, unknown>; worstUnit?: Record<string, unknown> };
      return d;
    },
  });
}

function useDocAlerts() {
  return useQuery({
    queryKey: ["fleet-doc-alerts"],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/documents?status=expiring_soon`, { credentials: "include" });
      const d = await r.json() as { data: Array<Record<string, unknown>> };
      return d.data ?? [];
    },
  });
}

function useMaintenanceAlerts() {
  return useQuery({
    queryKey: ["fleet-maintenance-overdue"],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/maintenance?status=pending`, { credentials: "include" });
      const d = await r.json() as { data: Array<Record<string, unknown>> };
      const pending = d.data ?? [];
      return pending.filter((m) => {
        const scheduled = m.scheduled_date as string;
        if (!scheduled) return false;
        return new Date(scheduled) < new Date();
      });
    },
  });
}

function useDriverLeaderboard() {
  return useQuery({
    queryKey: ["fleet-driver-leaderboard"],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/drivers`, { credentials: "include" });
      const d = await r.json() as { data: Array<Record<string, unknown>> };
      return d.data ?? [];
    },
  });
}

function riskColor(level: string) {
  if (level === "LOW") return "text-green-600 bg-green-50 border-green-200";
  if (level === "MEDIUM") return "text-yellow-600 bg-yellow-50 border-yellow-200";
  if (level === "HIGH") return "text-orange-600 bg-orange-50 border-orange-200";
  return "text-red-600 bg-red-50 border-red-200";
}

function riskBadge(level: string) {
  const map: Record<string, string> = {
    LOW: "bg-green-100 text-green-700",
    MEDIUM: "bg-yellow-100 text-yellow-700",
    HIGH: "bg-orange-100 text-orange-700",
    CRITICAL: "bg-red-100 text-red-700",
  };
  return map[level] ?? "bg-gray-100 text-gray-700";
}

export default function FleetDashboardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const stats = useFleetStats();
  const risks = useRiskScores();
  const cost = useCostSummary();
  const docAlerts = useDocAlerts();
  const maintAlerts = useMaintenanceAlerts();
  const drivers = useDriverLeaderboard();

  const riskData = (risks.data ?? []) as Array<Record<string, unknown>>;
  const highRiskCount = riskData.filter((r) => r.risk_level === "HIGH" || r.risk_level === "CRITICAL").length;

  const costData = (cost.data?.data ?? []) as Array<Record<string, unknown>>;
  const latestCost = costData[0];
  const avgCpk = latestCost?.avg_cost_per_km ? Number(latestCost.avg_cost_per_km) : null;

  const refreshRisk = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/fleet/risk-scores/refresh`, { method: "POST", credentials: "include" });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Risk scores diperbarui" });
      qc.invalidateQueries({ queryKey: ["fleet-risk-scores"] });
    },
    onError: () => toast({ title: "Gagal refresh risk", variant: "destructive" }),
  });

  const sendReport = useMutation({
    mutationFn: async (type: string) => {
      const r = await fetch(`${API}/fleet/reports/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reportType: type }),
      });
      return r.json();
    },
    onSuccess: (data) => {
      const d = data as { sent?: number; failed?: number };
      toast({ title: `Laporan terkirim ke ${d.sent ?? 0} penerima, gagal: ${d.failed ?? 0}` });
    },
    onError: () => toast({ title: "Gagal kirim laporan WA", variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 text-blue-600" />
            Fleet Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Mission Control — Armada, Risiko & Biaya</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refreshRisk.mutate()} disabled={refreshRisk.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshRisk.isPending ? "animate-spin" : ""}`} />
            Refresh Risk
          </Button>
          <Button size="sm" onClick={() => sendReport.mutate("daily_fleet_summary")} disabled={sendReport.isPending}>
            <Send className="h-4 w-4 mr-1" />
            Kirim Laporan WA
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Total Unit", value: stats.data?.total ?? "–", icon: Truck, color: "text-blue-600", bg: "bg-blue-50", href: "/fleet/units" },
          { label: "Tersedia", value: stats.data?.available ?? "–", icon: CheckCircle, color: "text-green-600", bg: "bg-green-50", href: "/fleet/units" },
          { label: "Di Jalan", value: stats.data?.onRoute ?? "–", icon: Navigation, color: "text-indigo-600", bg: "bg-indigo-50", href: "/fleet/utilization" },
          { label: "Servis", value: stats.data?.maintenance ?? "–", icon: Wrench, color: "text-orange-600", bg: "bg-orange-50", href: "/fleet/maintenance" },
          { label: "Risiko Tinggi", value: highRiskCount, icon: Shield, color: "text-red-600", bg: "bg-red-50", href: "/fleet/risk" },
          { label: "Avg Cost/KM", value: avgCpk != null ? `Rp ${Math.round(avgCpk).toLocaleString("id-ID")}` : "–", icon: BarChart2, color: "text-purple-600", bg: "bg-purple-50", href: "/fleet/cost" },
        ].map((card) => (
          <Link key={card.label} href={card.href}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center mb-2`}>
                  <card.icon className={`h-4 w-4 ${card.color}`} />
                </div>
                <div className="text-xl font-bold">{card.value}</div>
                <div className="text-xs text-muted-foreground">{card.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Risk Scorecard */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-red-500" />
              Risk Scorecard
            </CardTitle>
            <Link href="/fleet/risk">
              <Button variant="ghost" size="sm" className="text-xs">
                Lihat semua <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {risks.isLoading && <div className="text-sm text-muted-foreground">Memuat...</div>}
            {!risks.isLoading && riskData.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">
                Belum ada data risiko. Klik "Refresh Risk" untuk menghitung.
              </div>
            )}
            {riskData.slice(0, 8).map((r) => (
              <div key={String(r.id)} className={`flex items-center justify-between p-2 rounded-lg border text-sm ${riskColor(r.risk_level as string)}`}>
                <div className="flex items-center gap-2">
                  <Truck className="h-3.5 w-3.5" />
                  <span className="font-medium">{String(r.unit_number)}</span>
                  <span className="text-xs opacity-70">{String(r.plate_number)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono">{Math.round(Number(r.overall_score))}/100</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${riskBadge(r.risk_level as string)}`}>
                    {String(r.risk_level)}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Alerts Panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Alert Aktif
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Doc expiring alerts */}
            {(docAlerts.data ?? []).slice(0, 3).map((d, i) => (
              <div key={i} className="flex items-start gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
                <FileWarning className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-yellow-800">Dokumen Hampir Expired</div>
                  <div className="text-yellow-700 text-xs">{String((d as Record<string, unknown>).document_type ?? "")} — {String((d as Record<string, unknown>).unit_number ?? "")}</div>
                </div>
              </div>
            ))}
            {/* Maintenance overdue */}
            {(maintAlerts.data ?? []).slice(0, 3).map((m, i) => (
              <div key={i} className="flex items-start gap-2 p-2 bg-orange-50 border border-orange-200 rounded-lg text-sm">
                <Wrench className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-orange-800">Servis Tertunggak</div>
                  <div className="text-orange-700 text-xs">{String((m as Record<string, unknown>).maintenance_type ?? "")} — Terjadwal: {String((m as Record<string, unknown>).scheduled_date ?? "")?.slice(0, 10)}</div>
                </div>
              </div>
            ))}
            {/* HIGH/CRITICAL risk */}
            {riskData.filter((r) => r.risk_level === "CRITICAL").slice(0, 2).map((r, i) => (
              <div key={i} className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-red-800">Unit CRITICAL Risk</div>
                  <div className="text-red-700 text-xs">{String(r.unit_number)} — Score: {Math.round(Number(r.overall_score))}/100</div>
                </div>
              </div>
            ))}
            {(docAlerts.data ?? []).length === 0 && (maintAlerts.data ?? []).length === 0 && highRiskCount === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                Tidak ada alert aktif
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost per KM Trend */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-purple-500" />
              Cost per KM — Tren Bulanan
            </CardTitle>
            <Link href="/fleet/cost">
              <Button variant="ghost" size="sm" className="text-xs">
                Detail <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {cost.isLoading && <div className="text-sm text-muted-foreground">Memuat...</div>}
            {costData.length === 0 && !cost.isLoading && (
              <div className="text-sm text-muted-foreground text-center py-4">
                Belum ada data cost. Jalankan recompute di halaman Cost/KM.
              </div>
            )}
            <div className="space-y-2">
              {costData.slice(0, 6).map((c, i) => {
                const cpk = Number(c.avg_cost_per_km ?? 0);
                const maxCpk = Math.max(...costData.map((x) => Number(x.avg_cost_per_km ?? 0)), 1);
                const pct = Math.round((cpk / maxCpk) * 100);
                return (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="text-xs text-muted-foreground w-16 shrink-0">{String(c.period_month)}</span>
                    <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-purple-400 rounded transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-mono w-24 text-right">Rp {Math.round(cpk).toLocaleString("id-ID")}/km</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Driver Leaderboard */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-blue-500" />
              Driver Leaderboard
            </CardTitle>
            <Link href="/fleet/drivers">
              <Button variant="ghost" size="sm" className="text-xs">
                Semua <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {(drivers.data as Array<Record<string, unknown>> ?? []).slice(0, 6).map((d, i) => (
              <div key={i} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                  <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                    {String(d.full_name ?? "?").charAt(0)}
                  </div>
                  <span className="font-medium truncate max-w-[120px]">{String(d.full_name ?? "–")}</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {String(d.status ?? "active")}
                </Badge>
              </div>
            ))}
            {(drivers.data as Array<Record<string, unknown>> ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">Belum ada data pengemudi</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* WA Report Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4 text-green-500" />
            Kirim Laporan WhatsApp ke Tim
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { type: "daily_fleet_summary", label: "Ringkasan Harian", icon: Activity },
              { type: "critical_alert", label: "Critical Alert", icon: AlertTriangle },
              { type: "weekly_performance", label: "Performa Mingguan", icon: TrendingUp },
              { type: "maintenance_approval", label: "Approval Servis", icon: Wrench },
            ].map((btn) => (
              <Button
                key={btn.type}
                variant="outline"
                size="sm"
                onClick={() => sendReport.mutate(btn.type)}
                disabled={sendReport.isPending}
                className="flex flex-col h-auto py-3 gap-1"
              >
                <btn.icon className="h-4 w-4" />
                <span className="text-xs">{btn.label}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
