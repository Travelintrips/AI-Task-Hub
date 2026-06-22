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
  Navigation, Plus, CheckCircle, Clock, AlertTriangle, Truck, MapPin, BarChart3,
  ArrowRight, PlayCircle, XCircle,
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

interface UtilizationTrip {
  id: number;
  fleetUnitId: number;
  plateNumber?: string;
  unitNumber?: string;
  driverName?: string;
  origin?: string;
  destination?: string;
  tripPurpose?: string;
  plannedKm?: number;
  actualKm?: number;
  plannedDeparture?: string;
  actualDeparture?: string;
  plannedArrival?: string;
  actualArrival?: string;
  delayMinutes?: number;
  capacityUsedPct?: number;
  status: string;
  cancelReason?: string;
}

interface UtilizationAnalytics {
  totalTrips: number;
  completedTrips: number;
  onTimeRate: number;
  totalActualKm: number;
  avgCapacityUsed: number | null;
  idleUnitsCount: number;
  idleUnits: { id: number; plateNumber: string; unitNumber: string; status: string }[];
  overUtilizedCount: number;
}

interface FleetUnit { id: number; plateNumber: string; unitNumber: string; }
interface FleetDriver { id: number; fullName: string; }

function fmt(n: number | null | undefined, d = 0) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  planned: { label: "Direncanakan", color: "bg-blue-100 text-blue-700" },
  on_route: { label: "Dalam Perjalanan", color: "bg-green-100 text-green-700" },
  completed: { label: "Selesai", color: "bg-gray-100 text-gray-700" },
  cancelled: { label: "Dibatalkan", color: "bg-red-100 text-red-700" },
};

