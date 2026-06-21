import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Wrench, Plus, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

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

type MaintenanceRecord = {
  id: number;
  fleetUnitId: number;
  plateNumber?: string;
  unitNumber?: string;
  maintenanceType: string;
  category?: string;
  description: string;
  serviceDate: string;
  workshopName?: string;
  costEstimate?: number;
  costActual?: number;
  status: string;
  approvedBy?: number;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  completionDate?: string;
  createdAt: string;
};

const STATUS_CFG: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
  pending:     { cls: "bg-yellow-100 text-yellow-800 border-yellow-300", label: "Menunggu Approval", icon: <Clock className="h-3 w-3" /> },
  in_progress: { cls: "bg-blue-100 text-blue-800 border-blue-300",    label: "Dalam Proses",      icon: <Wrench className="h-3 w-3" /> },
  completed:   { cls: "bg-green-100 text-green-800 border-green-300",  label: "Selesai",           icon: <CheckCircle className="h-3 w-3" /> },
  rejected:    { cls: "bg-red-100 text-red-800 border-red-300",        label: "Ditolak",           icon: <XCircle className="h-3 w-3" /> },
  cancelled:   { cls: "bg-gray-100 text-gray-500 border-gray-300",     label: "Dibatalkan",        icon: <XCircle className="h-3 w-3" /> },
};

const MAINT_TYPE_LABELS: Record<string, string> = {
  routine: "Rutin", corrective: "Korektif", preventive: "Preventif", emergency: "Darurat",
};

function MaintenanceStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending;
  return (
    <Badge className={`${cfg.cls} border text-xs font-medium flex items-center gap-1 w-fit`}>
      {cfg.icon}{cfg.label}
    </Badge>
  );
}

