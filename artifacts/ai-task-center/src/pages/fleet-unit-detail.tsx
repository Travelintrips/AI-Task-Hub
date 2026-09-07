import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Truck, FileText, Wrench, AlertTriangle, Plus, Upload } from "lucide-react";

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
  available:   { cls: "bg-green-100 text-green-800", label: "Tersedia" },
  on_route:    { cls: "bg-blue-100 text-blue-800",   label: "Dalam Perjalanan" },
  maintenance: { cls: "bg-yellow-100 text-yellow-800", label: "Maintenance" },
  inactive:    { cls: "bg-gray-100 text-gray-500",   label: "Nonaktif" },
};
const DOC_STATUS_CFG: Record<string, { cls: string; label: string }> = {
  active:        { cls: "bg-green-100 text-green-800", label: "Aktif" },
  expiring_soon: { cls: "bg-yellow-100 text-yellow-800", label: "Akan Expired" },
  expired:       { cls: "bg-red-100 text-red-800",   label: "Expired" },
};
const MAINT_STATUS_CFG: Record<string, { cls: string; label: string }> = {
  pending:     { cls: "bg-yellow-100 text-yellow-800", label: "Menunggu" },
  in_progress: { cls: "bg-blue-100 text-blue-800",    label: "Dalam Proses" },
  completed:   { cls: "bg-green-100 text-green-800",  label: "Selesai" },
  rejected:    { cls: "bg-red-100 text-red-800",      label: "Ditolak" },
  cancelled:   { cls: "bg-gray-100 text-gray-500",    label: "Dibatalkan" },
};
const DOC_TYPE_LABELS: Record<string, string> = { stnk: "STNK", kir: "KIR", insurance: "Asuransi", tax: "Pajak", mutation: "Mutasi", other: "Lainnya" };