function AddTripDialog({ units, drivers }: { units: FleetUnit[]; drivers: FleetDriver[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fleetUnitId: "", driverId: "", origin: "", destination: "", tripPurpose: "",
    plannedKm: "", plannedDeparture: "", plannedArrival: "", capacityUsedPct: "", status: "planned",
  });

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiFetch("/fleet/utilization", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Trip berhasil dibuat" });
      qc.invalidateQueries({ queryKey: ["/api/fleet/utilization"] });
      qc.invalidateQueries({ queryKey: ["/api/fleet/utilization/analytics"] });
      setOpen(false);
    },
    onError: () => toast({ title: "Gagal membuat trip", variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.fleetUnitId) { toast({ title: "Unit wajib dipilih", variant: "destructive" }); return; }
    mutation.mutate({
      fleetUnitId: parseInt(form.fleetUnitId),
      driverId: form.driverId ? parseInt(form.driverId) : undefined,
      origin: form.origin || undefined,
      destination: form.destination || undefined,
      tripPurpose: form.tripPurpose || undefined,
      plannedKm: form.plannedKm ? parseFloat(form.plannedKm) : undefined,
      plannedDeparture: form.plannedDeparture ? new Date(form.plannedDeparture).toISOString() : undefined,
      plannedArrival: form.plannedArrival ? new Date(form.plannedArrival).toISOString() : undefined,
      capacityUsedPct: form.capacityUsedPct ? parseFloat(form.capacityUsedPct) : undefined,
      status: form.status,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Buat Trip</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Buat Trip Baru</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Unit *</Label>
              <Select value={form.fleetUnitId} onValueChange={v => setForm(f => ({ ...f, fleetUnitId: v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                <SelectContent>
                  {units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.plateNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Pengemudi</Label>
              <Select value={form.driverId || "none"} onValueChange={v => setForm(f => ({ ...f, driverId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih pengemudi" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tidak ada</SelectItem>
                  {drivers.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Asal</Label><Input value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} placeholder="Jakarta" /></div>
            <div><Label>Tujuan</Label><Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder="Surabaya" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Rencana KM</Label><Input type="number" value={form.plannedKm} onChange={e => setForm(f => ({ ...f, plannedKm: e.target.value }))} /></div>
            <div><Label>Kapasitas (%)</Label><Input type="number" max="100" value={form.capacityUsedPct} onChange={e => setForm(f => ({ ...f, capacityUsedPct: e.target.value }))} /></div>
          </div>
          <div><Label>Tujuan Trip</Label><Input value={form.tripPurpose} onChange={e => setForm(f => ({ ...f, tripPurpose: e.target.value }))} placeholder="Pengiriman barang..." /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Rencana Berangkat</Label><Input type="datetime-local" value={form.plannedDeparture} onChange={e => setForm(f => ({ ...f, plannedDeparture: e.target.value }))} /></div>
            <div><Label>Rencana Tiba</Label><Input type="datetime-local" value={form.plannedArrival} onChange={e => setForm(f => ({ ...f, plannedArrival: e.target.value }))} /></div>
          </div>
          <div>
            <Label>Status Awal</Label>
            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">Direncanakan</SelectItem>
                <SelectItem value="on_route">Langsung Berangkat</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Menyimpan..." : "Buat Trip"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UpdateTripDialog({ trip }: { trip: UtilizationTrip }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    status: trip.status, actualKm: String(trip.actualKm ?? ""),
    actualArrival: "", cancelReason: "",
  });

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiFetch(`/fleet/utilization/${trip.id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Trip diperbarui" });
      qc.invalidateQueries({ queryKey: ["/api/fleet/utilization"] });
      qc.invalidateQueries({ queryKey: ["/api/fleet/utilization/analytics"] });
      setOpen(false);
    },
    onError: () => toast({ title: "Gagal memperbarui trip", variant: "destructive" }),
  });

  function handleSubmit() {
    mutation.mutate({
      status: form.status,
      actualKm: form.actualKm ? parseFloat(form.actualKm) : undefined,
      actualArrival: form.actualArrival ? new Date(form.actualArrival).toISOString() : undefined,
      cancelReason: form.cancelReason || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-xs">Update</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Update Trip #{trip.id}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">Direncanakan</SelectItem>
                <SelectItem value="on_route">Dalam Perjalanan</SelectItem>
                <SelectItem value="completed">Selesai</SelectItem>
                <SelectItem value="cancelled">Dibatalkan</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.status === "completed" && <>
            <div><Label>Aktual KM</Label><Input type="number" value={form.actualKm} onChange={e => setForm(f => ({ ...f, actualKm: e.target.value }))} /></div>
            <div><Label>Aktual Tiba</Label><Input type="datetime-local" value={form.actualArrival} onChange={e => setForm(f => ({ ...f, actualArrival: e.target.value }))} /></div>
          </>}
          {form.status === "cancelled" && (
            <div><Label>Alasan Batal</Label><Input value={form.cancelReason} onChange={e => setForm(f => ({ ...f, cancelReason: e.target.value }))} /></div>
          )}
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? "Menyimpan..." : "Update Trip"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function FleetUtilizationPage() {
  const [tab, setTab] = useState("trips");
  const [statusFilter, setStatusFilter] = useState("");

  const { data: unitsData } = useQuery<{ units: FleetUnit[] }>({
    queryKey: ["/api/fleet/units"],
    queryFn: () => apiFetch("/fleet/units"),
  });
  const { data: driversData } = useQuery<{ drivers: FleetDriver[] }>({
    queryKey: ["/api/fleet/drivers"],
    queryFn: () => apiFetch("/fleet/drivers"),
  });

  const { data: tripsData, isLoading } = useQuery<{ trips: UtilizationTrip[]; total: number }>({
    queryKey: ["/api/fleet/utilization", statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter) params.set("status", statusFilter);
      return apiFetch(`/fleet/utilization?${params}`);
    },
  });

  const { data: analytics } = useQuery<UtilizationAnalytics>({
    queryKey: ["/api/fleet/utilization/analytics"],
    queryFn: () => apiFetch("/fleet/utilization/analytics"),
  });

  const units = unitsData?.units ?? [];
  const drivers = (driversData as { drivers?: FleetDriver[] } | undefined)?.drivers ?? [];
  const trips = tripsData?.trips ?? [];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Navigation className="h-6 w-6 text-blue-600" />Utilization & Availability
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Trip log, utilisasi kendaraan, deteksi idle & over-utilized</p>
          </div>
          <AddTripDialog units={units} drivers={drivers} />
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1"><Navigation className="h-4 w-4" />Total Trip</div>
            <div className="text-2xl font-bold">{analytics?.totalTrips ?? 0}</div>
            <div className="text-xs text-muted-foreground">{analytics?.completedTrips ?? 0} selesai</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1"><Clock className="h-4 w-4" />On-Time Rate</div>
            <div className={`text-2xl font-bold ${(analytics?.onTimeRate ?? 0) >= 80 ? "text-green-600" : "text-orange-600"}`}>
              {analytics?.onTimeRate ?? 0}%
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1"><Truck className="h-4 w-4 text-orange-500" />Idle Kendaraan</div>
            <div className={`text-2xl font-bold ${(analytics?.idleUnitsCount ?? 0) > 0 ? "text-orange-600" : "text-green-600"}`}>
              {analytics?.idleUnitsCount ?? 0}
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Total KM Aktual</div>
            <div className="text-2xl font-bold">{fmt(analytics?.totalActualKm)} km</div>
          </CardContent></Card>
        </div>

        {/* Idle alert */}
        {(analytics?.idleUnitsCount ?? 0) > 0 && (
          <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-orange-700">{analytics?.idleUnitsCount} kendaraan idle (3+ hari tanpa trip)</span>
              <div className="flex gap-2 mt-1 flex-wrap">
                {analytics?.idleUnits.map(u => (
                  <Badge key={u.id} variant="outline" className="text-xs">{u.plateNumber}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="trips">Trip Log ({tripsData?.total ?? 0})</TabsTrigger>
            <TabsTrigger value="availability">Ketersediaan Unit</TabsTrigger>
          </TabsList>

          <TabsContent value="trips" className="space-y-3">
            <div>
              <Select value={statusFilter || "all"} onValueChange={v => setStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-52"><SelectValue placeholder="Filter status..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua status</SelectItem>
                  <SelectItem value="planned">Direncanakan</SelectItem>
                  <SelectItem value="on_route">Dalam Perjalanan</SelectItem>
                  <SelectItem value="completed">Selesai</SelectItem>
                  <SelectItem value="cancelled">Dibatalkan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Memuat data...</div>
            ) : trips.length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <Navigation className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Belum ada trip log</p>
                <p className="text-sm text-muted-foreground mt-1">Klik "Buat Trip" untuk memulai</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {trips.map(trip => {
                  const st = STATUS_MAP[trip.status] ?? { label: trip.status, color: "bg-gray-100 text-gray-700" };
                  return (
                    <div key={trip.id} className="flex items-center gap-4 border rounded-lg p-3 hover:bg-muted/10">
                      <div className="w-28 flex-shrink-0">
                        <div className="font-medium text-sm">{trip.plateNumber ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{trip.unitNumber}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{trip.origin ?? "—"}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm font-medium">{trip.destination ?? "—"}</span>
                          {trip.tripPurpose && <span className="text-xs text-muted-foreground">• {trip.tripPurpose}</span>}
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                          <span>Pengemudi: {trip.driverName ?? "—"}</span>
                          <span>Berangkat: {fmtDate(trip.plannedDeparture)}</span>
                          {trip.actualKm && <span>Aktual: {fmt(trip.actualKm)}km</span>}
                          {trip.delayMinutes !== null && trip.delayMinutes !== undefined && trip.delayMinutes > 0 && (
                            <span className="text-orange-600">Terlambat {trip.delayMinutes}mnt</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                        {trip.status !== "completed" && trip.status !== "cancelled" && (
                          <UpdateTripDialog trip={trip} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="availability">
            <div className="grid md:grid-cols-2 gap-3">
              {units.map(unit => {
                const onRoute = trips.find(t => t.fleetUnitId === unit.id && t.status === "on_route");
                const isIdle = analytics?.idleUnits.some(u => u.id === unit.id);
                return (
                  <div key={unit.id} className={`border rounded-lg p-3 ${isIdle ? "bg-orange-50 border-orange-200" : onRoute ? "bg-green-50 border-green-200" : ""}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{unit.plateNumber}</div>
                        <div className="text-xs text-muted-foreground">{unit.unitNumber}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {onRoute ? (
                          <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">Dalam Perjalanan</Badge>
                        ) : isIdle ? (
                          <Badge className="bg-orange-100 text-orange-700 border-orange-300 text-xs">Idle 3+ hari</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Tersedia</Badge>
                        )}
                        {onRoute && <div className="text-xs text-muted-foreground">{onRoute.origin} → {onRoute.destination}</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {units.length === 0 && (
                <div className="col-span-2 text-center py-8 text-muted-foreground">
                  <Truck className="h-10 w-10 mx-auto mb-3" />
                  <p>Belum ada unit kendaraan</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
