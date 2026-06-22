import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "@/lib/auth-api";
import {
  Fuel, AlertTriangle, TrendingDown, TrendingUp, Plus, BarChart2, Target, Gauge,
  Droplets, Car, CheckCircle, RefreshCw,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, opts?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

interface FuelLog {
  id: number;
  fleetUnitId: number;
  plateNumber?: string;
  unitNumber?: string;
  driverName?: string;
  loggedAt: string;
  odometerKm: number;
  litersFilled: number;
  fuelType?: string;
  pricePerLiter?: number;
  totalCost?: number;
  stationName?: string;
  kmSinceLastFill?: number;
  kmPerLiter?: number;
  isAnomaly?: boolean;
  anomalyReason?: string;
}

interface FuelBenchmark {
  id: number;
  vehicleType: string;
  fuelType: string;
  benchmarkKmPerLiter: number;
  tolerancePct: number;
  minLitersAlert?: number;
  maxLitersAlert?: number;
}

interface FuelAnalytics {
  totalFillCount: number;
  totalLiters: number;
  totalCost: number;
  totalKm: number;
  avgKmPerLiter: number | null;
  anomalyCount: number;
  anomalyRate: number;
}

interface FleetUnit { id: number; plateNumber: string; unitNumber: string; vehicleType: string; }

function fmt(n: number | null | undefined, decimals = 0) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtDate(d: string) { return new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }); }

