/**
 * Sport Center Booking Management Page — Admin
 * Route: /sport-center
 * Auth required.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Dumbbell, Plus, RefreshCw, Search, CheckCircle, XCircle, CalendarDays, Clock, Phone, User } from "lucide-react";

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

type Booking = {
  id: number;
  booking_number?: string;
  facility_name?: string;
  field_type: string;
  booking_date: string;
  start_time: string;
  end_time?: string;
  duration_hours?: number;
  booker_name?: string;
  phone?: string;
  status: string;
  payment_status?: string;
  total_price?: number;
  payment_deadline?: string;
  payment_proof_url?: string;
  admin_notes?: string;
  notes?: string;
  created_at: string;
};

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  pending:    { cls: "bg-yellow-100 text-yellow-800 border-yellow-300",  label: "Menunggu" },
  confirmed:  { cls: "bg-green-100 text-green-800 border-green-300",    label: "Dikonfirmasi" },
  cancelled:  { cls: "bg-red-100 text-red-800 border-red-300",          label: "Dibatalkan" },
  completed:  { cls: "bg-blue-100 text-blue-800 border-blue-300",       label: "Selesai" },
};

const PAYMENT_CFG: Record<string, { cls: string; label: string }> = {
  unpaid:               { cls: "bg-gray-100 text-gray-600 border-gray-300",   label: "Belum Bayar" },
  waiting_verification: { cls: "bg-orange-100 text-orange-700 border-orange-300", label: "Menunggu Verif" },
  paid:                 { cls: "bg-green-100 text-green-700 border-green-300",  label: "Lunas" },
  cancelled:            { cls: "bg-red-100 text-red-700 border-red-300",        label: "Dibatalkan" },
};

const FIELD_OPTIONS = ["all", "Badminton", "Futsal", "Tennis", "Basketball", "Voli", "GYM", "Billiard"];
const STATUS_OPTIONS = ["all", "pending", "confirmed", "cancelled", "completed"];

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.pending;
  return <Badge className={`${c.cls} border text-xs font-medium`}>{c.label}</Badge>;
}
function PaymentBadge({ status }: { status: string }) {
  const c = PAYMENT_CFG[status] ?? PAYMENT_CFG.unpaid;
  return <Badge className={`${c.cls} border text-xs font-medium`}>{c.label}</Badge>;
}

function formatCurrency(n?: number) {
  if (!n) return "—";
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function formatDate(d?: string) {
  if (!d) return "—";
  const date = new Date(d + "T12:00:00Z");
  return date.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function SportCenterPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const [createForm, setCreateForm] = useState({
    fieldType: "Badminton", bookingDate: "", startTime: "", endTime: "",
    durationHours: "1", bookerName: "", phone: "", notes: "",
  });

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (fieldFilter !== "all") params.set("field_type", fieldFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (dateFilter) params.set("date", dateFilter);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sport-center-bookings", search, fieldFilter, statusFilter, dateFilter],
    queryFn: () => apiFetch(`/sport-center/bookings?${params}`),
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["sport-center-stats"],
    queryFn: () => apiFetch("/sport-center/stats"),
    refetchInterval: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch(`/sport-center/bookings/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Booking berhasil diupdate" });
      queryClient.invalidateQueries({ queryKey: ["sport-center-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["sport-center-stats"] });
      setSelectedBooking(null);
    },
    onError: (e: Error) => toast({ title: "Gagal update", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("/sport-center/bookings", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Booking berhasil dibuat" });
      queryClient.invalidateQueries({ queryKey: ["sport-center-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["sport-center-stats"] });
      setIsCreateOpen(false);
      setCreateForm({ fieldType: "Badminton", bookingDate: "", startTime: "", endTime: "", durationHours: "1", bookerName: "", phone: "", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Gagal buat booking", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/sport-center/bookings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Booking dihapus" });
      queryClient.invalidateQueries({ queryKey: ["sport-center-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["sport-center-stats"] });
      setSelectedBooking(null);
    },
    onError: (e: Error) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const bookings: Booking[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const statusCounts = stats?.statusCounts ?? {};
  const todayBookings: Booking[] = stats?.todayBookings ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-6 w-6 text-orange-500" />
          <h1 className="text-2xl font-bold">Sport Center</h1>
          <Badge variant="outline" className="ml-1">{total} booking</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600">
                <Plus className="h-4 w-4 mr-1" />Booking Manual
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Buat Booking Manual</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="col-span-2">
                  <Label>Jenis Lapangan *</Label>
                  <Select value={createForm.fieldType} onValueChange={(v) => setCreateForm(f => ({ ...f, fieldType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.filter(f => f !== "all").map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {[
                  { key: "bookingDate", label: "Tanggal *", type: "date" },
                  { key: "startTime", label: "Jam Mulai *", type: "time" },
                  { key: "endTime", label: "Jam Selesai", type: "time" },
                  { key: "durationHours", label: "Durasi (jam)", type: "number" },
                  { key: "bookerName", label: "Nama Pemesan", type: "text" },
                  { key: "phone", label: "No. WA (628xxx)", type: "text" },
                ].map(({ key, label, type }) => (
                  <div key={key}>
                    <Label>{label}</Label>
                    <Input
                      type={type}
                      value={createForm[key as keyof typeof createForm]}
                      onChange={(e) => setCreateForm(f => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="col-span-2">
                  <Label>Catatan</Label>
                  <Input value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <Button
                className="w-full mt-3 bg-orange-500 hover:bg-orange-600"
                onClick={() => createMutation.mutate({
                  fieldType: createForm.fieldType, bookingDate: createForm.bookingDate,
                  startTime: createForm.startTime, endTime: createForm.endTime || undefined,
                  durationHours: createForm.durationHours ? parseFloat(createForm.durationHours) : undefined,
                  bookerName: createForm.bookerName || undefined, phone: createForm.phone || undefined,
                  notes: createForm.notes || undefined,
                })}
                disabled={createMutation.isPending || !createForm.bookingDate || !createForm.startTime}
              >
                {createMutation.isPending ? "Menyimpan..." : "Buat Booking"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Menunggu", value: statusCounts.pending ?? 0, cls: "text-yellow-600" },
          { label: "Dikonfirmasi", value: statusCounts.confirmed ?? 0, cls: "text-green-600" },
          { label: "Selesai", value: statusCounts.completed ?? 0, cls: "text-blue-600" },
          { label: "Dibatalkan", value: statusCounts.cancelled ?? 0, cls: "text-red-500" },
        ].map(s => (
          <Card key={s.label} className="p-3">
            <CardContent className="p-0 text-center">
              <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Today's Schedule */}
      {todayBookings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-orange-500" />
              Jadwal Hari Ini ({todayBookings.length} booking)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex gap-2 overflow-x-auto px-4 pb-3">
              {todayBookings.map(b => (
                <div key={b.id} className="min-w-[160px] bg-orange-50 border border-orange-200 rounded-lg p-2 text-xs">
                  <div className="font-semibold text-orange-700">{b.facility_name ?? b.field_type}</div>
                  <div className="flex items-center gap-1 text-gray-600 mt-0.5">
                    <Clock className="h-3 w-3" />
                    {b.start_time}{b.end_time ? ` – ${b.end_time}` : ""}
                  </div>
                  <div className="flex items-center gap-1 text-gray-600 mt-0.5">
                    <User className="h-3 w-3" />
                    {b.booker_name ?? "—"}
                  </div>
                  <StatusBadge status={b.status} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[160px]">
          <Label className="text-xs">Cari nama / no. WA</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Ahmad, 0812..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Lapangan</Label>
          <Select value={fieldFilter} onValueChange={setFieldFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FIELD_OPTIONS.map(f => <SelectItem key={f} value={f}>{f === "all" ? "Semua" : f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s === "all" ? "Semua" : STATUS_CFG[s]?.label ?? s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Tanggal</Label>
          <Input type="date" className="w-[150px]" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
        </div>
        {(search || fieldFilter !== "all" || statusFilter !== "all" || dateFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFieldFilter("all"); setStatusFilter("all"); setDateFilter(""); }}>
            Reset
          </Button>
        )}
      </div>

      {/* Booking Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead>No. Booking</TableHead>
              <TableHead>Lapangan</TableHead>
              <TableHead>Tanggal & Jam</TableHead>
              <TableHead>Pemesan</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pembayaran</TableHead>
              <TableHead>Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Memuat...</TableCell></TableRow>
            )}
            {!isLoading && bookings.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Tidak ada booking ditemukan</TableCell></TableRow>
            )}
            {bookings.map(b => (
              <TableRow key={b.id} className="text-sm">
                <TableCell className="font-mono text-xs font-semibold text-orange-600">
                  {b.booking_number ?? `#${b.id}`}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{b.facility_name ?? b.field_type}</div>
                  <div className="text-xs text-muted-foreground">{b.field_type}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-xs">
                    <CalendarDays className="h-3 w-3 text-gray-400" />
                    {formatDate(b.booking_date)}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {b.start_time}{b.end_time ? ` – ${b.end_time}` : ""}
                    {b.duration_hours ? ` (${b.duration_hours}j)` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-xs">
                    <User className="h-3 w-3 text-gray-400" />
                    {b.booker_name ?? "—"}
                  </div>
                  {b.phone && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {b.phone.replace(/^62/, "0")}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-semibold text-orange-600 text-xs">
                  {formatCurrency(b.total_price)}
                </TableCell>
                <TableCell><StatusBadge status={b.status} /></TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <PaymentBadge status={b.payment_status ?? "unpaid"} />
                    {b.payment_proof_url && (
                      <a href={b.payment_proof_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 underline">Lihat bukti</a>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {b.status === "pending" && (
                      <>
                        <Button size="sm" variant="outline"
                          className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                          onClick={() => updateMutation.mutate({ id: b.id, body: { status: "confirmed", paymentStatus: "paid" } })}>
                          <CheckCircle className="h-3 w-3 mr-1" />Konfirmasi
                        </Button>
                        <Button size="sm" variant="outline"
                          className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
                          onClick={() => updateMutation.mutate({ id: b.id, body: { status: "cancelled" } })}>
                          <XCircle className="h-3 w-3 mr-1" />Batal
                        </Button>
                      </>
                    )}
                    {b.payment_status === "waiting_verification" && b.status !== "cancelled" && (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                        onClick={() => updateMutation.mutate({ id: b.id, body: { paymentStatus: "paid", status: "confirmed" } })}>
                        ✓ Verif Bayar
                      </Button>
                    )}
                    {b.status === "confirmed" && (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                        onClick={() => updateMutation.mutate({ id: b.id, body: { status: "completed" } })}>
                        Selesai
                      </Button>
                    )}
                    <Button size="sm" variant="ghost"
                      className="h-7 text-xs text-gray-500"
                      onClick={() => setSelectedBooking(b)}>
                      Detail
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Detail Dialog */}
      {selectedBooking && (
        <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="text-orange-600 font-mono">{selectedBooking.booking_number ?? `#${selectedBooking.id}`}</span>
                <StatusBadge status={selectedBooking.status} />
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground text-xs">Fasilitas</span><div className="font-semibold">{selectedBooking.facility_name ?? selectedBooking.field_type}</div></div>
                <div><span className="text-muted-foreground text-xs">Tanggal</span><div className="font-semibold">{formatDate(selectedBooking.booking_date)}</div></div>
                <div><span className="text-muted-foreground text-xs">Jam</span><div className="font-semibold">{selectedBooking.start_time}{selectedBooking.end_time ? ` – ${selectedBooking.end_time}` : ""}</div></div>
                <div><span className="text-muted-foreground text-xs">Total</span><div className="font-semibold text-orange-600">{formatCurrency(selectedBooking.total_price)}</div></div>
                <div><span className="text-muted-foreground text-xs">Pemesan</span><div>{selectedBooking.booker_name ?? "—"}</div></div>
                <div><span className="text-muted-foreground text-xs">No. WA</span><div>{selectedBooking.phone ? selectedBooking.phone.replace(/^62/, "0") : "—"}</div></div>
                <div><span className="text-muted-foreground text-xs">Pembayaran</span><div><PaymentBadge status={selectedBooking.payment_status ?? "unpaid"} /></div></div>
                <div><span className="text-muted-foreground text-xs">Deadline Bayar</span><div className="text-xs">{selectedBooking.payment_deadline ? new Date(selectedBooking.payment_deadline).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "—"}</div></div>
              </div>
              {selectedBooking.notes && <div><span className="text-muted-foreground text-xs">Catatan</span><div>{selectedBooking.notes}</div></div>}
              {selectedBooking.payment_proof_url && (
                <div>
                  <span className="text-muted-foreground text-xs">Bukti Transfer</span>
                  <div><a href={selectedBooking.payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-sm">Lihat bukti transfer ↗</a></div>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                {selectedBooking.status === "pending" && (
                  <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => updateMutation.mutate({ id: selectedBooking.id, body: { status: "confirmed", paymentStatus: "paid" } })}
                    disabled={updateMutation.isPending}>
                    <CheckCircle className="h-4 w-4 mr-1" />Konfirmasi & Lunas
                  </Button>
                )}
                {selectedBooking.status !== "cancelled" && selectedBooking.status !== "completed" && (
                  <Button variant="outline" className="flex-1 text-red-600 border-red-300"
                    onClick={() => updateMutation.mutate({ id: selectedBooking.id, body: { status: "cancelled" } })}
                    disabled={updateMutation.isPending}>
                    <XCircle className="h-4 w-4 mr-1" />Batalkan
                  </Button>
                )}
                <Button variant="ghost" className="text-gray-500 hover:text-red-600"
                  onClick={() => { if (confirm("Hapus booking ini?")) deleteMutation.mutate(selectedBooking.id); }}>
                  Hapus
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
