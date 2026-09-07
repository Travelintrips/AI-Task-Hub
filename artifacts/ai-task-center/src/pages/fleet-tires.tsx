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
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "@/lib/auth-api";
import {
  AlertTriangle, Plus, RotateCw, CheckCircle, Package,
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

interface FleetTire {
  id: number;
  fleetUnitId: number;
  plateNumber?: string;
  unitNumber?: string;
  serialNumber?: string;
  brand?: string;
  sizeName?: string;
  position: string;
  installDate?: string;
  installOdometerKm?: number;
  expectedLifeKm?: number;
  status: string;
  isActive: boolean;
  usedKm?: number;
  remainingKm?: number;
  wearPct?: number;
  isWorn?: boolean;
  isCritical?: boolean;
}

interface TireRotation {
  id: number;
  fleetUnitId: number;
  rotationDate: string;
  odometerAtRotation?: number;
  notes?: string;
}

interface FleetUnit { id: number; plateNumber: string; unitNumber: string; }

const POSITIONS = [
  "front_left", "front_right", "rear_left_outer", "rear_left_inner",
  "rear_right_outer", "rear_right_inner", "spare",
];

function positionLabel(p: string) {
  const map: Record<string, string> = {
    front_left: "Depan Kiri", front_right: "Depan Kanan",
    rear_left_outer: "Belakang Kiri Luar", rear_left_inner: "Belakang Kiri Dalam",
    rear_right_outer: "Belakang Kanan Luar", rear_right_inner: "Belakang Kanan Dalam",
    spare: "Ban Cadangan",
  };
  return map[p] ?? p;
}

function wearColor(pct: number) {
  if (pct >= 95) return "bg-red-500";
  if (pct >= 80) return "bg-orange-500";
  if (pct >= 60) return "bg-yellow-500";
  return "bg-green-500";
}

function fmt(n: number | null | undefined, d = 0) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function AddTireDialog({ units }: { units: FleetUnit[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fleetUnitId: "", position: "front_left", serialNumber: "", brand: "",
    sizeName: "", installDate: "", installOdometerKm: "", expectedLifeKm: "80000",
  });

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiFetch("/fleet/tires", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Ban berhasil didaftarkan" });
      qc.invalidateQueries({ queryKey: ["/api/fleet/tires"] });
      setOpen(false);
    },
    onError: () => toast({ title: "Gagal mendaftarkan ban", variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.fleetUnitId || !form.position) {
      toast({ title: "Unit dan posisi wajib diisi", variant: "destructive" }); return;
    }
    mutation.mutate({
      fleetUnitId: parseInt(form.fleetUnitId),
      position: form.position,
      serialNumber: form.serialNumber || undefined,
      brand: form.brand || undefined,
      sizeName: form.sizeName || undefined,
      installDate: form.installDate || undefined,
      installOdometerKm: form.installOdometerKm ? parseFloat(form.installOdometerKm) : undefined,
      expectedLifeKm: form.expectedLifeKm ? parseFloat(form.expectedLifeKm) : 80000,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Daftar Ban</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Daftar Ban Baru</DialogTitle></DialogHeader>
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
          <div>
            <Label>Posisi *</Label>
            <Select value={form.position} onValueChange={v => setForm(f => ({ ...f, position: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {POSITIONS.map(p => <SelectItem key={p} value={p}>{positionLabel(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Serial Number</Label><Input value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} /></div>
            <div><Label>Merk</Label><Input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Bridgestone" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Ukuran</Label><Input value={form.sizeName} onChange={e => setForm(f => ({ ...f, sizeName: e.target.value }))} placeholder="11.00 R20" /></div>
            <div><Label>Expected Life (km)</Label><Input type="number" value={form.expectedLifeKm} onChange={e => setForm(f => ({ ...f, expectedLifeKm: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Tgl Pasang</Label><Input type="date" value={form.installDate} onChange={e => setForm(f => ({ ...f, installDate: e.target.value }))} /></div>
            <div><Label>Odometer Pasang</Label><Input type="number" value={form.installOdometerKm} onChange={e => setForm(f => ({ ...f, installOdometerKm: e.target.value }))} /></div>
          </div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Menyimpan..." : "Daftar Ban"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RotationDialog({ units }: { units: FleetUnit[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fleetUnitId: "", rotationDate: "", odometerAtRotation: "", performedBy: "", notes: "" });

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiFetch("/fleet/tires/rotation", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Rotasi ban berhasil dicatat" });
      qc.invalidateQueries({ queryKey: ["/api/fleet/tires"] });
      setOpen(false);
    },
    onError: () => toast({ title: "Gagal mencatat rotasi", variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.fleetUnitId || !form.rotationDate) {
      toast({ title: "Unit dan tanggal wajib diisi", variant: "destructive" }); return;
    }
    mutation.mutate({
      fleetUnitId: parseInt(form.fleetUnitId),
      rotationDate: form.rotationDate,
      odometerAtRotation: form.odometerAtRotation ? parseFloat(form.odometerAtRotation) : undefined,
      performedBy: form.performedBy || undefined,
      notes: form.notes || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><RotateCw className="h-4 w-4 mr-1" />Rotasi Ban</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Catat Rotasi Ban</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Unit *</Label>
            <Select value={form.fleetUnitId} onValueChange={v => setForm(f => ({ ...f, fleetUnitId: v }))}>
              <SelectTrigger><SelectValue placeholder="Pilih unit" /></SelectTrigger>
              <SelectContent>
                {units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.plateNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Tanggal *</Label><Input type="date" value={form.rotationDate} onChange={e => setForm(f => ({ ...f, rotationDate: e.target.value }))} /></div>
            <div><Label>Odometer</Label><Input type="number" value={form.odometerAtRotation} onChange={e => setForm(f => ({ ...f, odometerAtRotation: e.target.value }))} /></div>
          </div>
          <div><Label>Dilakukan oleh</Label><Input value={form.performedBy} onChange={e => setForm(f => ({ ...f, performedBy: e.target.value }))} /></div>
          <div><Label>Catatan</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Menyimpan..." : "Catat Rotasi"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function FleetTiresPage() {
  const [tab, setTab] = useState("inventory");
  const [unitFilter, setUnitFilter] = useState("");

  const { data: unitsData } = useQuery<{ units: FleetUnit[] }>({
    queryKey: ["/api/fleet/units"],
    queryFn: () => apiFetch("/fleet/units"),
  });
  const units = unitsData?.units ?? [];

  const { data: tiresData, isLoading } = useQuery<{ tires: FleetTire[]; total: number }>({
    queryKey: ["/api/fleet/tires", unitFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "200" });
      if (unitFilter) params.set("unitId", unitFilter);
      return apiFetch(`/fleet/tires?${params}`);
    },
  });

  const { data: lifecycleData } = useQuery<{ tires: FleetTire[]; total: number; wornCount: number; criticalCount: number }>({
    queryKey: ["/api/fleet/tires/lifecycle"],
    queryFn: () => apiFetch("/fleet/tires/lifecycle"),
  });

  const tires = tiresData?.tires ?? [];
  const lifecycle = lifecycleData?.tires ?? [];
  const wornCount = lifecycleData?.wornCount ?? 0;
  const criticalCount = lifecycleData?.criticalCount ?? 0;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6 text-gray-600" />Tire Lifecycle
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Inventaris ban, lifecycle monitoring, rotasi</p>
          </div>
          <div className="flex gap-2">
            <RotationDialog units={units} />
            <AddTireDialog units={units} />
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Total Ban Aktif</div>
            <div className="text-2xl font-bold">{lifecycle.length}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-orange-500" />Ban Aus (≥80%)</div>
            <div className="text-2xl font-bold text-orange-600">{wornCount}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-500" />Kritis (≥95%)</div>
            <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Kondisi Baik</div>
            <div className="text-2xl font-bold text-green-600">{lifecycle.length - wornCount}</div>
          </CardContent></Card>
        </div>

        {/* Worn alert */}
        {criticalCount > 0 && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <span className="font-semibold text-red-700">{criticalCount} ban dalam kondisi KRITIS — segera ganti!</span>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="inventory">Inventaris ({tires.length})</TabsTrigger>
            <TabsTrigger value="lifecycle" className={criticalCount > 0 ? "text-red-600" : ""}>
              Lifecycle {criticalCount > 0 && <Badge variant="destructive" className="ml-1">{criticalCount}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inventory">
            <div className="flex gap-2 mb-3">
              <Select value={unitFilter || "all"} onValueChange={v => setUnitFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-52"><SelectValue placeholder="Filter unit..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua unit</SelectItem>
                  {units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.plateNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Memuat data...</div>
            ) : tires.length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Belum ada data ban</p>
              </CardContent></Card>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left">Unit</th>
                      <th className="px-3 py-2 text-left">Posisi</th>
                      <th className="px-3 py-2 text-left">Merk / SN</th>
                      <th className="px-3 py-2 text-left">Ukuran</th>
                      <th className="px-3 py-2 text-right">Pasang KM</th>
                      <th className="px-3 py-2 text-right">Expected</th>
                      <th className="px-3 py-2 text-center">Kondisi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tires.map(t => (
                      <tr key={t.id} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <div className="font-medium">{t.plateNumber ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{t.unitNumber}</div>
                        </td>
                        <td className="px-3 py-2">{positionLabel(t.position)}</td>
                        <td className="px-3 py-2">
                          <div>{t.brand ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{t.serialNumber ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{t.sizeName ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{fmt(t.installOdometerKm)} km</td>
                        <td className="px-3 py-2 text-right">{fmt(t.expectedLifeKm)} km</td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant={
                            t.status === "replaced" ? "secondary" :
                            t.isCritical ? "destructive" :
                            t.isWorn ? "outline" : "outline"
                          } className={t.status === "good" && !t.isWorn ? "text-green-700 border-green-300" : ""}>
                            {t.status === "replaced" ? "Diganti" : t.isCritical ? "Kritis" : t.isWorn ? "Aus" : "Baik"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="lifecycle">
            {lifecycle.length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <CheckCircle className="h-10 w-10 mx-auto text-green-500 mb-3" />
                <p className="text-muted-foreground">Belum ada data lifecycle ban</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {lifecycle
                  .sort((a, b) => (b.wearPct ?? 0) - (a.wearPct ?? 0))
                  .map(t => {
                    const wear = t.wearPct ?? 0;
                    return (
                      <div key={t.id} className={`flex items-center gap-4 rounded-lg border p-3 ${t.isCritical ? "bg-red-50 border-red-200" : t.isWorn ? "bg-orange-50 border-orange-200" : ""}`}>
                        <div className="w-36 flex-shrink-0">
                          <div className="font-medium text-sm">{t.plateNumber ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{positionLabel(t.position)}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>{t.brand ?? "—"} {t.sizeName ? `(${t.sizeName})` : ""}</span>
                            <span className={t.isCritical ? "text-red-600 font-semibold" : t.isWorn ? "text-orange-600 font-semibold" : ""}>
                              {wear}% aus
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                            <div className={`h-full rounded-full ${wearColor(wear)}`} style={{ width: `${Math.min(100, wear)}%` }} />
                          </div>
                          <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                            <span>Dipakai: {fmt(t.usedKm)} km</span>
                            <span>Sisa: {fmt(t.remainingKm)} km</span>
                          </div>
                        </div>
                        {t.isCritical && <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />}
                        {!t.isCritical && t.isWorn && <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0" />}
                        {!t.isWorn && <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />}
                      </div>
                    );
                  })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
