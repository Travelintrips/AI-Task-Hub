import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Phone, Tag, Users2 } from "lucide-react";
import { getStoredToken } from "@/lib/auth-api";

async function apiFetch(path: string, opts?: RequestInit) {
  const token = getStoredToken();
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

interface NotificationReceiver {
  id: number;
  companyId: string;
  name: string;
  phone: string;
  category: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const PRESET_CATEGORIES = [
  "Sport Center",
  "Trucking",
  "Logistik",
  "Pengadaan",
  "Fleet",
  "Vendor",
  "Driver",
  "Customer",
  "Finance",
  "HR",
  "Umum",
];

const CATEGORY_COLORS: Record<string, string> = {
  "Sport Center": "bg-green-100 text-green-800",
  "Trucking": "bg-blue-100 text-blue-800",
  "Logistik": "bg-orange-100 text-orange-800",
  "Pengadaan": "bg-purple-100 text-purple-800",
  "Fleet": "bg-sky-100 text-sky-800",
  "Vendor": "bg-yellow-100 text-yellow-800",
  "Driver": "bg-red-100 text-red-800",
  "Customer": "bg-pink-100 text-pink-800",
  "Finance": "bg-teal-100 text-teal-800",
  "HR": "bg-indigo-100 text-indigo-800",
  "Umum": "bg-gray-100 text-gray-700",
};

function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category] ?? "bg-gray-100 text-gray-700";
}

const EMPTY_FORM = {
  name: "",
  phone: "",
  category: "",
  customCategory: "",
  description: "",
  isActive: true,
};

export default function NotificationReceiversPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NotificationReceiver | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<NotificationReceiver | null>(null);

  const { data: receivers = [], isLoading } = useQuery<NotificationReceiver[]>({
    queryKey: ["/api/notification-receivers"],
    queryFn: async () => {
      const res = await apiFetch("/api/notification-receivers");
      if (!res.ok) throw new Error("Gagal memuat data");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Partial<typeof EMPTY_FORM>) => {
      const res = await apiFetch("/api/notification-receivers", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Gagal menyimpan");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-receivers"] });
      toast({ title: "Berhasil", description: "Penerima notifikasi berhasil ditambahkan" });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<typeof EMPTY_FORM> }) => {
      const res = await apiFetch(`/api/notification-receivers/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Gagal memperbarui");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-receivers"] });
      toast({ title: "Berhasil", description: "Data berhasil diperbarui" });
      setDialogOpen(false);
      setEditingItem(null);
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/notification-receivers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-receivers"] });
      toast({ title: "Dihapus", description: "Penerima notifikasi dihapus" });
      setDeleteConfirm(null);
    },
    onError: () => {
      toast({ title: "Gagal", description: "Gagal menghapus data", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiFetch(`/api/notification-receivers/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Gagal memperbarui");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-receivers"] });
    },
  });

  function openCreate() {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(item: NotificationReceiver) {
    setEditingItem(item);
    const isPreset = PRESET_CATEGORIES.includes(item.category);
    setForm({
      name: item.name,
      phone: item.phone,
      category: isPreset ? item.category : "custom",
      customCategory: isPreset ? "" : item.category,
      description: item.description ?? "",
      isActive: item.isActive,
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    const resolvedCategory = form.category === "custom" ? form.customCategory.trim() : form.category;

    if (!form.name.trim() || !form.phone.trim() || !resolvedCategory) {
      toast({ title: "Form tidak lengkap", description: "Nama, nomor HP, dan kategori wajib diisi", variant: "destructive" });
      return;
    }

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      category: resolvedCategory,
      description: form.description.trim() || undefined,
      isActive: form.isActive,
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, body: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const allCategories = [...new Set(receivers.map((r) => r.category))].sort();
  const filtered = filterCategory === "all" ? receivers : receivers.filter((r) => r.category === filterCategory);

  const groupedByCategory = filtered.reduce<Record<string, NotificationReceiver[]>>((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {});

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Penerima Notifikasi
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Kelola nomor WhatsApp yang akan menerima notifikasi berdasarkan kategori atau jenis form
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Tambah Nomor
        </Button>
      </div>

      {/* Stats + Filter */}
      <div className="px-6 py-3 border-b flex items-center gap-4 shrink-0 bg-muted/30 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users2 className="h-4 w-4" />
          <span><strong className="text-foreground">{receivers.length}</strong> total penerima</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Tag className="h-4 w-4" />
          <span><strong className="text-foreground">{allCategories.length}</strong> kategori</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter kategori:</span>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-44 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Kategori</SelectItem>
              {allCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Memuat data...</div>
        ) : receivers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3 text-center">
            <Phone className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Belum ada penerima notifikasi.</p>
            <Button variant="outline" onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Tambah Nomor Pertama
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            Tidak ada penerima untuk kategori ini.
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedByCategory).map(([category, items]) => (
              <div key={category} className="rounded-lg border bg-card overflow-hidden">
                <div className={`px-4 py-2.5 flex items-center gap-2 border-b ${getCategoryColor(category)} bg-opacity-50`}>
                  <Tag className="h-3.5 w-3.5" />
                  <span className="font-semibold text-sm">{category}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">{items.length} nomor</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[220px]">Nama</TableHead>
                      <TableHead>Nomor WhatsApp</TableHead>
                      <TableHead>Keterangan</TableHead>
                      <TableHead className="w-[80px] text-center">Aktif</TableHead>
                      <TableHead className="w-[100px] text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id} className={!item.isActive ? "opacity-50" : ""}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                            +{item.phone.replace(/^62/, "62").replace(/(\d{2})(\d{3,4})(\d{4})(\d+)/, "$1-$2-$3-$4")}
                          </code>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.description ?? <span className="italic">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={item.isActive}
                            onCheckedChange={(val) => toggleActiveMutation.mutate({ id: item.id, isActive: val })}
                            className="data-[state=checked]:bg-green-500"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(item)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteConfirm(item)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditingItem(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Penerima" : "Tambah Penerima Notifikasi"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nama <span className="text-destructive">*</span></Label>
              <Input
                placeholder="cth: Admin Sport Center"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Nomor WhatsApp <span className="text-destructive">*</span></Label>
              <Input
                placeholder="cth: 08123456789 atau 628123456789"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Nomor akan diformat otomatis ke format 62xxx</p>
            </div>

            <div className="space-y-1.5">
              <Label>Kategori / Jenis Form <span className="text-destructive">*</span></Label>
              <Select value={form.category} onValueChange={(val) => setForm((f) => ({ ...f, category: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih kategori..." />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                  <SelectItem value="custom">+ Kategori lain...</SelectItem>
                </SelectContent>
              </Select>

              {form.category === "custom" && (
                <Input
                  className="mt-2"
                  placeholder="Tulis nama kategori baru..."
                  value={form.customCategory}
                  onChange={(e) => setForm((f) => ({ ...f, customCategory: e.target.value }))}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Keterangan <span className="text-muted-foreground text-xs">(opsional)</span></Label>
              <Textarea
                placeholder="cth: Menerima notifikasi pemesanan lapangan badminton"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="isActive"
                checked={form.isActive}
                onCheckedChange={(val) => setForm((f) => ({ ...f, isActive: val }))}
              />
              <Label htmlFor="isActive" className="cursor-pointer">Aktif (akan menerima notifikasi)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingItem(null); setForm(EMPTY_FORM); }}>
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? "Menyimpan..." : editingItem ? "Simpan Perubahan" : "Tambahkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Penerima?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Nomor <strong>{deleteConfirm?.name}</strong> ({deleteConfirm?.phone}) akan dihapus dari daftar penerima notifikasi.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Batal</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
