import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { getStoredToken } from "@/lib/auth-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Search, RefreshCw, Eye, AlertTriangle } from "lucide-react";

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

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  active:    { cls: "bg-green-100 text-green-800", label: "Aktif" },
  off:       { cls: "bg-gray-100 text-gray-600",   label: "Cuti/Libur" },
  suspended: { cls: "bg-red-100 text-red-800",     label: "Ditangguhkan" },
  resigned:  { cls: "bg-gray-200 text-gray-500",   label: "Keluar" },
};

type Driver = {
  id: number;
  employeeId?: string;
  fullName: string;
  phone?: string;
  licenseNumber: string;
  licenseType?: string;
  licenseExpired?: string;
  status: string;
  vehiclePlate?: string;
  vehicleUnit?: string;
  baseLocation?: string;
};

export default function FleetDrivers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: "", employeeId: "", phone: "", email: "", licenseNumber: "",
    licenseType: "SIM B2", licenseExpired: "", joinDate: "", baseLocation: "",
    emergencyContact: "", emergencyPhone: "",
  });

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (statusFilter !== "all") params.set("status", statusFilter);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-drivers", search, statusFilter],
    queryFn: () => apiFetch(`/fleet/drivers?${params}`),
  });

  const { data: expiringData } = useQuery({
    queryKey: ["fleet-drivers-expiring"],
    queryFn: () => apiFetch("/fleet/drivers/license-expiring?days=30"),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/fleet/drivers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Pengemudi berhasil ditambahkan" });
      queryClient.invalidateQueries({ queryKey: ["fleet-drivers"] });
      setIsCreateOpen(false);
      setForm({ fullName: "", employeeId: "", phone: "", email: "", licenseNumber: "", licenseType: "SIM B2", licenseExpired: "", joinDate: "", baseLocation: "", emergencyContact: "", emergencyPhone: "" });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const drivers: Driver[] = data?.data ?? [];
  const expiring: Driver[] = expiringData?.data ?? [];

  function daysUntil(dateStr?: string) {
    if (!dateStr) return null;
    return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Pengemudi</h1>
          <Badge variant="outline" className="ml-1">{data?.total ?? 0} orang</Badge>
          {expiring.length > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border ml-1">
              <AlertTriangle className="h-3 w-3 mr-1" />{expiring.length} SIM akan expired
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />Tambah Pengemudi</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Tambah Pengemudi</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {[
                  { key: "fullName", label: "Nama Lengkap *", placeholder: "Budi Santoso" },
                  { key: "employeeId", label: "ID Karyawan", placeholder: "EMP-001" },
                  { key: "phone", label: "No. HP", placeholder: "08123456789" },
                  { key: "email", label: "Email", placeholder: "budi@example.com" },
                  { key: "licenseNumber", label: "Nomor SIM *", placeholder: "1234567890123456" },
                  { key: "licenseExpired", label: "Expired SIM", placeholder: "2026-12-31", type: "date" },
                  { key: "joinDate", label: "Tanggal Bergabung", placeholder: "2023-01-01", type: "date" },
                  { key: "baseLocation", label: "Lokasi Asal", placeholder: "Jakarta" },
                  { key: "emergencyContact", label: "Kontak Darurat", placeholder: "Nama kontak" },
                  { key: "emergencyPhone", label: "HP Kontak Darurat", placeholder: "08123456789" },
                ].map(({ key, label, placeholder, type }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input className="h-8 text-sm" type={type} placeholder={placeholder} value={(form as Record<string, string>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs">Tipe SIM</Label>
                  <Select value={form.licenseType} onValueChange={v => setForm(f => ({ ...f, licenseType: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["SIM A", "SIM B1", "SIM B2", "SIM C"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Batal</Button>
                <Button onClick={() => createMutation.mutate({ ...form })} disabled={!form.fullName || !form.licenseNumber || createMutation.isPending}>
                  {createMutation.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {expiring.length > 0 && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 text-yellow-800 text-sm font-medium mb-2">
              <AlertTriangle className="h-4 w-4" />SIM akan expired dalam 30 hari:
            </div>
            <div className="flex flex-wrap gap-2">
              {expiring.slice(0, 5).map((d) => {
                const days = daysUntil(d.licenseExpired);
                return (
                  <Link key={d.id} href={`/fleet/drivers/${d.id}`}>
                    <Badge className={`${days !== null && days < 0 ? "bg-red-100 text-red-800 border-red-300" : "bg-yellow-100 text-yellow-800 border-yellow-300"} border cursor-pointer`}>
                      {d.fullName} — {days !== null && days < 0 ? `${Math.abs(days)}h expired` : `${days}h lagi`}
                    </Badge>
                  </Link>
                );
              })}
              {expiring.length > 5 && <Badge variant="outline">+{expiring.length - 5} lainnya</Badge>}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm" placeholder="Cari nama / nomor SIM..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            {Object.entries(STATUS_CFG).map(([v, { label }]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead><TableHead>ID / No. HP</TableHead><TableHead>No. SIM</TableHead>
                <TableHead>Tipe SIM</TableHead><TableHead>Expired SIM</TableHead><TableHead>Status</TableHead>
                <TableHead>Kendaraan</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Memuat data...</TableCell></TableRow>
              ) : drivers.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Belum ada pengemudi</TableCell></TableRow>
              ) : drivers.map(d => {
                const days = daysUntil(d.licenseExpired);
                const simExpiredClass = days === null ? "" : days < 0 ? "text-red-600" : days <= 30 ? "text-yellow-600" : "";
                const cfg = STATUS_CFG[d.status] ?? STATUS_CFG.active;
                return (
                  <TableRow key={d.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium text-sm">{d.fullName}</TableCell>
                    <TableCell className="text-sm"><div>{d.employeeId ?? "—"}</div><div className="text-xs text-muted-foreground">{d.phone ?? ""}</div></TableCell>
                    <TableCell className="text-sm font-mono">{d.licenseNumber}</TableCell>
                    <TableCell className="text-sm">{d.licenseType ?? "—"}</TableCell>
                    <TableCell className={`text-sm ${simExpiredClass}`}>
                      {d.licenseExpired ?? "—"}
                      {days !== null && <span className="ml-1 text-xs">({days < 0 ? `${Math.abs(days)}h expired` : `${days}h`})</span>}
                    </TableCell>
                    <TableCell><Badge className={`${cfg.cls} text-xs`}>{cfg.label}</Badge></TableCell>
                    <TableCell className="text-sm">{d.vehiclePlate ?? "—"}</TableCell>
                    <TableCell>
                      <Link href={`/fleet/drivers/${d.id}`}>
                        <Button variant="ghost" size="sm" className="h-7 px-2"><Eye className="h-3.5 w-3.5 mr-1" />Detail</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
