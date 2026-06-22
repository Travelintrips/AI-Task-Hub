import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Shield, RefreshCw, AlertTriangle, CheckCircle, Truck, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const API = "/api";

type RiskRow = {
  id: number;
  fleet_unit_id: number;
  unit_number: string;
  plate_number: string;
  doc_score: number;
  maintenance_score: number;
  fuel_score: number;
  driver_score: number;
  age_score: number;
  utilization_score: number;
  overall_score: number;
  risk_level: string;
  risk_factors: string;
  refreshed_at: string;
};

function riskStyle(level: string) {
  const map: Record<string, string> = {
    LOW: "bg-green-50 border-green-200 text-green-800",
    MEDIUM: "bg-yellow-50 border-yellow-200 text-yellow-800",
    HIGH: "bg-orange-50 border-orange-200 text-orange-800",
    CRITICAL: "bg-red-50 border-red-200 text-red-800",
  };
  return map[level] ?? "bg-gray-50 border-gray-200";
}

function scoreBar(score: number, label: string) {
  const color = score >= 80 ? "bg-green-400" : score >= 60 ? "bg-yellow-400" : score >= 40 ? "bg-orange-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${Math.round(score)}%` }} />
      </div>
      <span className="w-6 text-right font-mono">{Math.round(score)}</span>
    </div>
  );
}

function RiskCard({ row }: { row: RiskRow }) {
  const [expanded, setExpanded] = useState(false);
  const factors: string[] = (() => {
    try { return JSON.parse(row.risk_factors) as string[]; } catch { return []; }
  })();

  return (
    <Card className={`border ${riskStyle(row.risk_level)}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            <div>
              <div className="font-semibold">{row.unit_number}</div>
              <div className="text-xs opacity-70">{row.plate_number}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{Math.round(row.overall_score)}</span>
            <span className="text-xs opacity-70">/100</span>
            <Badge className={`text-xs ${
              row.risk_level === "LOW" ? "bg-green-100 text-green-700 border-green-200" :
              row.risk_level === "MEDIUM" ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
              row.risk_level === "HIGH" ? "bg-orange-100 text-orange-700 border-orange-200" :
              "bg-red-100 text-red-700 border-red-200"
            }`} variant="outline">
              {row.risk_level}
            </Badge>
          </div>
        </div>

        {factors.length > 0 && (
          <div className="text-xs mb-3 space-y-1">
            {factors.slice(0, 2).map((f, i) => (
              <div key={i} className="flex items-center gap-1 opacity-80">
                <AlertTriangle className="h-3 w-3" />
                {f}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs flex items-center gap-1 opacity-60 hover:opacity-100"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Sembunyikan" : "Detail komponen"}
        </button>

        {expanded && (
          <div className="mt-3 space-y-1.5 border-t pt-3">
            {scoreBar(row.doc_score, "Dokumen")}
            {scoreBar(row.maintenance_score, "Servis")}
            {scoreBar(row.fuel_score, "BBM")}
            {scoreBar(row.driver_score, "Pengemudi")}
            {scoreBar(row.age_score, "Kondisi")}
            {scoreBar(row.utilization_score, "Utilisasi")}
            <div className="text-xs text-muted-foreground pt-1">
              Diperbarui: {new Date(row.refreshed_at).toLocaleString("id-ID")}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FleetRiskPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("ALL");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-risk-scores"],
    queryFn: async () => {
      const r = await fetch(`${API}/fleet/risk-scores`, { credentials: "include" });
      const d = await r.json() as { data: RiskRow[] };
      return d.data ?? [];
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/fleet/risk-scores/refresh`, { method: "POST", credentials: "include" });
      return r.json();
    },
    onSuccess: (d) => {
      const res = d as { processed?: number };
      toast({ title: `${res.processed ?? 0} unit diperbarui` });
      qc.invalidateQueries({ queryKey: ["fleet-risk-scores"] });
    },
    onError: () => toast({ title: "Gagal refresh risk", variant: "destructive" }),
  });

  const rows = data ?? [];
  const filtered = filter === "ALL" ? rows : rows.filter((r) => r.risk_level === filter);

  const counts = {
    ALL: rows.length,
    LOW: rows.filter((r) => r.risk_level === "LOW").length,
    MEDIUM: rows.filter((r) => r.risk_level === "MEDIUM").length,
    HIGH: rows.filter((r) => r.risk_level === "HIGH").length,
    CRITICAL: rows.filter((r) => r.risk_level === "CRITICAL").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-red-600" />
            Fleet Risk Score
          </h1>
          <p className="text-muted-foreground text-sm">Skor risiko per unit kendaraan</p>
        </div>
        <div className="flex gap-2">
          <Link href="/fleet/dashboard">
            <Button variant="outline" size="sm">← Dashboard</Button>
          </Link>
          <Button size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refresh.isPending ? "animate-spin" : ""}`} />
            Refresh Semua
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((level) => (
          <button
            key={level}
            onClick={() => setFilter(level)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              filter === level
                ? level === "CRITICAL" ? "bg-red-600 text-white border-red-600" :
                  level === "HIGH" ? "bg-orange-500 text-white border-orange-500" :
                  level === "MEDIUM" ? "bg-yellow-500 text-white border-yellow-500" :
                  level === "LOW" ? "bg-green-600 text-white border-green-600" :
                  "bg-primary text-white border-primary"
                : "bg-muted border-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {level} ({counts[level as keyof typeof counts]})
          </button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Memuat data risiko...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium">Belum ada data risiko</div>
          <div className="text-sm">Klik "Refresh Semua" untuk menghitung risk score semua unit</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((row) => <RiskCard key={row.id} row={row} />)}
      </div>
    </div>
  );
}