export default function FleetMaintenance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [approveId, setApproveId] = useState<number | null>(null);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [completeId, setCompleteId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [approveForm, setApproveForm] = useState({ costActual: "", workshopName: "", generatePR: false, notes: "" });
  const [rejectReason, setRejectReason] = useState("");
  const [completeForm, setCompleteForm] = useState({ completionDate: "", costActual: "", invoiceUrl: "", notes: "" });
  const [createForm, setCreateForm] = useState({
    fleetUnitId: "", maintenanceType: "routine", category: "other",
    description: "", serviceDate: "", workshopName: "", costEstimate: "", notes: "",
  });

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-maintenance", statusFilter],
    queryFn: () => apiFetch(`/fleet/maintenance?${params}`),
  });

  const { data: dueData } = useQuery({
    queryKey: ["fleet-maintenance-due"],
    queryFn: () => apiFetch("/fleet/maintenance/due?days=7"),
  });

  const { data: unitsData } = useQuery({
    queryKey: ["fleet-units-simple"],
    queryFn: () => apiFetch("/fleet/units?limit=100"),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/fleet/maintenance", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Record maintenance dibuat, menunggu approval supervisor" });
      queryClient.invalidateQueries({ queryKey: ["fleet-maintenance"] });
      setIsCreateOpen(false);
      setCreateForm({ fleetUnitId: "", maintenanceType: "routine", category: "other", description: "", serviceDate: "", workshopName: "", costEstimate: "", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch(`/fleet/maintenance/${id}/approve`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      toast({ title: "Maintenance disetujui", description: data.purchaseRequest ? `Purchase Request ${data.purchaseRequest.requestNumber} dibuat` : undefined });
      queryClient.invalidateQueries({ queryKey: ["fleet-maintenance"] });
      setApproveId(null);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiFetch(`/fleet/maintenance/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast({ title: "Maintenance ditolak" });
      queryClient.invalidateQueries({ queryKey: ["fleet-maintenance"] });
      setRejectId(null);
      setRejectReason("");
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch(`/fleet/maintenance/${id}/complete`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Maintenance diselesaikan" });
      queryClient.invalidateQueries({ queryKey: ["fleet-maintenance"] });
      setCompleteId(null);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const records: MaintenanceRecord[] = data?.data ?? [];
  const dueSchedules = dueData?.data ?? [];
  const units = unitsData?.data ?? [];

  const pendingCount = records.filter(r => r.status === "pending").length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Maintenance</h1>
          {pendingCount > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border">
              <Clock className="h-3 w-3 mr-1" />{pendingCount} menunggu approval
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />Buat Maintenance</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Buat Record Maintenance</DialogTitle></DialogHeader>
              <p className="text-xs text-muted-foreground -mt-1">Record akan masuk status <strong>Pending</strong> dan menunggu approval supervisor.</p>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Kendaraan *</Label>
                  <Select value={createForm.fleetUnitId} onValueChange={v => setCreateForm(f => ({ ...f, fleetUnitId: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pilih kendaraan" /></SelectTrigger>
                    <SelectContent>
                      {units.map((u: { id: number; plateNumber: string; unitNumber: string }) => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.plateNumber} — {u.unitNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipe Maintenance</Label>
                  <Select value={createForm.maintenanceType} onValueChange={v => setCreateForm(f => ({ ...f, maintenanceType: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(MAINT_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Kategori</Label>
                  <Select value={createForm.category} onValueChange={v => setCreateForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["engine", "transmission", "brake", "electrical", "body", "ac", "tire", "other"].map(v => (
                        <SelectItem key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tanggal Service *</Label>
                  <Input type="date" className="h-8 text-sm" value={createForm.serviceDate} onChange={e => setCreateForm(f => ({ ...f, serviceDate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bengkel</Label>
                  <Input className="h-8 text-sm" placeholder="Nama bengkel" value={createForm.workshopName} onChange={e => setCreateForm(f => ({ ...f, workshopName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Estimasi Biaya (Rp)</Label>
                  <Input type="number" className="h-8 text-sm" placeholder="0" value={createForm.costEstimate} onChange={e => setCreateForm(f => ({ ...f, costEstimate: e.target.value }))} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Deskripsi *</Label>
                  <Textarea className="text-sm resize-none" rows={2} placeholder="Jelaskan kebutuhan maintenance..." value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Catatan</Label>
                  <Input className="h-8 text-sm" placeholder="Catatan tambahan" value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Batal</Button>
                <Button
                  onClick={() => createMutation.mutate({
                    ...createForm,
                    fleetUnitId: parseInt(createForm.fleetUnitId),
                    costEstimate: createForm.costEstimate ? parseFloat(createForm.costEstimate) : undefined,
                  })}
                  disabled={!createForm.fleetUnitId || !createForm.description || !createForm.serviceDate || createMutation.isPending}
                >
                  {createMutation.isPending ? "Menyimpan..." : "Buat Record"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">Semua Record</TabsTrigger>
          <TabsTrigger value="due">
            Jadwal Jatuh Tempo
            {dueSchedules.length > 0 && <Badge className="ml-1 bg-orange-100 text-orange-800 text-xs">{dueSchedules.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-3">
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48 h-8 text-sm"><SelectValue placeholder="Semua Status" /></SelectTrigger>
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
                    <TableHead />
                    <TableHead>Kendaraan</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Deskripsi</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Bengkel</TableHead>
                    <TableHead>Estimasi</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
                  ) : records.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Belum ada record maintenance</TableCell></TableRow>
                  ) : records.map(r => (
                    <>
                      <TableRow key={r.id} className={`hover:bg-muted/30 ${r.status === "pending" ? "bg-yellow-50/30" : ""}`}>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                            {expandedId === r.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{r.plateNumber ?? `Unit #${r.fleetUnitId}`}</div>
                          <div className="text-xs text-muted-foreground">{r.unitNumber ?? ""}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${r.maintenanceType === "emergency" ? "border-red-400 text-red-700" : ""}`}>
                            {MAINT_TYPE_LABELS[r.maintenanceType] ?? r.maintenanceType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-48 truncate">{r.description}</TableCell>
                        <TableCell className="text-sm">{r.serviceDate}</TableCell>
                        <TableCell className="text-sm">{r.workshopName ?? "—"}</TableCell>
                        <TableCell className="text-sm">{r.costEstimate != null ? `Rp ${Number(r.costEstimate).toLocaleString("id-ID")}` : "—"}</TableCell>
                        <TableCell><MaintenanceStatusBadge status={r.status} /></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {r.status === "pending" && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50" onClick={() => { setApproveId(r.id); setApproveForm({ costActual: "", workshopName: r.workshopName ?? "", generatePR: false, notes: "" }); }}>
                                  <CheckCircle className="h-3 w-3 mr-1" />Setuju
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50" onClick={() => { setRejectId(r.id); setRejectReason(""); }}>
                                  <XCircle className="h-3 w-3 mr-1" />Tolak
                                </Button>
                              </>
                            )}
                            {r.status === "in_progress" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700 border-blue-300 hover:bg-blue-50" onClick={() => { setCompleteId(r.id); setCompleteForm({ completionDate: new Date().toISOString().split("T")[0]!, costActual: "", invoiceUrl: "", notes: "" }); }}>
                                <CheckCircle className="h-3 w-3 mr-1" />Selesai
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedId === r.id && (
                        <TableRow key={`exp-${r.id}`} className="bg-muted/10">
                          <TableCell colSpan={9} className="py-3 px-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                              <div><span className="text-muted-foreground text-xs">Biaya Aktual:</span><div className="font-medium">{r.costActual != null ? `Rp ${Number(r.costActual).toLocaleString("id-ID")}` : "—"}</div></div>
                              <div><span className="text-muted-foreground text-xs">Selesai:</span><div className="font-medium">{r.completionDate ?? "—"}</div></div>
                              {r.rejectionReason && <div className="col-span-2"><span className="text-muted-foreground text-xs">Alasan Penolakan:</span><div className="font-medium text-red-700">{r.rejectionReason}</div></div>}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="due">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-orange-500" />Jadwal Service Jatuh Tempo (7 hari ke depan)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Kendaraan</TableHead><TableHead>Jadwal</TableHead><TableHead>Jatuh Tempo</TableHead><TableHead>Odometer Berikutnya</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {dueSchedules.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Tidak ada jadwal yang jatuh tempo</TableCell></TableRow>
                  ) : dueSchedules.map((s: { schedule: { id: number; scheduleName: string; nextDueDate?: string; nextDueKm?: number }; plateNumber?: string; unitNumber?: string }) => (
                    <TableRow key={s.schedule.id}>
                      <TableCell><div className="font-medium text-sm">{s.plateNumber ?? "—"}</div><div className="text-xs text-muted-foreground">{s.unitNumber ?? ""}</div></TableCell>
                      <TableCell className="text-sm">{s.schedule.scheduleName}</TableCell>
                      <TableCell className="text-sm font-medium text-orange-600">{s.schedule.nextDueDate ?? "—"}</TableCell>
                      <TableCell className="text-sm">{s.schedule.nextDueKm ? `${Number(s.schedule.nextDueKm).toLocaleString("id-ID")} km` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog Approve */}
      <Dialog open={approveId !== null} onOpenChange={v => !v && setApproveId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-600" />Setujui Maintenance</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Approval akan mengubah status ke <strong>Dalam Proses</strong>. Biaya tidak akan dibuat otomatis.</p>
          <div className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label className="text-xs">Biaya Aktual (Rp) — opsional</Label>
              <Input type="number" className="h-8 text-sm" placeholder="Kosongkan jika belum diketahui" value={approveForm.costActual} onChange={e => setApproveForm(f => ({ ...f, costActual: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bengkel — opsional</Label>
              <Input className="h-8 text-sm" value={approveForm.workshopName} onChange={e => setApproveForm(f => ({ ...f, workshopName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Catatan</Label>
              <Input className="h-8 text-sm" placeholder="Catatan approval" value={approveForm.notes} onChange={e => setApproveForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 p-3 rounded border bg-blue-50 border-blue-200">
              <input type="checkbox" id="genPR" className="h-4 w-4" checked={approveForm.generatePR} onChange={e => setApproveForm(f => ({ ...f, generatePR: e.target.checked }))} />
              <label htmlFor="genPR" className="text-sm text-blue-800 cursor-pointer">
                Buat <strong>Purchase Request Draft</strong> untuk finance (masih butuh review terpisah, tidak langsung bayar)
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setApproveId(null)}>Batal</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => approveMutation.mutate({ id: approveId!, body: { costActual: approveForm.costActual ? parseFloat(approveForm.costActual) : undefined, workshopName: approveForm.workshopName || undefined, generatePurchaseRequest: approveForm.generatePR, notes: approveForm.notes || undefined } })} disabled={approveMutation.isPending}>
              {approveMutation.isPending ? "Menyetujui..." : "Setujui"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Reject */}
      <Dialog open={rejectId !== null} onOpenChange={v => !v && setRejectId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><XCircle className="h-5 w-5 text-red-600" />Tolak Maintenance</DialogTitle></DialogHeader>
          <div className="space-y-2 mt-2">
            <Label className="text-xs">Alasan Penolakan</Label>
            <Textarea className="text-sm" rows={3} placeholder="Jelaskan alasan penolakan..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setRejectId(null)}>Batal</Button>
            <Button variant="destructive" onClick={() => rejectMutation.mutate({ id: rejectId!, reason: rejectReason })} disabled={rejectMutation.isPending}>
              {rejectMutation.isPending ? "Menolak..." : "Tolak"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Complete */}
      <Dialog open={completeId !== null} onOpenChange={v => !v && setCompleteId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-blue-600" />Tandai Selesai</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="space-y-1">
              <Label className="text-xs">Tanggal Selesai</Label>
              <Input type="date" className="h-8 text-sm" value={completeForm.completionDate} onChange={e => setCompleteForm(f => ({ ...f, completionDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Biaya Aktual (Rp)</Label>
              <Input type="number" className="h-8 text-sm" placeholder="0" value={completeForm.costActual} onChange={e => setCompleteForm(f => ({ ...f, costActual: e.target.value }))} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">URL Invoice — opsional</Label>
              <Input className="h-8 text-sm" placeholder="https://..." value={completeForm.invoiceUrl} onChange={e => setCompleteForm(f => ({ ...f, invoiceUrl: e.target.value }))} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Catatan</Label>
              <Input className="h-8 text-sm" placeholder="Catatan penyelesaian" value={completeForm.notes} onChange={e => setCompleteForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setCompleteId(null)}>Batal</Button>
            <Button onClick={() => completeMutation.mutate({ id: completeId!, body: { completionDate: completeForm.completionDate || undefined, costActual: completeForm.costActual ? parseFloat(completeForm.costActual) : undefined, invoiceUrl: completeForm.invoiceUrl || undefined, notes: completeForm.notes || undefined } })} disabled={completeMutation.isPending}>
              {completeMutation.isPending ? "Menyimpan..." : "Tandai Selesai"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
