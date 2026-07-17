import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { BarChart2, RefreshCw, TrendingUp, TrendingDown, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const API = "/api";

function getToken(): string {
  return localStorage.getItem("ai_task_center_token") ?? "";
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type CostRow = {
  id: number;
  fleet_unit_id: number;
  unit_number: string;
  plate_number: string;
  period_month: string;
  total_km: number;
  fuel_cost: number;
  maintenance_cost: number;
  tire_cost: number;
  total_cost: number;
  cost_per_km: number;
  revenue_generated: number;
  gross_profit: number;
  profit_margin_pct: number;
};

type SummaryRow = {
  period_month: string;
  unit_count: number;
  total_km: number;
  total_cost: number;
  avg_cost_per_km: number;
  total_revenue: number;
  total_profit: number;
  avg_margin_pct: number;
};

function fmtRp(n: number) {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

export default function FleetCostPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useState(currentPeriod);

  const summary = useQuery({
    queryKey: ["fleet-cost-summary"],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/cost-per-km/summary`, { headers: authHeaders() });
      const d = await r.json() as { data: SummaryRow[]; bestUnit?: CostRow; worstUnit?: CostRow };
      return d;
    },
  });

  const detail = useQuery({
    queryKey: ["fleet-cost-detail", period],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/cost-per-km?period=${period}`, { headers: authHeaders() });
      const d = await r.json() as { data: CostRow[] };
      return d.data ?? [];
    },
  });

  const recompute = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/fleet/cost-per-km/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ period }),
      });
      return r.json();
    },
    onSuccess: (d) => {
      const res = d as { processed?: number };
      toast({ title: `${res.processed ?? 0} unit dihitung ulang untuk periode ${period}` });
      qc.invalidateQueries({ queryKey: ["fleet-cost-summary"] });
      qc.invalidateQueries({ queryKey: ["fleet-cost-detail"] });
    },
    onError: () => toast({ title: "Gagal recompute", variant: "destructive" }),
  });

  const summaryRows = summary.data?.data ?? [];
  const detailRows = detail.data ?? [];
  const best = summary.data?.bestUnit;
  const worst = summary.data?.worstUnit;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-purple-600" />
            Cost per KM
          </h1>
          <p className="text-muted-foreground text-sm">Biaya operasional per kilometer per unit</p>
        </div>
        <div className="flex gap-2 items-center">
          <Link href="/fleet/dashboard">
            <Button variant="outline" size="sm">← Dashboard</Button>
          </Link>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm"
          />
          <Button size="sm" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1 ${recompute.isPending ? "animate-spin" : ""}`} />
            Hitung Ulang
          </Button>
        </div>
      </div>

      {/* Best/Worst */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4 flex items-center gap-4">
            <TrendingDown className="h-8 w-8 text-green-600" />
            <div>
              <div className="text-xs text-green-700 font-medium">Unit Paling Efisien (bulan ini)</div>
              <div className="font-bold text-green-800">{best ? String(best.unit_number) : "–"}</div>
              <div className="text-sm text-green-700">{best ? fmtRp(Number(best.cost_per_km)) + "/km" : "Belum ada data"}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4 flex items-center gap-4">
            <TrendingUp className="h-8 w-8 text-red-600" />
            <div>
              <div className="text-xs text-red-700 font-medium">Unit Paling Boros (bulan ini)</div>
              <div className="font-bold text-red-800">{worst ? String(worst.unit_number) : "–"}</div>
              <div className="text-sm text-red-700">{worst ? fmtRp(Number(worst.cost_per_km)) + "/km" : "Belum ada data"}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Trend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tren Bulanan (12 bulan terakhir)</CardTitle>
        </CardHeader>
        <CardContent>
          {summaryRows.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Belum ada data. Klik "Hitung Ulang" untuk mengisi data bulan ini.
            </div>
          )}
          <div className="space-y-2">
            {summaryRows.slice(0, 12).map((row, i) => {
              const cpk = Number(row.avg_cost_per_km ?? 0);
              const maxCpk = Math.max(...summaryRows.map((r) => Number(r.avg_cost_per_km ?? 0)), 1);
              const pct = Math.round((cpk / maxCpk) * 100);
              const margin = Number(row.avg_margin_pct ?? 0);
              return (
                <div key={i} className="grid grid-cols-12 items-center gap-2 text-sm">
                  <span className="col-span-2 text-xs text-muted-foreground">{row.period_month}</span>
                  <div className="col-span-5 h-5 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-purple-400 rounded" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="col-span-3 text-xs font-mono text-right">{fmtRp(cpk)}/km</span>
                  <span className={`col-span-2 text-xs text-right font-medium ${margin >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {margin >= 0 ? "+" : ""}{Math.round(margin)}%
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Per Unit Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per Unit — {period}</CardTitle>
        </CardHeader>
        <CardContent>
          {detailRows.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Belum ada data untuk periode ini. Klik "Hitung Ulang".
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2">Unit</th>
                  <th className="text-right py-2">KM</th>
                  <th className="text-right py-2">BBM</th>
                  <th className="text-right py-2">Servis</th>
                  <th className="text-right py-2">Total Cost</th>
                  <th className="text-right py-2 font-bold">Cost/KM</th>
                  <th className="text-right py-2">Revenue</th>
                  <th className="text-right py-2">Margin</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-muted/30">
                    <td className="py-2">
                      <div className="font-medium">{row.unit_number}</div>
                      <div className="text-xs text-muted-foreground">{row.plate_number}</div>
                    </td>
                    <td className="text-right py-2 font-mono text-xs">{Math.round(row.total_km).toLocaleString("id-ID")}</td>
                    <td className="text-right py-2 text-xs">{fmtRp(row.fuel_cost)}</td>
                    <td className="text-right py-2 text-xs">{fmtRp(row.maintenance_cost)}</td>
                    <td className="text-right py-2 text-xs font-medium">{fmtRp(row.total_cost)}</td>
                    <td className="text-right py-2 font-bold text-purple-600">{fmtRp(row.cost_per_km)}</td>
                    <td className="text-right py-2 text-xs">{fmtRp(row.revenue_generated)}</td>
                    <td className={`text-right py-2 text-xs font-medium ${row.profit_margin_pct >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {Math.round(row.profit_margin_pct)}%
                    </td>
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
