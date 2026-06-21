import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { getStoredToken } from "@/lib/auth-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Truck, Plus, Search, RefreshCw, Eye, ChevronRight } from "lucide-react";

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

type FleetUnit = {
  id: number;
  unitNumber: string;
  plateNumber: string;
  vehicleType: string;
  brand?: string;
  model?: string;
  year?: number;
  status: string;
  fuelType?: string;
  ownershipType?: string;
  capacityKg?: number;
  currentOdometerKm?: number;
  baseLocation?: string;
  driverName?: string;
  driverPhone?: string;
  createdAt: string;
};

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  available:   { cls: "bg-green-100 text-green-800 border-green-300",  label: "Tersedia" },
  on_route:    { cls: "bg-blue-100 text-blue-800 border-blue-300",    label: "Dalam Perjalanan" },
  maintenance: { cls: "bg-yellow-100 text-yellow-800 border-yellow-300", label: "Maintenance" },
  inactive:    { cls: "bg-gray-100 text-gray-500 border-gray-300",    label: "Nonaktif" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.inactive;
  return <Badge className={`${c.cls} border text-xs font-medium`}>{c.label}</Badge>;
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  truck: "Truk", pickup: "Pickup", van: "Van", motorcycle: "Motor", other: "Lainnya",
};

export default function FleetUnits() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({
    unitNumber: "", plateNumber: "", vehicleType: "truck",
    brand: "", model: "", year: "", fuelType: "solar",
    ownershipType: "own", capacityKg: "", baseLocation: "",
  });

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (statusFilter !== "all") params.set("status", statusFilter);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-units", search, statusFilter],
    queryFn: () => apiFetch(`/fleet/units?${params}`),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/fleet/units", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Kendaraan berhasil ditambahkan" });
      queryClient.invalidateQueries({ queryKey: ["fleet-units"] });
      setIsCreateOpen(false);
      setForm({ unitNumber: "", plateNumber: "", vehicleType: "truck", brand: "", model: "", year: "", fuelType: "solar", ownershipType: "own", capacityKg: "", baseLocation: "" });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const units: FleetUnit[] = data?.data ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Armada Kendaraan</h1>
          <Badge variant="outline" className="ml-1">{data?.total ?? 0} unit</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />Tambah Kendaraan</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Tambah Kendaraan Baru</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {[
                  { key: "unitNumber", label: "Nomor Unit *", placeholder: "UNIT-001" },
                  { key: "plateNumber", label: "Nomor Polisi *", placeholder: "B 1234 XYZ" },
                  { key: "brand", label: "Merek", placeholder: "Mitsubishi" },
                  { key: "model", label: "Model", placeholder: "Colt Diesel" },
                  { key: "year", label: "Tahun", placeholder: "2020" },
                  { key: "capacityKg", label: "Kapasitas (kg)", placeholder: "5000" },
                  { key: "baseLocation", label: "Lokasi Asal", placeholder: "Jakarta" },
                ].map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      className="h-8 text-sm"
                      placeholder={placeholder}
                      value={(form as Record<string, string>)[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs">Tipe Kendaraan</Label>
                  <Select value={form.vehicleType} onValueChange={v => setForm(f => ({ ...f, vehicleType: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(VEHICLE_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bahan Bakar</Label>
                  <Select value={form.fuelType} onValueChange={v => setForm(f => ({ ...f, fuelType: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["solar", "pertamax", "pertalite", "gas"].map(v => <SelectItem key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Kepemilikan</Label>
                  <Select value={form.ownershipType} onValueChange={v => setForm(f => ({ ...f, ownershipType: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="own">Milik Sendiri</SelectItem>
                      <SelectItem value="leased">Leasing</SelectItem>
                      <SelectItem value="rented">Sewa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Batal</Button>
                <Button
                  onClick={() => createMutation.mutate({
                    ...form,
                    year: form.year ? parseInt(form.year) : undefined,
                    capacityKg: form.capacityKg ? parseFloat(form.capacityKg) : undefined,
                  })}
                  disabled={!form.unitNumber || !form.plateNumber || createMutation.isPending}
                >
                  {createMutation.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm" placeholder="Cari plat/unit..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-sm"><SelectValue placeholder="Semua Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="available">Tersedia</SelectItem>
            <SelectItem value="on_route">Dalam Perjalanan</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="inactive">Nonaktif</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit / Plat</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Merek & Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pengemudi</TableHead>
                <TableHead>Odometer</TableHead>
                <TableHead>Lokasi</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Memuat data...</TableCell></TableRow>
              ) : units.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Belum ada kendaraan terdaftar</TableCell></TableRow>
              ) : units.map(unit => (
                <TableRow key={unit.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="font-medium text-sm">{unit.plateNumber}</div>
                    <div className="text-xs text-muted-foreground">{unit.unitNumber}</div>
                  </TableCell>
                  <TableCell className="text-sm">{VEHICLE_TYPE_LABELS[unit.vehicleType] ?? unit.vehicleType}</TableCell>
                  <TableCell className="text-sm">{[unit.brand, unit.model, unit.year].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell><StatusBadge status={unit.status} /></TableCell>
                  <TableCell className="text-sm">{unit.driverName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm">{unit.currentOdometerKm != null ? `${Number(unit.currentOdometerKm).toLocaleString("id-ID")} km` : "—"}</TableCell>
                  <TableCell className="text-sm">{unit.baseLocation ?? "—"}</TableCell>
                  <TableCell>
                    <Link href={`/fleet/units/${unit.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 px-2"><Eye className="h-3.5 w-3.5 mr-1" />Detail</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
