import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Search, Send, Check, X, Edit, Trash2, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "@/lib/auth-api";
import { format } from "date-fns";
import { id } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, init?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

interface Quotation {
  id: number;
  quotationNumber: string | null;
  title: string;
  customerName: string | null;
  status: string;
  totalAmount: number;
  currency: string;
  freightCost: number;
  customsCost: number;
  truckingCost: number;
  handlingCost: number;
  otherCharges: number;
  description: string | null;
  notes: string | null;
  validUntil: string | null;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:    { label: "Draft",    color: "bg-gray-100 text-gray-700" },
  sent:     { label: "Terkirim", color: "bg-blue-100 text-blue-700" },
  accepted: { label: "Diterima", color: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak",  color: "bg-red-100 text-red-700" },
};

const emptyForm = { title: "", customerName: "", description: "", freightCost: "0", customsCost: "0", truckingCost: "0", handlingCost: "0", otherCharges: "0", currency: "IDR", notes: "", validUntil: "" };

function formatIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n); }

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<Quotation | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: quotations = [], isLoading } = useQuery<Quotation[]>({
    queryKey: ["quotations"],
    queryFn: () => apiFetch("/quotations"),
    refetchInterval: 30000,
  });

  const filtered = quotations.filter((q) => {
    const matchSearch = !search || q.title.toLowerCase().includes(search.toLowerCase()) || (q.customerName ?? "").toLowerCase().includes(search.toLowerCase()) || (q.quotationNumber ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || q.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const createMut = useMutation({
    mutationFn: (data: typeof emptyForm) => apiFetch("/quotations", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); setDialog(null); toast({ title: "Quotation dibuat" }); },
    onError: () => toast({ title: "Gagal membuat quotation", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<typeof emptyForm> & { status?: string } }) => apiFetch(`/quotations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); setDialog(null); toast({ title: "Quotation diperbarui" }); },
    onError: () => toast({ title: "Gagal memperbarui", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/quotations/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); toast({ title: "Quotation dihapus" }); },
  });

  const openCreate = () => { setForm(emptyForm); setEditTarget(null); setDialog("create"); };
  const openEdit = (q: Quotation) => { setForm({ title: q.title, customerName: q.customerName ?? "", description: q.description ?? "", freightCost: String(q.freightCost ?? 0), customsCost: String(q.customsCost ?? 0), truckingCost: String(q.truckingCost ?? 0), handlingCost: String(q.handlingCost ?? 0), otherCharges: String(q.otherCharges ?? 0), currency: q.currency, notes: q.notes ?? "", validUntil: q.validUntil ? q.validUntil.slice(0, 10) : "" }); setEditTarget(q); setDialog("edit"); };
  const f = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const calcTotal = () => ["freightCost", "customsCost", "truckingCost", "handlingCost", "otherCharges"].reduce((s, k) => s + (parseFloat(form[k as keyof typeof emptyForm]) || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="h-6 w-6 text-primary" />Quotation</h1><p className="text-muted-foreground text-sm mt-1">{quotations.length} quotation total</p></div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Buat Quotation</Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Cari judul, customer, nomor..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua Status</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="sent">Terkirim</SelectItem><SelectItem value="accepted">Diterima</SelectItem><SelectItem value="rejected">Ditolak</SelectItem></SelectContent></Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground"><DollarSign className="h-12 w-12 mx-auto mb-3 opacity-30" /><p className="font-medium">Belum ada quotation</p></CardContent></Card>
      ) : (
        <div className="grid gap-4">
          {filtered.map((q) => {
            const st = STATUS_CONFIG[q.status] ?? STATUS_CONFIG.draft;
            return (
              <Card key={q.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-muted-foreground font-mono">{q.quotationNumber}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                      </div>
                      <p className="font-semibold">{q.title}</p>
                      {q.customerName && <p className="text-sm text-muted-foreground">{q.customerName}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg">{formatIDR(q.totalAmount ?? 0)}</p>
                      {q.validUntil && <p className="text-xs text-muted-foreground">Valid s/d {format(new Date(q.validUntil), "dd MMM yyyy", { locale: id })}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2 mt-3 pt-3 border-t text-xs text-muted-foreground">
                    {[["Freight", q.freightCost], ["Customs", q.customsCost], ["Trucking", q.truckingCost], ["Handling", q.handlingCost], ["Lainnya", q.otherCharges]].map(([label, val]) => (
                      <div key={String(label)} className="text-center"><p className="font-medium text-foreground">{formatIDR(Number(val) || 0)}</p><p>{label}</p></div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {q.status === "draft" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateMut.mutate({ id: q.id, data: { status: "sent" } })}><Send className="h-3 w-3 mr-1" />Kirim</Button>}
                    {q.status === "sent" && <>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50" onClick={() => updateMut.mutate({ id: q.id, data: { status: "accepted" } })}><Check className="h-3 w-3 mr-1" />Diterima</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-700 border-red-200 hover:bg-red-50" onClick={() => updateMut.mutate({ id: q.id, data: { status: "rejected" } })}><X className="h-3 w-3 mr-1" />Ditolak</Button>
                    </>}
                    <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => openEdit(q)}><Edit className="h-3 w-3 mr-1" />Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus quotation ini?")) deleteMut.mutate(q.id); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{dialog === "create" ? "Buat Quotation Baru" : "Edit Quotation"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Judul *</Label><Input className="mt-1" value={form.title} onChange={f("title")} placeholder="Import FCL - PT. Contoh" /></div>
            <div><Label>Nama Customer</Label><Input className="mt-1" value={form.customerName} onChange={f("customerName")} /></div>
            <div className="grid grid-cols-2 gap-3">
              {[["freightCost", "Freight Cost"], ["customsCost", "Customs Cost"], ["truckingCost", "Trucking Cost"], ["handlingCost", "Handling Cost"], ["otherCharges", "Biaya Lain"]].map(([k, label]) => (
                <div key={k}><Label>{label}</Label><Input className="mt-1" type="number" value={form[k as keyof typeof emptyForm]} onChange={f(k as keyof typeof emptyForm)} /></div>
              ))}
              <div><Label>Mata Uang</Label><Select value={form.currency} onValueChange={(v) => setForm((p) => ({ ...p, currency: v }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="IDR">IDR</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></div>
            </div>
            <div className="rounded-lg bg-primary/5 p-3 flex justify-between items-center"><span className="font-medium text-sm">Total</span><span className="font-bold text-lg">{formatIDR(calcTotal())}</span></div>
            <div><Label>Berlaku Sampai</Label><Input className="mt-1" type="date" value={form.validUntil} onChange={f("validUntil")} /></div>
            <div><Label>Keterangan</Label><Textarea className="mt-1" rows={2} value={form.description} onChange={f("description")} /></div>
            <div><Label>Catatan Internal</Label><Textarea className="mt-1" rows={2} value={form.notes} onChange={f("notes")} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={() => dialog === "create" ? createMut.mutate(form) : updateMut.mutate({ id: editTarget!.id, data: form })} disabled={!form.title || createMut.isPending || updateMut.isPending}>
              {dialog === "create" ? "Buat" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
