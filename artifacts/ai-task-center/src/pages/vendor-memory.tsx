import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, RefreshCw, Brain, Shield, TrendingUp, FileText, Star,
  CheckCircle2, AlertCircle, Clock, Package, Truck, BadgeCheck,
  Plus, Trash2, AlertTriangle, BarChart2, ChevronDown, ChevronRight,
  DollarSign, Globe,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const GRADE_COLOR: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-200",
  B: "bg-blue-100 text-blue-800 border-blue-200",
  C: "bg-yellow-100 text-yellow-800 border-yellow-200",
  D: "bg-orange-100 text-orange-800 border-orange-200",
  F: "bg-red-100 text-red-800 border-red-200",
  "?": "bg-gray-100 text-gray-500 border-gray-200",
};

const RISK_COLORS: Record<string, string> = {
  low: "text-green-600 bg-green-50",
  medium: "text-yellow-600 bg-yellow-50",
  high: "text-red-600 bg-red-50",
  blacklisted: "text-white bg-gray-900",
};

const RESPONSE_TIER_LABEL: Record<string, string> = {
  fast: "Cepat (< 2 jam)",
  medium: "Sedang (2–24 jam)",
  slow: "Lambat (> 24 jam)",
  unknown: "—",
};

const COMPLIANCE_STATUS: Record<string, { label: string; color: string }> = {
  compliant: { label: "Compliant", color: "text-green-600" },
  partial: { label: "Partial", color: "text-yellow-600" },
  incomplete: { label: "Incomplete", color: "text-orange-600" },
  non_compliant: { label: "Non-Compliant", color: "text-red-600" },
};

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string; icon?: React.ElementType; color?: string;
}) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{label}</div>
        {Icon && <Icon className={`h-4 w-4 ${color ?? "text-muted-foreground"}`} />}
      </div>
      <div className={`text-xl font-bold mt-1 ${color ?? ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function RiskBadge({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[tier] ?? "bg-gray-100 text-gray-600"}`}>
      {tier === "blacklisted" && <AlertTriangle className="h-3 w-3" />}
      {tier}
    </span>
  );
}

// ── Tab: Profile ──────────────────────────────────────────────────────────────

