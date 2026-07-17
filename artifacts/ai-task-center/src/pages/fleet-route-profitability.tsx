import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Navigation, RefreshCw, TrendingUp, TrendingDown, Trophy, AlertCircle } from "lucide-react";
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

type RouteRow = {
  id: number;
  route: string;
  period_month: string;
  total_trips: number;
  total_km: number;
  vehicle_cost: number;
  revenue: number;
  margin: number;
  margin_pct: number;
  top_unit_number: string | null;
};

function fmtRp(n: number) {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

export default function FleetRouteProfitabilityPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useState(currentPeriod);

  const { data, isLoading } = useQuery({
    queryKey: ["fleet-route-profitability", period],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/route-profitability?period=${period}`, { headers: authHeaders() });
      const d = await r.json() as {
        data: RouteRow[];
        mostProfitable?: RouteRow;
        leastProfitable?: RouteRow;
      };
      return d;
    },
  });

  const recompute = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/fleet/route-profitability/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ period }),
      });
      return r.json();
    },
    onSuccess: (d) => {
      const res = d as { processed?: number };
      toast({ title: `${res.processed ?? 0} rute dihitung untuk ${period}` });
      qc.invalidateQueries({ queryKey: ["fleet-route-profitability"] });
    },
    onError: () => toast({ title: "Gagal recompute", variant: "destructive" }),
  });

  const rows = data?.data ?? [];
  const best = data?.mostProfitable;
  const worst = data?.leastProfitable;
  const maxMargin = Math.max(...rows.map((r) => Math.abs(r.margin_pct)), 1);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Navigation className="h-6 w-6 text-indigo-600" />
            Route Profitability
          </h1>
          <p className="text-muted-foreground text-sm">Profitabilitas per rute berdasarkan biaya & pendapatan</p>
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

      {/* Best/Worst highlight */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4 flex items-center gap-4">
            <Trophy className="h-8 w-8 text-green-600" />
            <div>
              <div className="text-xs text-green-700 font-medium">Rute Paling Profitabel</div>
              <div className="font-bold text-green-800 truncate max-w-[220px]">{best?.route ?? "–"}</div>
              <div className="text-sm text-green-700">
                {best ? `Margin: ${Math.round(best.margin_pct)}% · ${best.total_trips} trips` : "Belum ada data"}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4 flex items-center gap-4">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <div>
              <div className="text-xs text-red-700 font-medium">Rute Paling Tidak Profitabel</div>
              <div className="font-bold text-red-800 truncate max-w-[220px]">{worst?.route ?? "–"}</div>
              <div className="text-sm text-red-700">
                {worst ? `Margin: ${Math.round(worst.margin_pct)}% · ${worst.total_trips} trips` : "Belum ada data"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Route table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Semua Rute — {period}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Memuat...</div>}
          {!isLoading && rows.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <Navigation className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <div className="font-medium">Belum ada data rute</div>
              <div className="text-sm">Klik "Hitung Ulang" untuk mengolah data utilisasi</div>
            </div>
          )}
          <div className="space-y-3">
            {rows.map((row) => {
              const pct = Math.round((Math.abs(row.margin_pct) / maxMargin) * 100);
              const positive = row.margin_pct >= 0;
              return (
                <div key={row.id} className="p-3 border rounded-lg space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{row.route}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.total_trips} trips · {Math.round(row.total_km).toLocaleString("id-ID")} km
                        {row.top_unit_number && ` · Unit: ${row.top_unit_number}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold text-sm ${positive ? "text-green-600" : "text-red-600"}`}>
                        {positive ? "+" : ""}{Math.round(row.margin_pct)}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {positive ? <TrendingUp className="h-3 w-3 inline text-green-500" /> : <TrendingDown className="h-3 w-3 inline text-red-500" />}
                      </div>
                    </div>
                  </div>

                  {/* Margin bar */}
                  <div className="h-2 bg-muted rounded overflow-hidden">
                    <div
                      className={`h-full rounded transition-all ${positive ? "bg-green-400" : "bg-red-400"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>Biaya: <span className="text-foreground font-medium">{fmtRp(row.vehicle_cost)}</span></div>
                    <div>Revenue: <span className="text-foreground font-medium">{fmtRp(row.revenue)}</span></div>
                    <div>Margin: <span className={`font-medium ${positive ? "text-green-600" : "text-red-600"}`}>{fmtRp(row.margin)}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