function AddFuelLogDialog({ units }: { units: FleetUnit[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fleetUnitId: "", odometerKm: "", litersFilled: "", fuelType: "solar",
    pricePerLiter: "", stationName: "", notes: "",
  });

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch("/fleet/fuel", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      if (data.isAnomaly) {
        toast({ title: "⚠️ Anomali terdeteksi!", description: data.anomalies?.join("; "), variant: "destructive" });
      } else {
        toast({ title: "Log BBM berhasil disimpan", description: `KM/L: ${data.kmPerLiter?.toFixed(2) ?? "—"}` });
      }
      qc.invalidateQueries({ queryKey: ["/api/fleet/fuel"] });
      qc.invalidateQueries({ queryKey: ["/api/fleet/fuel/analytics"] });
      setOpen(false);
      setForm({ fleetUnitId: "", odometerKm: "", litersFilled: "", fuelType: "solar", pricePerLiter: "", stationName: "", notes: "" });
    },
    onError: () => toast({ title: "Gagal menyimpan log BBM", variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.fleetUnitId || !form.odometerKm || !form.litersFilled) {
      toast({ title: "Unit, odometer, dan liter wajib diisi", variant: "destructive" }); return;
    }
    mutation.mutate({
      fleetUnitId: parseInt(form.fleetUnitId),
      odometerKm: parseFloat(form.odometerKm),
      litersFilled: parseFloat(form.litersFilled),
      fuelType: form.fuelType,
      pricePerLiter: form.pricePerLiter ? parseFloat(form.pricePerLiter) : undefined,
      stationName: form.stationName || undefined,
      notes: form.notes || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Isi BBM</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Log Pengisian BBM</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Unit Kendaraan *</Label>
            <Select value={form.fleetUnitId} onValueChange={v => setForm(f => ({ ...f, fleetUnitId: v }))}>
              <SelectTrigger><SelectValue placeholder="Pilih unit" /></SelectTrigger>
              <SelectContent>
                {units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.plateNumber} ({u.unitNumber})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Odometer (km) *</Label>
              <Input type="number" value={form.odometerKm} onChange={e => setForm(f => ({ ...f, odometerKm: e.target.value }))} placeholder="120500" />
            </div>
            <div>
              <Label>Liter *</Label>
              <Input type="number" value={form.litersFilled} onChange={e => setForm(f => ({ ...f, litersFilled: e.target.value }))} placeholder="80" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Jenis BBM</Label>
              <Select value={form.fuelType} onValueChange={v => setForm(f => ({ ...f, fuelType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["solar", "pertamax", "pertalite", "gas"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Harga/Liter</Label>
              <Input type="number" value={form.pricePerLiter} onChange={e => setForm(f => ({ ...f, pricePerLiter: e.target.value }))} placeholder="7000" />
            </div>
          </div>
          <div>
            <Label>Nama SPBU</Label>
            <Input value={form.stationName} onChange={e => setForm(f => ({ ...f, stationName: e.target.value }))} placeholder="SPBU Pertamina..." />
          </div>
          <div>
            <Label>Catatan</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Menyimpan..." : "Simpan Log BBM"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddBenchmarkDialog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    vehicleType: "truck", fuelType: "solar", benchmarkKmPerLiter: "", tolerancePct: "20",
    maxLitersAlert: "", notes: "",
  });

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiFetch("/fleet/fuel/benchmarks", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Benchmark BBM disimpan" });
      qc.invalidateQueries({ queryKey: ["/api/fleet/fuel/benchmarks"] });
      setOpen(false);
    },
    onError: () => toast({ title: "Gagal menyimpan benchmark", variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.benchmarkKmPerLiter) { toast({ title: "KM/L wajib diisi", variant: "destructive" }); return; }
    mutation.mutate({
      vehicleType: form.vehicleType, fuelType: form.fuelType,
      benchmarkKmPerLiter: parseFloat(form.benchmarkKmPerLiter),
      tolerancePct: parseFloat(form.tolerancePct) || 20,
      maxLitersAlert: form.maxLitersAlert ? parseFloat(form.maxLitersAlert) : undefined,
      notes: form.notes || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Target className="h-4 w-4 mr-1" />Set Benchmark</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Set Benchmark BBM</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Tipe Kendaraan</Label>
              <Select value={form.vehicleType} onValueChange={v => setForm(f => ({ ...f, vehicleType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["truck", "pickup", "van", "motorcycle", "other"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Jenis BBM</Label>
              <Select value={form.fuelType} onValueChange={v => setForm(f => ({ ...f, fuelType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["solar", "pertamax", "pertalite"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Benchmark KM/L *</Label>
              <Input type="number" step="0.1" value={form.benchmarkKmPerLiter}
                onChange={e => setForm(f => ({ ...f, benchmarkKmPerLiter: e.target.value }))} placeholder="6.5" />
            </div>
            <div>
              <Label>Toleransi (%)</Label>
              <Input type="number" value={form.tolerancePct}
                onChange={e => setForm(f => ({ ...f, tolerancePct: e.target.value }))} placeholder="20" />
            </div>
          </div>
          <div>
            <Label>Maks Liter Alert</Label>
            <Input type="number" value={form.maxLitersAlert}
              onChange={e => setForm(f => ({ ...f, maxLitersAlert: e.target.value }))} placeholder="200" />
          </div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Menyimpan..." : "Simpan Benchmark"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function FleetFuelPage() {
  const [tab, setTab] = useState("logs");
  const [unitFilter, setUnitFilter] = useState("");

  const { data: unitsData } = useQuery<{ units: FleetUnit[] }>({
    queryKey: ["/api/fleet/units"],
    queryFn: () => apiFetch("/fleet/units"),
  });
  const units = unitsData?.units ?? [];

  const { data: logsData, isLoading } = useQuery<{ fuelLogs: FuelLog[]; total: number }>({
    queryKey: ["/api/fleet/fuel", unitFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (unitFilter) params.set("unitId", unitFilter);
      return apiFetch(`/fleet/fuel?${params}`);
    },
  });

  const { data: analytics } = useQuery<FuelAnalytics>({
    queryKey: ["/api/fleet/fuel/analytics"],
    queryFn: () => apiFetch("/fleet/fuel/analytics"),
  });

  const { data: anomaliesData } = useQuery<{ anomalies: FuelLog[]; total: number }>({
    queryKey: ["/api/fleet/fuel/anomalies"],
    queryFn: () => apiFetch("/fleet/fuel/anomalies?limit=50"),
  });

  const { data: benchmarksData } = useQuery<{ benchmarks: FuelBenchmark[] }>({
    queryKey: ["/api/fleet/fuel/benchmarks"],
    queryFn: () => apiFetch("/fleet/fuel/benchmarks"),
  });

  const logs = logsData?.fuelLogs ?? [];
  const anomalies = anomaliesData?.anomalies ?? [];
  const benchmarks = benchmarksData?.benchmarks ?? [];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Fuel className="h-6 w-6 text-orange-500" />Fuel Intelligence</h1>
            <p className="text-muted-foreground text-sm mt-1">Monitoring konsumsi BBM, deteksi anomali, benchmark KM/L</p>
          </div>
          <div className="flex gap-2">
            <AddBenchmarkDialog />
            <AddFuelLogDialog units={units} />
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Droplets className="h-4 w-4" />Total Liter</div>
              <div className="text-2xl font-bold">{fmt(analytics?.totalLiters)} L</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Gauge className="h-4 w-4" />Rata KM/L</div>
              <div className="text-2xl font-bold">{fmt(analytics?.avgKmPerLiter, 2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><AlertTriangle className="h-4 w-4 text-red-500" />Anomali</div>
              <div className="text-2xl font-bold text-red-600">{analytics?.anomalyCount ?? 0}</div>
              <div className="text-xs text-muted-foreground">{analytics?.anomalyRate ?? 0}% dari total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Car className="h-4 w-4" />Total Isi</div>
              <div className="text-2xl font-bold">{analytics?.totalFillCount ?? 0}x</div>
              <div className="text-xs text-muted-foreground">Rp {fmt(analytics?.totalCost)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Anomaly alert bar */}
        {(analytics?.anomalyCount ?? 0) > 0 && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div>
              <span className="font-semibold text-red-700">{analytics?.anomalyCount} anomali BBM terdeteksi</span>
              <span className="text-red-600 text-sm ml-2">— periksa tab Anomali untuk detail</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="logs">Log BBM ({logsData?.total ?? 0})</TabsTrigger>
            <TabsTrigger value="anomalies" className={(anomalies.length > 0) ? "text-red-600" : ""}>
              Anomali {anomalies.length > 0 && <Badge variant="destructive" className="ml-1">{anomalies.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="benchmarks">Benchmark</TabsTrigger>
          </TabsList>

          {/* Log BBM Tab */}
          <TabsContent value="logs" className="space-y-3">
            <div className="flex gap-2">
              <Select value={unitFilter} onValueChange={setUnitFilter}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Filter unit..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Semua unit</SelectItem>
                  {units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.plateNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Memuat data...</div>
            ) : logs.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Fuel className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">Belum ada log pengisian BBM</p>
                  <p className="text-sm text-muted-foreground mt-1">Klik "Isi BBM" untuk menambahkan log pertama</p>
                </CardContent>
              </Card>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left">Unit</th>
                      <th className="px-3 py-2 text-left">Pengemudi</th>
                      <th className="px-3 py-2 text-left">Tanggal</th>
                      <th className="px-3 py-2 text-right">Odometer</th>
                      <th className="px-3 py-2 text-right">Liter</th>
                      <th className="px-3 py-2 text-right">KM/L</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-left">SPBU</th>
                      <th className="px-3 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id} className={`border-t hover:bg-muted/20 ${log.isAnomaly ? "bg-red-50" : ""}`}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{log.plateNumber ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{log.unitNumber}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{log.driverName ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(log.loggedAt)}</td>
                        <td className="px-3 py-2 text-right">{fmt(log.odometerKm)} km</td>
                        <td className="px-3 py-2 text-right">{fmt(log.litersFilled, 1)} L</td>
                        <td className="px-3 py-2 text-right">
                          {log.kmPerLiter ? (
                            <span className={log.kmPerLiter < 4 ? "text-red-600 font-medium" : "text-green-600"}>
                              {fmt(log.kmPerLiter, 2)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">{log.totalCost ? `Rp ${fmt(log.totalCost)}` : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{log.stationName ?? "—"}</td>
                        <td className="px-3 py-2 text-center">
                          {log.isAnomaly
                            ? <Badge variant="destructive" className="text-xs">Anomali</Badge>
                            : <Badge variant="outline" className="text-xs text-green-700 border-green-300">Normal</Badge>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* Anomali Tab */}
          <TabsContent value="anomalies" className="space-y-3">
            {anomalies.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="h-10 w-10 mx-auto text-green-500 mb-3" />
                  <p className="text-muted-foreground">Tidak ada anomali BBM yang terdeteksi</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {anomalies.map(a => (
                  <div key={a.id} className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
                    <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{a.plateNumber ?? "—"}</span>
                        <span className="text-muted-foreground text-sm">{a.unitNumber}</span>
                        <span className="text-xs text-muted-foreground">• {fmtDate(a.loggedAt)}</span>
                      </div>
                      <p className="text-sm text-red-700 mt-1">{a.anomalyReason}</p>
                      <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                        <span>Liter: {fmt(a.litersFilled, 1)}L</span>
                        <span>KM/L: {a.kmPerLiter ? fmt(a.kmPerLiter, 2) : "—"}</span>
                        <span>Odometer: {fmt(a.odometerKm)}km</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Benchmark Tab */}
          <TabsContent value="benchmarks" className="space-y-3">
            {benchmarks.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Target className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">Belum ada benchmark BBM</p>
                  <p className="text-sm text-muted-foreground mt-1">Klik "Set Benchmark" untuk menambahkan</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {benchmarks.map(b => (
                  <Card key={b.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-semibold capitalize">{b.vehicleType}</span>
                          <Badge variant="outline" className="ml-2 text-xs">{b.fuelType}</Badge>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-green-700">{b.benchmarkKmPerLiter} km/L</div>
                          <div className="text-xs text-muted-foreground">±{b.tolerancePct}% toleransi</div>
                        </div>
                      </div>
                      {b.maxLitersAlert && (
                        <div className="text-xs text-muted-foreground">Maks liter alert: {b.maxLitersAlert}L</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        Min threshold: {(b.benchmarkKmPerLiter * (1 - b.tolerancePct / 100)).toFixed(2)} km/L
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
