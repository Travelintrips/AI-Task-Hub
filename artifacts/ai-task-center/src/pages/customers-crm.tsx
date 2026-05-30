import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Search, Phone, Mail, FileText, Edit, Trash2, X, ChevronRight, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "@/lib/auth-api";
import { Link } from "wouter";

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

interface Customer {
  id: number;
  companyName: string;
  picName: string | null;
  whatsapp: string | null;
  email: string | null;
  npwp: string | null;
  address: string | null;
  notes: string | null;
  totalTasks: number;
  aiSummary: string | null;
  createdAt: string;
}

const emptyForm = { companyName: "", picName: "", whatsapp: "", email: "", npwp: "", address: "", notes: "" };

export default function CustomersCrm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["crm-customers", search],
    queryFn: () => apiFetch(`/crm/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const createMut = useMutation({
    mutationFn: (data: typeof emptyForm) => apiFetch("/crm/customers", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["crm-customers"] }); setDialog(null); toast({ title: "Customer berhasil ditambahkan" }); },
    onError: () => toast({ title: "Gagal menambahkan customer", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof emptyForm }) => apiFetch(`/crm/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["crm-customers"] }); setDialog(null); toast({ title: "Customer diperbarui" }); },
    onError: () => toast({ title: "Gagal memperbarui customer", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/crm/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["crm-customers"] }); toast({ title: "Customer dihapus" }); },
  });

  const openCreate = () => { setForm(emptyForm); setEditTarget(null); setDialog("create"); };
  const openEdit = (c: Customer) => { setForm({ companyName: c.companyName, picName: c.picName ?? "", whatsapp: c.whatsapp ?? "", email: c.email ?? "", npwp: c.npwp ?? "", address: c.address ?? "", notes: c.notes ?? "" }); setEditTarget(c); setDialog("edit"); };
  const f = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6 text-primary" /> CRM Customer</h1>
          <p className="text-muted-foreground text-sm mt-1">{customers.length} customer terdaftar</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Tambah Customer</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Cari nama perusahaan, PIC, nomor WA..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
      ) : customers.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground"><Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" /><p className="font-medium">Belum ada data customer</p><p className="text-sm mt-1">Klik "Tambah Customer" untuk mulai</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => (
            <Card key={c.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {c.companyName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{c.companyName}</p>
                      {c.picName && <p className="text-xs text-muted-foreground truncate">{c.picName}</p>}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-xs">{c.totalTasks} task</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {c.whatsapp && <p className="text-xs flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3 w-3" />{c.whatsapp}</p>}
                {c.email && <p className="text-xs flex items-center gap-1.5 text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</p>}
                {c.address && <p className="text-xs text-muted-foreground line-clamp-1">{c.address}</p>}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => openEdit(c)}><Edit className="h-3 w-3 mr-1" /> Edit</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus customer ini?")) deleteMut.mutate(c.id); }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dialog === "create" ? "Tambah Customer Baru" : "Edit Customer"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Nama Perusahaan *</Label><Input className="mt-1" value={form.companyName} onChange={f("companyName")} placeholder="PT. Contoh Indonesia" /></div>
              <div><Label>Nama PIC</Label><Input className="mt-1" value={form.picName} onChange={f("picName")} placeholder="Budi Santoso" /></div>
              <div><Label>WhatsApp</Label><Input className="mt-1" value={form.whatsapp} onChange={f("whatsapp")} placeholder="628..." /></div>
              <div><Label>Email</Label><Input className="mt-1" type="email" value={form.email} onChange={f("email")} placeholder="pic@perusahaan.com" /></div>
              <div><Label>NPWP</Label><Input className="mt-1" value={form.npwp} onChange={f("npwp")} placeholder="01.234.567.8-901.000" /></div>
              <div className="col-span-2"><Label>Alamat</Label><Input className="mt-1" value={form.address} onChange={f("address")} /></div>
              <div className="col-span-2"><Label>Catatan</Label><Textarea className="mt-1" rows={3} value={form.notes} onChange={f("notes")} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={() => dialog === "create" ? createMut.mutate(form) : updateMut.mutate({ id: editTarget!.id, data: form })} disabled={!form.companyName || createMut.isPending || updateMut.isPending}>
              {dialog === "create" ? "Tambah" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
