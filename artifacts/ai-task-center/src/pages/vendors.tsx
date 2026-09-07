import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, Truck, Star, AlertTriangle, ChevronRight, TrendingUp,
  Shield, FileWarning, Clock, RefreshCw, Package,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const GRADE_COLOR: Record<string, string> = {
  A: "bg-green-100 text-green-800",
  B: "bg-blue-100 text-blue-800",
  C: "bg-yellow-100 text-yellow-800",
  D: "bg-orange-100 text-orange-800",
  F: "bg-red-100 text-red-800",
  "?": "bg-gray-100 text-gray-500",
};

const RISK_COLOR: Record<string, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-red-100 text-red-800",
  blacklisted: "bg-gray-900 text-white",
};

export default function VendorsPage() {
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");

  const params = new URLSearchParams({ limit: "100" });
  if (serviceFilter !== "all") params.set("service_type", serviceFilter);
  if (gradeFilter !== "all") params.set("grade", gradeFilter);
  if (riskFilter !== "all") params.set("risk_tier", riskFilter);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["vendors", serviceFilter, gradeFilter, riskFilter],
    queryFn: () => apiFetch(`/vendors?${params}`),
  });

  const allVendors: any[] = data?.vendors ?? [];

  const filtered = allVendors.filter((v) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(v.name ?? "").toLowerCase().includes(q) ||
      String(v.service_type ?? "").toLowerCase().includes(q) ||
      String(v.country ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            Vendor Memory Center
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manajemen profil, performa, risiko, dan dokumen vendor
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={serviceFilter} onValueChange={setServiceFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Tipe Layanan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Layanan</SelectItem>
            <SelectItem value="trucking">Trucking</SelectItem>
            <SelectItem value="sea_freight">Sea Freight</SelectItem>
            <SelectItem value="air_freight">Air Freight</SelectItem>
            <SelectItem value="customs">Customs</SelectItem>
            <SelectItem value="warehouse">Warehouse</SelectItem>
            <SelectItem value="courier">Courier</SelectItem>
          </SelectContent>
        </Select>

        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Grade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Grade</SelectItem>
            <SelectItem value="A">Grade A</SelectItem>
            <SelectItem value="B">Grade B</SelectItem>
            <SelectItem value="C">Grade C</SelectItem>
            <SelectItem value="D">Grade D</SelectItem>
            <SelectItem value="F">Grade F</SelectItem>
          </SelectContent>
        </Select>

        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Risk Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Risk</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Vendor</div>
          <div className="text-2xl font-bold">{allVendors.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Grade A/B</div>
          <div className="text-2xl font-bold text-green-600">
            {allVendors.filter((v) => ["A", "B"].includes(v.latestSnapshot?.performanceGrade ?? "")).length}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Risiko Tinggi</div>
          <div className="text-2xl font-bold text-red-600">
            {allVendors.filter((v) => ["high", "blacklisted"].includes(v.activeRisk?.tier ?? "")).length}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Tampil</div>
          <div className="text-2xl font-bold">{filtered.length}</div>
        </Card>
      </div>

      {/* Vendor List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" />
          Memuat data vendor...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <div>Tidak ada vendor ditemukan</div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((vendor: any) => {
            const grade = vendor.latestSnapshot?.performanceGrade ?? "?";
            const readiness = vendor.latestSnapshot?.readinessScore;
            const riskTier = vendor.activeRisk?.tier ?? vendor.latestSnapshot?.riskTier;

            return (
              <Link key={vendor.id} href={`/vendors/${vendor.id}/memory`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer border hover:border-primary/40">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Grade Badge */}
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0 ${GRADE_COLOR[grade] ?? "bg-gray-100"}`}>
                        {grade}
                      </div>

                      {/* Main Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold truncate">{vendor.name}</span>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {vendor.service_type ?? "—"}
                          </Badge>
                          {vendor.country && (
                            <span className="text-xs text-muted-foreground shrink-0">{vendor.country}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                          {readiness != null && (
                            <span className="flex items-center gap-1">
                              <TrendingUp className="h-3 w-3" />
                              Readiness: {readiness}%
                            </span>
                          )}
                          {vendor.activeRisk?.riskScore != null && (
                            <span className="flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              Risk Score: {vendor.activeRisk.riskScore}
                            </span>
                          )}
                          {vendor.phone && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {vendor.phone}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Risk & Status */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {riskTier && (
                          <Badge className={`text-xs ${RISK_COLOR[riskTier] ?? "bg-gray-100"}`}>
                            {riskTier === "blacklisted" ? (
                              <AlertTriangle className="h-3 w-3 mr-1" />
                            ) : null}
                            {riskTier}
                          </Badge>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