function ProfileTab({ memory }: { memory: any }) {
  const { vendor, supabasePerformance: perf, activeRisk, latestSnapshot, readinessScore, grade, missingDocs } = memory ?? {};
  if (!vendor) return <div className="text-muted-foreground py-8 text-center">Data vendor tidak ditemukan</div>;

  return (
    <div className="space-y-4">
      {/* Identity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Identitas Vendor</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">Nama</div><div className="font-medium">{vendor.name}</div></div>
          <div><div className="text-xs text-muted-foreground">Tipe Layanan</div><div className="font-medium">{vendor.service_type ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Negara</div><div className="font-medium">{vendor.country ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Email</div><div className="font-medium">{vendor.contact_email ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Telepon</div><div className="font-medium">{vendor.phone ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">PIC</div><div className="font-medium">{vendor.contact_person ?? "—"}</div></div>
          {vendor.eta_days_min != null && (
            <div><div className="text-xs text-muted-foreground">ETA</div><div className="font-medium">{vendor.eta_days_min}–{vendor.eta_days_max} hari</div></div>
          )}
        </CardContent>
      </Card>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Readiness Score" value={`${readinessScore ?? "—"}%`} icon={Star} color={readinessScore >= 70 ? "text-green-600" : readinessScore >= 50 ? "text-yellow-600" : "text-red-600"} />
        <StatCard label="Grade" value={grade ?? "?"} icon={BarChart2} color={grade === "A" || grade === "B" ? "text-green-600" : grade === "C" ? "text-yellow-600" : "text-red-600"} />
        <StatCard label="On-Time Rate" value={perf?.on_time_rate != null ? `${Number(perf.on_time_rate).toFixed(1)}%` : "—"} icon={Clock} />
        <StatCard label="Risk Tier" value={<RiskBadge tier={activeRisk?.tier ?? latestSnapshot?.riskTier ?? "—"} />} icon={Shield} />
      </div>

      {/* Missing Docs Alert */}
      {Array.isArray(missingDocs) && missingDocs.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-orange-50 border border-orange-200">
          <AlertCircle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-orange-800 text-sm">Dokumen Kurang</div>
            <div className="text-xs text-orange-700 mt-1">{missingDocs.join(", ")}</div>
          </div>
        </div>
      )}

      {/* Supabase Performance */}
      {perf && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Performa (Supabase)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            {[
              ["Grade", perf.vendor_grade],
              ["Recommendation Score", perf.recommendation_score != null ? Number(perf.recommendation_score).toFixed(1) : "—"],
              ["Total RFQ Invite", perf.total_rfq_invites],
              ["Total Submitted", perf.total_submitted],
              ["Total Selected", perf.total_selected],
              ["Cancel Rate", perf.cancel_rate != null ? `${Number(perf.cancel_rate).toFixed(1)}%` : "—"],
              ["Avg Response (jam)", perf.avg_response_hours != null ? Number(perf.avg_response_hours).toFixed(1) : "—"],
              ["Pod Completeness", perf.pod_completeness_score != null ? `${Number(perf.pod_completeness_score).toFixed(1)}%` : "—"],
            ].map(([label, val]) => (
              <div key={label as string}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-medium">{val ?? "—"}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Latest snapshot */}
      {latestSnapshot && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              AI Context Snapshot
              <Badge variant={latestSnapshot.isStale ? "destructive" : "secondary"} className="text-xs">
                {latestSnapshot.isStale ? "Stale" : `Freshness ${latestSnapshot.freshnessScore}%`}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{latestSnapshot.aiContextBlock}</p>
            <div className="text-xs text-muted-foreground mt-3">
              {latestSnapshot.createdAt && `Dibuat ${formatDistanceToNow(new Date(latestSnapshot.createdAt), { addSuffix: true })}`}
              {latestSnapshot.validUntil && ` · Berlaku hingga ${format(new Date(latestSnapshot.validUntil), "dd MMM yyyy")}`}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Performance ──────────────────────────────────────────────────────────

function PerformanceTab({ vendorId }: { vendorId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-performance", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/performance`),
  });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Memuat performa...</div>;
  if (!data) return null;

  const { supabasePerformance: perf, snapshots, readinessScore, grade, kpis } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Readiness Score" value={`${readinessScore ?? "—"}%`} icon={Star} color={readinessScore >= 70 ? "text-green-600" : "text-red-600"} />
        <StatCard label="Grade" value={grade ?? "?"} icon={BarChart2} />
        <StatCard label="Risk Tier" value={<RiskBadge tier={data.riskTier} />} icon={Shield} />
        <StatCard label="Snapshots" value={snapshots?.length ?? 0} icon={RefreshCw} />
      </div>

      {/* KPI Detail */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">KPI Detail</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {[
            ["On-Time Rate", kpis?.onTimeRate != null ? `${(kpis.onTimeRate * 100).toFixed(1)}%` : "—"],
            ["POD Completeness", kpis?.podCompletenessScore != null ? `${(kpis.podCompletenessScore * 100).toFixed(1)}%` : "—"],
            ["ETA Accuracy", kpis?.etaAccuracyScore != null ? `${(kpis.etaAccuracyScore * 100).toFixed(1)}%` : "—"],
            ["Cancel Rate", kpis?.cancelRate != null ? `${(kpis.cancelRate * 100).toFixed(1)}%` : "—"],
            ["Avg Response", kpis?.avgResponseHours != null ? `${Number(kpis.avgResponseHours).toFixed(1)} jam` : "—"],
            ["Win Rate RFQ", kpis?.rfqSubmitted ? `${((kpis.rfqSelected / kpis.rfqSubmitted) * 100).toFixed(1)}%` : "—"],
          ].map(([label, val]) => (
            <div key={label as string}>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="font-medium">{val}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Snapshot history */}
      {snapshots?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Riwayat Snapshot Performa</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {snapshots.map((snap: any) => (
              <div key={snap.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                <div>
                  <span className="font-medium">{snap.snapshot_date}</span>
                  <span className="text-muted-foreground ml-3">Score: {snap.performance_score ?? "—"} · Grade: {snap.performance_grade ?? "—"}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {snap.on_time_rate != null && `OTR: ${Number(snap.on_time_rate * 100).toFixed(0)}%`}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Pricing ──────────────────────────────────────────────────────────────

function PricingTab({ vendorId }: { vendorId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-pricing", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/pricing`),
  });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Memuat data harga...</div>;
  if (!data) return null;

  const { rateCard, rfqHistory, miniFormHistory, catalogPrices, stats } = data;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Penawaran" value={stats?.totalQuotations ?? 0} icon={DollarSign} />
        <StatCard label="Penawaran Menang" value={stats?.wonQuotations ?? 0} icon={Star} color="text-green-600" />
        <StatCard label="Win Rate" value={stats?.winRate != null ? `${(stats.winRate * 100).toFixed(1)}%` : "—"} icon={TrendingUp} />
        <StatCard label="Rata-rata Harga" value={stats?.avgFinal != null ? Number(stats.avgFinal).toLocaleString("id-ID") : "—"} sub={`${stats?.days ?? 90} hari terakhir`} icon={BarChart2} />
      </div>

      {/* Rate Card */}
      {rateCard?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Rate Card Aktif</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left py-1 pr-4">Mode</th>
                  <th className="text-left py-1 pr-4">Asal → Tujuan</th>
                  <th className="text-right py-1">Harga</th>
                </tr></thead>
                <tbody>
                  {rateCard.slice(0, 10).map((r: any) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-4">{r.transport_mode ?? "—"}</td>
                      <td className="py-1.5 pr-4 text-muted-foreground">{r.origin_city ?? "?"} → {r.destination_city ?? "?"}</td>
                      <td className="py-1.5 text-right font-mono">{r.base_price ? Number(r.base_price).toLocaleString("id-ID") : "—"} {r.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* RFQ History */}
      {rfqHistory?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Riwayat RFQ (30 hari terakhir)</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {rfqHistory.slice(0, 10).map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                <div>
                  <Badge variant={r.status === "selected" ? "default" : "secondary"} className="text-xs mr-2">{r.status}</Badge>
                  <span className="text-muted-foreground">{r.rfq_type ?? "rfq"}</span>
                </div>
                <span className="font-mono text-sm">{r.offered_price ? Number(r.offered_price).toLocaleString("id-ID") : "—"} {r.currency}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Catalog Prices */}
      {catalogPrices?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Katalog Produk/Layanan</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {catalogPrices.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                <div>
                  <span className="font-medium">{c.name}</span>
                  {c.kategori && <Badge variant="outline" className="ml-2 text-xs">{c.kategori}</Badge>}
                  {c.stock_status && <span className="text-xs text-muted-foreground ml-2">({c.stock_status})</span>}
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">{c.price_base ? Number(c.price_base).toLocaleString("id-ID") : "—"} {c.currency}</div>
                  {c.lead_time && <div className="text-xs text-muted-foreground">Lead: {c.lead_time}</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Capabilities ─────────────────────────────────────────────────────────

function CapabilitiesTab({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ serviceType: "", cargoType: "", vehicleTypes: "", originCities: "", destinationCities: "", certifications: "", notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["vendor-capabilities", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/capabilities`),
  });

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/vendors/${vendorId}/capabilities`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-capabilities", vendorId] });
      toast({ title: "Kapabilitas ditambahkan" });
      setShowAdd(false);
      setForm({ serviceType: "", cargoType: "", vehicleTypes: "", originCities: "", destinationCities: "", certifications: "", notes: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const delMutation = useMutation({
    mutationFn: (capId: number) => apiFetch(`/vendors/${vendorId}/capabilities/${capId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-capabilities", vendorId] }); toast({ title: "Kapabilitas dihapus" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Memuat kapabilitas...</div>;
  const { capabilities = [], vendor: vInfo, drivers = [], catalog = [] } = data ?? {};

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{capabilities.length} kapabilitas terdaftar</div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" />Tambah Kapabilitas
        </Button>
      </div>

      {/* Vendor base info from suppliers */}
      {vInfo && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Info Dasar (Suppliers)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Tipe Layanan</div><div>{vInfo.serviceType ?? "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Mode Didukung</div><div>{Array.isArray(vInfo.supportedModes) ? vInfo.supportedModes.join(", ") : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Truk Internal</div><div>{vInfo.hasInternalTruck ? "Ya" : "Tidak"}</div></div>
            <div><div className="text-xs text-muted-foreground">Driver</div><div>{drivers.length}</div></div>
          </CardContent>
        </Card>
      )}

      {/* Capabilities list */}
      {capabilities.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">Belum ada kapabilitas terdaftar</div>
      ) : (
        <div className="grid gap-3">
          {capabilities.map((cap: any) => (
            <Card key={cap.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2">
                      <Badge variant="outline">{cap.serviceType}</Badge>
                      {cap.cargoType && <Badge variant="secondary" className="text-xs">{cap.cargoType}</Badge>}
                      {cap.coldChain && <Badge className="text-xs bg-blue-100 text-blue-800">Cold Chain</Badge>}
                      {cap.dangerousGoods && <Badge className="text-xs bg-red-100 text-red-800">Dangerous Goods</Badge>}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2 text-xs text-muted-foreground">
                      {cap.vehicleTypes?.length > 0 && <div>🚛 {cap.vehicleTypes.join(", ")}</div>}
                      {cap.originCities?.length > 0 && <div>📍 {cap.originCities.slice(0, 3).join(", ")}</div>}
                      {cap.maxWeightKg && <div>⚖️ Max {cap.maxWeightKg} kg</div>}
                      {cap.certifications?.length > 0 && <div>🏅 {cap.certifications.join(", ")}</div>}
                      {cap.driverCount && <div>👤 {cap.driverCount} driver</div>}
                    </div>
                    {cap.notes && <div className="mt-1 text-xs text-muted-foreground italic">{cap.notes}</div>}
                    <div className="mt-1 text-xs text-muted-foreground">Source: {cap.source} · Confidence: {cap.confidenceScore}</div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => delMutation.mutate(cap.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Kapabilitas</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tipe Layanan *</Label>
              <Select value={form.serviceType} onValueChange={(v) => setForm((f) => ({ ...f, serviceType: v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih..." /></SelectTrigger>
                <SelectContent>
                  {["trucking","sea_freight","air_freight","customs","warehouse","courier"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Tipe Kargo</Label><Input value={form.cargoType} onChange={(e) => setForm((f) => ({ ...f, cargoType: e.target.value }))} placeholder="general, hazmat, cold_chain..." /></div>
            <div><Label className="text-xs">Tipe Kendaraan (pisah koma)</Label><Input value={form.vehicleTypes} onChange={(e) => setForm((f) => ({ ...f, vehicleTypes: e.target.value }))} placeholder="Tronton, Fuso, CDD" /></div>
            <div><Label className="text-xs">Kota Asal (pisah koma)</Label><Input value={form.originCities} onChange={(e) => setForm((f) => ({ ...f, originCities: e.target.value }))} placeholder="Jakarta, Surabaya" /></div>
            <div><Label className="text-xs">Sertifikasi (pisah koma)</Label><Input value={form.certifications} onChange={(e) => setForm((f) => ({ ...f, certifications: e.target.value }))} placeholder="ISO9001, IATA" /></div>
            <div><Label className="text-xs">Catatan</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Batal</Button>
            <Button disabled={!form.serviceType || addMutation.isPending} onClick={() => addMutation.mutate({
              serviceType: form.serviceType,
              cargoType: form.cargoType || undefined,
              vehicleTypes: form.vehicleTypes ? form.vehicleTypes.split(",").map((s) => s.trim()) : undefined,
              originCities: form.originCities ? form.originCities.split(",").map((s) => s.trim()) : undefined,
              certifications: form.certifications ? form.certifications.split(",").map((s) => s.trim()) : undefined,
              notes: form.notes || undefined,
            })}>
              {addMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: Documents ────────────────────────────────────────────────────────────

function DocumentsTab({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ documentType: "", fileName: "", fileUrl: "", expiryDate: "", notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["vendor-documents", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/documents`),
  });

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/vendors/${vendorId}/documents`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-documents", vendorId] }); toast({ title: "Dokumen terdaftar" }); setShowAdd(false); setForm({ documentType: "", fileName: "", fileUrl: "", expiryDate: "", notes: "" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ docId, isVerified }: { docId: number; isVerified: boolean }) =>
      apiFetch(`/vendors/${vendorId}/documents/${docId}`, { method: "PATCH", body: JSON.stringify({ isVerified }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-documents", vendorId] }); toast({ title: "Dokumen diperbarui" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: number) => apiFetch(`/vendors/${vendorId}/documents/${docId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-documents", vendorId] }); toast({ title: "Dokumen dihapus" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Memuat dokumen...</div>;

  const { documents = [], requiredDocs = [], missingDocs = [], documentScore, complianceStatus, expiringSoon = [] } = data ?? {};
  const compliance = COMPLIANCE_STATUS[complianceStatus ?? "incomplete"];

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Compliance" value={<span className={compliance?.color ?? ""}>{compliance?.label ?? "—"}</span>} icon={Shield} />
        <StatCard label="Dokumen Score" value={`${documentScore ?? "—"}%`} icon={FileText} color={documentScore >= 90 ? "text-green-600" : "text-yellow-600"} />
        <StatCard label="Wajib Terpenuhi" value={`${requiredDocs.length - missingDocs.length}/${requiredDocs.length}`} icon={CheckCircle2} />
      </div>

      {/* Missing Docs */}
      {missingDocs.length > 0 && (
        <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 text-sm">
          <div className="font-medium text-orange-800 mb-1">Dokumen Wajib Kurang:</div>
          <div className="flex flex-wrap gap-1">
            {missingDocs.map((d: string) => <Badge key={d} variant="outline" className="text-xs bg-white border-orange-200">{d}</Badge>)}
          </div>
        </div>
      )}

      {/* Expiring Soon */}
      {expiringSoon.length > 0 && (
        <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm">
          <div className="font-medium text-yellow-800 mb-1">Segera Expired:</div>
          <div className="space-y-1">
            {expiringSoon.map((e: any) => (
              <div key={e.doc.id} className="flex justify-between">
                <span>{e.doc.documentType} — {e.doc.fileName}</span>
                <span className="text-yellow-700">{e.daysLeft} hari lagi</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{documents.length} dokumen terdaftar</div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" />Daftarkan Dokumen
        </Button>
      </div>

      {/* Documents list */}
      {documents.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">Belum ada dokumen terdaftar</div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc: any) => {
            const isExpired = doc.expiryDate && new Date(doc.expiryDate) < new Date();
            return (
              <div key={doc.id} className={`flex items-center justify-between p-3 border rounded-lg text-sm ${isExpired ? "bg-red-50 border-red-200" : "bg-white"}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className={`h-4 w-4 shrink-0 ${isExpired ? "text-red-500" : "text-muted-foreground"}`} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{doc.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {doc.documentType}
                      {doc.expiryDate && ` · Expired: ${doc.expiryDate}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {doc.isVerified ? (
                    <Badge className="bg-green-100 text-green-800 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />Verified
                    </Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="text-xs h-6" onClick={() => verifyMutation.mutate({ docId: doc.id, isVerified: true })}>Verify</Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400" onClick={() => deleteMutation.mutate(doc.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Doc Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Daftarkan Dokumen</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tipe Dokumen *</Label>
              <Input value={form.documentType} onChange={(e) => setForm((f) => ({ ...f, documentType: e.target.value }))} placeholder="npwp, nib, kir, iso_9001..." />
            </div>
            <div><Label className="text-xs">Nama File *</Label><Input value={form.fileName} onChange={(e) => setForm((f) => ({ ...f, fileName: e.target.value }))} /></div>
            <div><Label className="text-xs">URL File</Label><Input value={form.fileUrl} onChange={(e) => setForm((f) => ({ ...f, fileUrl: e.target.value }))} placeholder="https://..." /></div>
            <div><Label className="text-xs">Tanggal Expired</Label><Input type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} /></div>
            <div><Label className="text-xs">Catatan</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Batal</Button>
            <Button disabled={!form.documentType || !form.fileName || addMutation.isPending} onClick={() => addMutation.mutate({
              documentType: form.documentType, fileName: form.fileName,
              fileUrl: form.fileUrl || undefined, expiryDate: form.expiryDate || undefined, notes: form.notes || undefined,
            })}>
              {addMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: Risk ─────────────────────────────────────────────────────────────────

function RiskTab({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ riskScore: "", tier: "low", creditLimit: "", paymentTermsDays: "", recommendations: "", notes: "", expiresAt: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["vendor-risk", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/risk`),
  });

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/vendors/${vendorId}/risk`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-risk", vendorId] }); toast({ title: "Penilaian risiko disimpan" }); setShowAdd(false); setForm({ riskScore: "", tier: "low", creditLimit: "", paymentTermsDays: "", recommendations: "", notes: "", expiresAt: "" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Memuat data risiko...</div>;
  const { active, history = [] } = data ?? {};

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" />Penilaian Baru
        </Button>
      </div>

      {/* Active Assessment */}
      {active ? (
        <Card className="border-2 border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Penilaian Aktif
              <RiskBadge tier={active.tier} />
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Risk Score</div><div className="font-bold text-lg">{active.riskScore}/100</div></div>
            <div><div className="text-xs text-muted-foreground">Credit Limit</div><div>{active.creditLimit ? Number(active.creditLimit).toLocaleString("id-ID") : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Jatuh Tempo Bayar</div><div>{active.paymentTermsDays ? `${active.paymentTermsDays} hari` : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Dinilai oleh</div><div>{active.assessedBy}</div></div>
            <div><div className="text-xs text-muted-foreground">Dinilai pada</div><div>{active.assessedAt ? format(new Date(active.assessedAt), "dd MMM yyyy") : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Berlaku hingga</div><div>{active.expiresAt ?? "—"}</div></div>
            {active.recommendations && (
              <div className="col-span-3"><div className="text-xs text-muted-foreground">Rekomendasi</div><div className="text-sm">{active.recommendations}</div></div>
            )}
            {active.notes && (
              <div className="col-span-3"><div className="text-xs text-muted-foreground">Catatan</div><div className="text-sm">{active.notes}</div></div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-6 text-muted-foreground border rounded-lg">Belum ada penilaian risiko aktif</div>
      )}

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Riwayat Penilaian</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                <div className="flex items-center gap-2">
                  <RiskBadge tier={a.tier} />
                  <span className="text-muted-foreground">Score: {a.riskScore}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.assessedAt && format(new Date(a.assessedAt), "dd MMM yyyy")} — {a.assessedBy}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Penilaian Risiko Baru</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Risk Score (0-100) *</Label>
                <Input type="number" min={0} max={100} value={form.riskScore} onChange={(e) => setForm((f) => ({ ...f, riskScore: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Tier *</Label>
                <Select value={form.tier} onValueChange={(v) => setForm((f) => ({ ...f, tier: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="blacklisted">Blacklisted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Credit Limit (IDR)</Label><Input type="number" value={form.creditLimit} onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))} /></div>
              <div><Label className="text-xs">Jatuh Tempo (hari)</Label><Input type="number" value={form.paymentTermsDays} onChange={(e) => setForm((f) => ({ ...f, paymentTermsDays: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Berlaku Hingga</Label><Input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} /></div>
            <div><Label className="text-xs">Rekomendasi</Label><Textarea value={form.recommendations} onChange={(e) => setForm((f) => ({ ...f, recommendations: e.target.value }))} rows={2} /></div>
            <div><Label className="text-xs">Catatan</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Batal</Button>
            <Button disabled={!form.riskScore || !form.tier || addMutation.isPending} onClick={() => addMutation.mutate({
              riskScore: Number(form.riskScore), tier: form.tier,
              creditLimit: form.creditLimit || undefined, paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : undefined,
              recommendations: form.recommendations || undefined, notes: form.notes || undefined,
              expiresAt: form.expiresAt || undefined,
            })}>
              {addMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: AI Context ───────────────────────────────────────────────────────────

function AiContextTab({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: current, isLoading } = useQuery({
    queryKey: ["vendor-ai-context", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/ai-context`),
  });

  const { data: history = [] } = useQuery({
    queryKey: ["vendor-ai-context-history", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/ai-context/history`),
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiFetch(`/vendors/${vendorId}/ai-context/refresh`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-ai-context", vendorId] });
      qc.invalidateQueries({ queryKey: ["vendor-ai-context-history", vendorId] });
      qc.invalidateQueries({ queryKey: ["vendor-memory", vendorId] });
      toast({ title: "AI Context berhasil di-refresh" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Memuat AI context...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          {current ? `Versi ${current.version} · ${formatDistanceToNow(new Date(current.createdAt), { addSuffix: true })}` : "Belum ada snapshot"}
        </div>
        <Button size="sm" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
          <RefreshCw className={`h-4 w-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          Generate AI Context
        </Button>
      </div>

      {current ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              Snapshot Aktif
              <Badge variant={current.isStale ? "destructive" : "secondary"} className="text-xs">
                {current.isStale ? "Stale" : `Freshness ${current.freshnessScore}%`}
              </Badge>
              {current.performanceGrade && (
                <Badge className={`text-xs ${GRADE_COLOR[current.performanceGrade] ?? ""}`}>
                  Grade {current.performanceGrade}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-3">
              {current.readinessScore != null && <div>Readiness: <strong>{current.readinessScore}%</strong></div>}
              {current.riskTier && <div>Risk: <strong><RiskBadge tier={current.riskTier} /></strong></div>}
              {current.responseTimeTier && <div>Response: <strong>{RESPONSE_TIER_LABEL[current.responseTimeTier] ?? current.responseTimeTier}</strong></div>}
              {current.complianceStatus && <div>Compliance: <strong className={COMPLIANCE_STATUS[current.complianceStatus]?.color ?? ""}>{COMPLIANCE_STATUS[current.complianceStatus]?.label ?? current.complianceStatus}</strong></div>}
              {current.tokenCount && <div>Token: {current.tokenCount}</div>}
              {current.model && <div>Model: {current.model}</div>}
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed border-t pt-3">
              {current.aiContextBlock}
            </p>
            {Array.isArray(current.missingDocsList) && current.missingDocsList.length > 0 && (
              <div className="mt-3 p-2 rounded bg-orange-50 text-xs text-orange-700">
                <strong>Dokumen kurang:</strong> {current.missingDocsList.join(", ")}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-12 border rounded-lg">
          <Brain className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
          <div className="text-muted-foreground">Belum ada AI context snapshot</div>
          <Button className="mt-4" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Generate Sekarang
          </Button>
        </div>
      )}

      {(history as any[]).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Riwayat Snapshot</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(history as any[]).map((snap) => (
              <div key={snap.id} className="flex items-center justify-between text-xs py-1.5 border-b last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant={snap.isStale ? "secondary" : "default"} className="text-xs">v{snap.version}</Badge>
                  <span className="text-muted-foreground">{snap.isStale ? "Stale" : `Freshness ${snap.freshnessScore}%`}</span>
                  {snap.performanceGrade && <span>Grade: {snap.performanceGrade}</span>}
                </div>
                <span className="text-muted-foreground">{snap.createdAt ? format(new Date(snap.createdAt), "dd MMM yyyy HH:mm") : "—"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Preferences ──────────────────────────────────────────────────────────

function PreferencesTab({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ category: "service", key: "", value: "", notes: "" });

  const { data = [], isLoading } = useQuery({
    queryKey: ["vendor-preferences", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/preferences`),
  });

  const putMutation = useMutation({
    mutationFn: ({ category, key, body }: { category: string; key: string; body: Record<string, unknown> }) =>
      apiFetch(`/vendors/${vendorId}/preferences/${category}/${key}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-preferences", vendorId] }); toast({ title: "Preferensi disimpan" }); setShowAdd(false); setForm({ category: "service", key: "", value: "", notes: "" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const delMutation = useMutation({
    mutationFn: ({ category, key }: { category: string; key: string }) =>
      apiFetch(`/vendors/${vendorId}/preferences/${category}/${key}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-preferences", vendorId] }); toast({ title: "Preferensi dihapus" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Memuat preferensi...</div>;

  const grouped = (data as any[]).reduce((acc: Record<string, any[]>, p: any) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category]!.push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{(data as any[]).length} preferensi aktif</div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" />Tambah Preferensi
        </Button>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">Belum ada preferensi terdaftar</div>
      ) : (
        Object.entries(grouped).map(([category, prefs]) => (
          <Card key={category}>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold text-muted-foreground uppercase">{category}</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {(prefs as any[]).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                  <div>
                    <span className="font-medium">{p.key}</span>
                    <span className="text-muted-foreground ml-3">{p.value}</span>
                    {p.source !== "manual" && <Badge variant="secondary" className="ml-2 text-xs">{p.source}</Badge>}
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400" onClick={() => delMutation.mutate({ category: p.category, key: p.key })}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Preferensi</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Kategori *</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["service","communication","document","payment","operational"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Key *</Label><Input value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} placeholder="preferred_channel, typical_lead_time..." /></div>
            <div><Label className="text-xs">Value *</Label><Input value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} /></div>
            <div><Label className="text-xs">Catatan</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Batal</Button>
            <Button disabled={!form.category || !form.key || !form.value || putMutation.isPending} onClick={() => putMutation.mutate({ category: form.category, key: form.key, body: { value: form.value, notes: form.notes || undefined } })}>
              {putMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VendorMemoryPage() {
  const { id } = useParams<{ id: string }>();
  const vendorId = Number(id);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: memory, isLoading } = useQuery({
    queryKey: ["vendor-memory", vendorId],
    queryFn: () => apiFetch(`/vendors/${vendorId}/memory`),
    enabled: !Number.isNaN(vendorId),
  });

  const vendor = memory?.vendor;
  const grade = memory?.grade ?? memory?.latestSnapshot?.performanceGrade ?? "?";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-primary mr-2" />
        <span className="text-muted-foreground">Memuat data vendor...</span>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <div className="text-muted-foreground">Vendor tidak ditemukan</div>
        <Link href="/vendors">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-1" />Kembali
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/vendors">
          <Button variant="ghost" size="icon" className="shrink-0 -ml-2">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold border ${GRADE_COLOR[grade] ?? "bg-gray-100"}`}>
              {grade}
            </div>
            <div>
              <h1 className="text-xl font-bold">{vendor.name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Truck className="h-3.5 w-3.5" />
                {vendor.service_type ?? "—"}
                {vendor.country && <><Globe className="h-3.5 w-3.5 ml-2" />{vendor.country}</>}
                {memory?.activeRisk && <RiskBadge tier={memory.activeRisk.tier} />}
              </div>
            </div>
          </div>
        </div>

        {memory?.readinessScore != null && (
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold">{memory.readinessScore}%</div>
            <div className="text-xs text-muted-foreground">Readiness Score</div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="performance">Performa</TabsTrigger>
          <TabsTrigger value="pricing">Harga</TabsTrigger>
          <TabsTrigger value="capabilities">Kapabilitas</TabsTrigger>
          <TabsTrigger value="documents">Dokumen</TabsTrigger>
          <TabsTrigger value="risk">Risiko</TabsTrigger>
          <TabsTrigger value="preferences">Preferensi</TabsTrigger>
          <TabsTrigger value="ai-context">AI Context</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfileTab memory={memory} />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          <PerformanceTab vendorId={vendorId} />
        </TabsContent>
        <TabsContent value="pricing" className="mt-4">
          <PricingTab vendorId={vendorId} />
        </TabsContent>
        <TabsContent value="capabilities" className="mt-4">
          <CapabilitiesTab vendorId={vendorId} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab vendorId={vendorId} />
        </TabsContent>
        <TabsContent value="risk" className="mt-4">
          <RiskTab vendorId={vendorId} />
        </TabsContent>
        <TabsContent value="preferences" className="mt-4">
          <PreferencesTab vendorId={vendorId} />
        </TabsContent>
        <TabsContent value="ai-context" className="mt-4">
          <AiContextTab vendorId={vendorId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