export default function FleetUnitDetail() {
  const [, params] = useRoute("/fleet/units/:id");
  const id = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [docOpen, setDocOpen] = useState(false);
  const [docForm, setDocForm] = useState({ docType: "stnk", docNumber: "", issuedDate: "", expiredDate: "", issuingAuthority: "", notes: "" });
  const [odomOpen, setOdomOpen] = useState(false);
  const [odomValue, setOdomValue] = useState("");

  const { data: unit, isLoading } = useQuery({
    queryKey: ["fleet-unit", id],
    queryFn: () => apiFetch(`/fleet/units/${id}`),
    enabled: !!id,
  });

  const uploadDocMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/fleet/units/${id}/documents`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { toast({ title: "Dokumen berhasil diupload" }); queryClient.invalidateQueries({ queryKey: ["fleet-unit", id] }); setDocOpen(false); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const odomMutation = useMutation({
    mutationFn: (km: number) => apiFetch(`/fleet/units/${id}/odometer`, { method: "PATCH", body: JSON.stringify({ odometerKm: km }) }),
    onSuccess: () => { toast({ title: "Odometer diperbarui" }); queryClient.invalidateQueries({ queryKey: ["fleet-unit", id] }); setOdomOpen(false); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiFetch(`/fleet/units/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => { toast({ title: "Status diperbarui" }); queryClient.invalidateQueries({ queryKey: ["fleet-unit", id] }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Memuat...</div>;
  if (!unit) return <div className="p-6 text-muted-foreground">Kendaraan tidak ditemukan.</div>;

  const statusCfg = STATUS_CFG[unit.status] ?? STATUS_CFG.inactive;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/fleet/units"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Kembali</Button></Link>
        <Truck className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">{unit.plateNumber}</h1>
        <Badge className={`${statusCfg.cls} text-xs`}>{statusCfg.label}</Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setOdomOpen(true)}>Update Odometer</Button>
          <Select value={unit.status} onValueChange={v => statusMutation.mutate(v)}>
            <SelectTrigger className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="available">Tersedia</SelectItem>
              <SelectItem value="on_route">Dalam Perjalanan</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Info Utama */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Unit Number", value: unit.unitNumber },
          { label: "Tipe", value: unit.vehicleType },
          { label: "Merek / Model", value: [unit.brand, unit.model].filter(Boolean).join(" ") || "—" },
          { label: "Tahun", value: unit.year ?? "—" },
          { label: "Bahan Bakar", value: unit.fuelType ?? "—" },
          { label: "Kepemilikan", value: unit.ownershipType ?? "—" },
          { label: "Kapasitas (kg)", value: unit.capacityKg ? `${unit.capacityKg.toLocaleString("id-ID")} kg` : "—" },
          { label: "Odometer", value: unit.currentOdometerKm ? `${Number(unit.currentOdometerKm).toLocaleString("id-ID")} km` : "—" },
          { label: "Lokasi Asal", value: unit.baseLocation ?? "—" },
          { label: "Pengemudi", value: unit.driverName ?? "—" },
        ].map(({ label, value }) => (
          <Card key={label} className="p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-medium mt-0.5">{String(value)}</div>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents"><FileText className="h-4 w-4 mr-1" />Dokumen ({unit.documents?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="maintenance"><Wrench className="h-4 w-4 mr-1" />Maintenance ({unit.recentMaintenance?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">Dokumen Kendaraan</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setDocOpen(true)}><Upload className="h-3.5 w-3.5 mr-1" />Upload Dokumen</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Tipe</TableHead><TableHead>Nomor</TableHead><TableHead>Berlaku s/d</TableHead><TableHead>Status</TableHead><TableHead>Penerbit</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(unit.documents ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Belum ada dokumen</TableCell></TableRow>
                  ) : (unit.documents ?? []).map((doc: { id: number; docType: string; docNumber?: string; expiredDate?: string; issuingAuthority?: string }) => {
                    const now = new Date();
                    const exp = doc.expiredDate ? new Date(doc.expiredDate) : null;
                    const daysLeft = exp ? Math.ceil((exp.getTime() - now.getTime()) / 86400000) : null;
                    const st = daysLeft === null ? "active" : daysLeft < 0 ? "expired" : daysLeft <= 30 ? "expiring_soon" : "active";
                    const cfg = DOC_STATUS_CFG[st];
                    return (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium text-sm">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</TableCell>
                        <TableCell className="text-sm">{doc.docNumber ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {doc.expiredDate ?? "—"}
                          {daysLeft !== null && <span className={`ml-1 text-xs ${daysLeft < 0 ? "text-red-600" : daysLeft <= 30 ? "text-yellow-600" : "text-green-600"}`}>({daysLeft < 0 ? `${Math.abs(daysLeft)}h expired` : `${daysLeft}h lagi`})</span>}
                        </TableCell>
                        <TableCell><Badge className={`${cfg.cls} text-xs`}>{cfg.label}</Badge></TableCell>
                        <TableCell className="text-sm">{doc.issuingAuthority ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maintenance">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">Riwayat Maintenance</CardTitle>
              <Link href={`/fleet/maintenance?unitId=${id}`}><Button size="sm" variant="outline">Lihat Semua</Button></Link>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Tanggal</TableHead><TableHead>Tipe</TableHead><TableHead>Deskripsi</TableHead><TableHead>Bengkel</TableHead><TableHead>Status</TableHead><TableHead>Biaya</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(unit.recentMaintenance ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Belum ada riwayat maintenance</TableCell></TableRow>
                  ) : (unit.recentMaintenance ?? []).map((m: { id: number; serviceDate: string; maintenanceType: string; description: string; workshopName?: string; status: string; costActual?: number; costEstimate?: number }) => {
                    const cfg = MAINT_STATUS_CFG[m.status] ?? MAINT_STATUS_CFG.pending;
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm">{m.serviceDate}</TableCell>
                        <TableCell className="text-sm capitalize">{m.maintenanceType}</TableCell>
                        <TableCell className="text-sm max-w-48 truncate">{m.description}</TableCell>
                        <TableCell className="text-sm">{m.workshopName ?? "—"}</TableCell>
                        <TableCell><Badge className={`${cfg.cls} text-xs`}>{cfg.label}</Badge></TableCell>
                        <TableCell className="text-sm">{m.costActual != null ? `Rp ${Number(m.costActual).toLocaleString("id-ID")}` : m.costEstimate != null ? `~Rp ${Number(m.costEstimate).toLocaleString("id-ID")}` : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog Upload Dokumen */}
      <Dialog open={docOpen} onOpenChange={setDocOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Dokumen Kendaraan</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="space-y-1">
              <Label className="text-xs">Tipe Dokumen *</Label>
              <Select value={docForm.docType} onValueChange={v => setDocForm(f => ({ ...f, docType: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {[
              { key: "docNumber", label: "Nomor Dokumen", placeholder: "B 1234 XYZ / No. KIR" },
              { key: "issuedDate", label: "Tanggal Terbit", placeholder: "2024-01-01", type: "date" },
              { key: "expiredDate", label: "Tanggal Expired", placeholder: "2025-01-01", type: "date" },
              { key: "issuingAuthority", label: "Penerbit", placeholder: "Samsat / Dinas Perhubungan" },
              { key: "notes", label: "Catatan", placeholder: "" },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input className="h-8 text-sm" type={type} placeholder={placeholder} value={(docForm as Record<string, string>)[key]} onChange={e => setDocForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDocOpen(false)}>Batal</Button>
            <Button onClick={() => uploadDocMutation.mutate(docForm)} disabled={!docForm.docType || uploadDocMutation.isPending}>
              {uploadDocMutation.isPending ? "Mengupload..." : "Upload"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Update Odometer */}
      <Dialog open={odomOpen} onOpenChange={setOdomOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Update Odometer</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="text-sm text-muted-foreground">Odometer saat ini: <strong>{unit.currentOdometerKm ? `${Number(unit.currentOdometerKm).toLocaleString("id-ID")} km` : "0 km"}</strong></div>
            <div className="space-y-1">
              <Label className="text-xs">Odometer Baru (km) *</Label>
              <Input className="h-8 text-sm" type="number" placeholder="Masukkan nilai baru" value={odomValue} onChange={e => setOdomValue(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setOdomOpen(false)}>Batal</Button>
            <Button onClick={() => odomMutation.mutate(parseFloat(odomValue))} disabled={!odomValue || odomMutation.isPending}>
              {odomMutation.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
