import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  Brain, Hash, Package, FileText, FolderOpen, PlayCircle,
  RefreshCw, BarChart2, Plus, Pencil, Trash2, Check, X,
  Search, ChevronDown, ChevronRight, AlertCircle, Loader2,
  TrendingUp, Tag, Layers, ListChecks,
} from "lucide-react";

import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch }   from "@/components/ui/switch";
import { Label }    from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth }  from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntentMaster {
  id: number; companyId: string; intentCode: string; intentName: string;
  category: string | null; description: string | null; suggestedCategory: string | null;
  suggestedDivision: string | null; suggestedPriority: string; slaHours: number | null;
  isActive: boolean; createdAt: string;
}
interface KeywordRule {
  id: number; companyId: string; keyword: string; intentCode: string;
  weight: number; isActive: boolean; createdAt: string;
}
interface ServiceCatalog {
  id: number; companyId: string; serviceCode: string | null; serviceName: string;
  category: string | null; description: string | null; basePrice: string | null;
  currency: string | null; estimatedDays: string | null; slaHours: string | null;
  suggestedTeam: string | null; isActive: boolean; createdAt: string;
}
interface DataTemplateField {
  id: number; templateId: number; fieldName: string; fieldLabel: string;
  fieldType: string; isRequired: boolean; sortOrder: number;
  helpText: string | null; sampleValue: string | null;
}
interface DataTemplate {
  id: number; companyId: string; name: string; category: string | null;
  description: string | null; isActive: boolean; createdAt: string;
  fields: DataTemplateField[];
}
interface DocTemplateField {
  id: number; templateId: number; documentName: string; documentType: string | null;
  isRequired: boolean; description: string | null; sortOrder: number;
  exampleFileDescription: string | null;
}
interface DocTemplate {
  id: number; companyId: string; name: string; category: string | null;
  description: string | null; isActive: boolean; createdAt: string;
  fields: DocTemplateField[];
}
interface KbStats {
  intents: number; keywords: number; services: number;
  dataTemplates: number; documentTemplates: number;
}
interface KbAnalytics {
  summary: { totalIntents: number; activeIntents: number; inactiveIntents: number; totalKeywords: number; totalServices: number };
  intentsByCategory: { category: string; count: number }[];
  topIntentsByKeyword: { intentCode: string; keywordCount: number }[];
  servicesByCategory: { category: string; count: number }[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  if (!res.ok) { const b = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }; throw new Error(b.error ?? `HTTP ${res.status}`); }
  return res.json() as Promise<T>;
}

const api = {
  stats:             ()         => apiFetch<KbStats>("/api/knowledge-base/stats"),
  analytics:         ()         => apiFetch<KbAnalytics>("/api/knowledge-base/analytics"),
  simulate:          (body: object) => apiFetch<object>("/api/knowledge-base/simulator", { method: "POST", body: JSON.stringify(body) }),
  cacheReload:       ()         => apiFetch<{ success: boolean; reloadedAt: string }>("/api/knowledge-base/cache/reload", { method: "POST" }),
  intents:           ()         => apiFetch<IntentMaster[]>("/api/intent-master"),
  createIntent:      (b: object) => apiFetch<IntentMaster>("/api/intent-master", { method: "POST", body: JSON.stringify(b) }),
  updateIntent:      (id: number, b: object) => apiFetch<IntentMaster>(`/api/intent-master/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteIntent:      (id: number) => apiFetch<void>(`/api/intent-master/${id}`, { method: "DELETE" }),
  keywords:          ()         => apiFetch<KeywordRule[]>("/api/keyword-rules"),
  createKeyword:     (b: object) => apiFetch<KeywordRule>("/api/keyword-rules", { method: "POST", body: JSON.stringify(b) }),
  updateKeyword:     (id: number, b: object) => apiFetch<KeywordRule>(`/api/keyword-rules/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteKeyword:     (id: number) => apiFetch<void>(`/api/keyword-rules/${id}`, { method: "DELETE" }),
  services:          ()         => apiFetch<ServiceCatalog[]>("/api/service-catalog"),
  createService:     (b: object) => apiFetch<ServiceCatalog>("/api/service-catalog", { method: "POST", body: JSON.stringify(b) }),
  updateService:     (id: number, b: object) => apiFetch<ServiceCatalog>(`/api/service-catalog/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteService:     (id: number) => apiFetch<void>(`/api/service-catalog/${id}`, { method: "DELETE" }),
  dataTpls:          ()         => apiFetch<DataTemplate[]>("/api/data-templates"),
  createDataTpl:     (b: object) => apiFetch<DataTemplate>("/api/data-templates", { method: "POST", body: JSON.stringify(b) }),
  updateDataTpl:     (id: number, b: object) => apiFetch<DataTemplate>(`/api/data-templates/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteDataTpl:     (id: number) => apiFetch<void>(`/api/data-templates/${id}`, { method: "DELETE" }),
  addDataField:      (tplId: number, b: object) => apiFetch<DataTemplateField>(`/api/data-templates/${tplId}/fields`, { method: "POST", body: JSON.stringify(b) }),
  deleteDataField:   (tplId: number, fId: number) => apiFetch<void>(`/api/data-templates/${tplId}/fields/${fId}`, { method: "DELETE" }),
  docTpls:           ()         => apiFetch<DocTemplate[]>("/api/document-templates"),
  createDocTpl:      (b: object) => apiFetch<DocTemplate>("/api/document-templates", { method: "POST", body: JSON.stringify(b) }),
  updateDocTpl:      (id: number, b: object) => apiFetch<DocTemplate>(`/api/document-templates/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteDocTpl:      (id: number) => apiFetch<void>(`/api/document-templates/${id}`, { method: "DELETE" }),
  addDocField:       (tplId: number, b: object) => apiFetch<DocTemplateField>(`/api/document-templates/${tplId}/fields`, { method: "POST", body: JSON.stringify(b) }),
  deleteDocField:    (tplId: number, fId: number) => apiFetch<void>(`/api/document-templates/${tplId}/fields/${fId}`, { method: "DELETE" }),
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function priorityBadge(p: string) {
  const map: Record<string, string> = { high: "bg-red-100 text-red-700", medium: "bg-yellow-100 text-yellow-700", low: "bg-green-100 text-green-700" };
  return <Badge className={`text-xs ${map[p] ?? "bg-gray-100 text-gray-600"}`}>{p}</Badge>;
}

function ActiveBadge({ v }: { v: boolean }) {
  return v
    ? <Badge className="bg-green-100 text-green-700 text-xs">Aktif</Badge>
    : <Badge className="bg-gray-100 text-gray-500 text-xs">Nonaktif</Badge>;
}

function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center py-12 text-muted-foreground">
        <p className="font-medium">{label}</p>
      </TableCell>
    </TableRow>
  );
}

function SkeletonRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: number | undefined; icon: React.ReactNode; color: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${color}`}>{icon}</div>
        <div>
          <p className="text-2xl font-bold">{value === undefined ? <Skeleton className="h-7 w-10 inline-block" /> : value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT MASTER TAB
// ═══════════════════════════════════════════════════════════════════════════════

function IntentMasterTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; row?: IntentMaster } | null>(null);
  const [form, setForm] = useState({ intentCode: "", intentName: "", category: "", description: "", suggestedPriority: "medium", suggestedDivision: "", slaHours: "", isActive: true });

  const { data, isLoading } = useQuery({ queryKey: ["intent-master"], queryFn: api.intents, staleTime: 30_000 });
  const mutCreate = useMutation({ mutationFn: api.createIntent, onSuccess: () => { qc.invalidateQueries({ queryKey: ["intent-master"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); setDialog(null); toast({ title: "Intent berhasil ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateIntent(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["intent-master"] }); setDialog(null); toast({ title: "Intent diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete = useMutation({ mutationFn: api.deleteIntent, onSuccess: () => { qc.invalidateQueries({ queryKey: ["intent-master"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); toast({ title: "Intent dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });

  const openAdd = () => { setForm({ intentCode: "", intentName: "", category: "", description: "", suggestedPriority: "medium", suggestedDivision: "", slaHours: "", isActive: true }); setDialog({ mode: "add" }); };
  const openEdit = (r: IntentMaster) => { setForm({ intentCode: r.intentCode, intentName: r.intentName, category: r.category ?? "", description: r.description ?? "", suggestedPriority: r.suggestedPriority, suggestedDivision: r.suggestedDivision ?? "", slaHours: r.slaHours?.toString() ?? "", isActive: r.isActive }); setDialog({ mode: "edit", row: r }); };

  const handleSave = () => {
    const payload = { ...form, slaHours: form.slaHours ? parseInt(form.slaHours, 10) : null };
    if (dialog?.mode === "add") mutCreate.mutate(payload);
    else if (dialog?.row) mutUpdate.mutate({ id: dialog.row.id, b: payload });
  };

  const filtered = (data ?? []).filter((r) => !search || r.intentCode.toLowerCase().includes(search.toLowerCase()) || r.intentName.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Cari intent…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {canEdit && <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah Intent</Button>}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Kode</TableHead><TableHead>Nama</TableHead><TableHead>Kategori</TableHead>
              <TableHead>Prioritas</TableHead><TableHead>SLA (jam)</TableHead><TableHead>Status</TableHead>
              {canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={canEdit ? 7 : 6} /> : !filtered.length ? <EmptyRow cols={canEdit ? 7 : 6} label="Belum ada intent" /> :
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm text-blue-600">{r.intentCode}</TableCell>
                  <TableCell className="font-medium">{r.intentName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.category ?? "—"}</TableCell>
                  <TableCell>{priorityBadge(r.suggestedPriority)}</TableCell>
                  <TableCell className="text-sm">{r.slaHours ?? "—"}</TableCell>
                  <TableCell><ActiveBadge v={r.isActive} /></TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus intent ini?")) mutDelete.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah Intent" : "Edit Intent"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Kode Intent *</Label><Input value={form.intentCode} onChange={(e) => setForm((f) => ({ ...f, intentCode: e.target.value }))} placeholder="cth: PENGIRIMAN" /></div>
              <div><Label className="text-xs mb-1">Nama Intent *</Label><Input value={form.intentName} onChange={(e) => setForm((f) => ({ ...f, intentName: e.target.value }))} placeholder="cth: Pengiriman Barang" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Kategori</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="cth: Logistik" /></div>
              <div><Label className="text-xs mb-1">Divisi</Label><Input value={form.suggestedDivision} onChange={(e) => setForm((f) => ({ ...f, suggestedDivision: e.target.value }))} placeholder="cth: Operasional" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Prioritas</Label>
                <Select value={form.suggestedPriority} onValueChange={(v) => setForm((f) => ({ ...f, suggestedPriority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs mb-1">SLA (jam)</Label><Input type="number" value={form.slaHours} onChange={(e) => setForm((f) => ({ ...f, slaHours: e.target.value }))} placeholder="cth: 24" /></div>
            </div>
            <div><Label className="text-xs mb-1">Deskripsi</Label><Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v })) } /><Label className="text-sm">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={handleSave} disabled={mutCreate.isPending || mutUpdate.isPending}>
              {(mutCreate.isPending || mutUpdate.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// KEYWORD RULES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function KeywordRulesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; row?: KeywordRule } | null>(null);
  const [form, setForm] = useState({ keyword: "", intentCode: "", weight: "1", isActive: true });

  const { data, isLoading } = useQuery({ queryKey: ["keyword-rules"], queryFn: api.keywords, staleTime: 30_000 });
  const mutCreate = useMutation({ mutationFn: api.createKeyword, onSuccess: () => { qc.invalidateQueries({ queryKey: ["keyword-rules"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); setDialog(null); toast({ title: "Keyword ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateKeyword(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["keyword-rules"] }); setDialog(null); toast({ title: "Keyword diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete = useMutation({ mutationFn: api.deleteKeyword, onSuccess: () => { qc.invalidateQueries({ queryKey: ["keyword-rules"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); toast({ title: "Keyword dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });

  const openAdd = () => { setForm({ keyword: "", intentCode: "", weight: "1", isActive: true }); setDialog({ mode: "add" }); };
  const openEdit = (r: KeywordRule) => { setForm({ keyword: r.keyword, intentCode: r.intentCode, weight: String(r.weight), isActive: r.isActive }); setDialog({ mode: "edit", row: r }); };

  const handleSave = () => {
    const payload = { ...form, weight: parseFloat(form.weight) || 1 };
    if (dialog?.mode === "add") mutCreate.mutate(payload);
    else if (dialog?.row) mutUpdate.mutate({ id: dialog.row.id, b: payload });
  };

  const filtered = (data ?? []).filter((r) => !search || r.keyword.toLowerCase().includes(search.toLowerCase()) || r.intentCode.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Cari keyword atau intent…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {canEdit && <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah Keyword</Button>}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Keyword</TableHead><TableHead>Intent Code</TableHead><TableHead>Bobot</TableHead><TableHead>Status</TableHead>
              {canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={canEdit ? 5 : 4} /> : !filtered.length ? <EmptyRow cols={canEdit ? 5 : 4} label="Belum ada keyword rule" /> :
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.keyword}</TableCell>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{r.intentCode}</Badge></TableCell>
                  <TableCell className="text-sm">{r.weight.toFixed(1)}</TableCell>
                  <TableCell><ActiveBadge v={r.isActive} /></TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus keyword ini?")) mutDelete.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah Keyword" : "Edit Keyword"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs mb-1">Keyword *</Label><Input value={form.keyword} onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))} placeholder="cth: kirim barang" /></div>
            <div><Label className="text-xs mb-1">Intent Code *</Label><Input value={form.intentCode} onChange={(e) => setForm((f) => ({ ...f, intentCode: e.target.value }))} placeholder="cth: PENGIRIMAN" /></div>
            <div><Label className="text-xs mb-1">Bobot (0.1 – 5.0)</Label><Input type="number" step="0.1" min="0.1" max="5" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} /><Label className="text-sm">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={handleSave} disabled={mutCreate.isPending || mutUpdate.isPending}>
              {(mutCreate.isPending || mutUpdate.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE CATALOG TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ServiceCatalogTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; row?: ServiceCatalog } | null>(null);
  const blank = { serviceCode: "", serviceName: "", category: "", description: "", basePrice: "", estimatedDays: "", slaHours: "", suggestedTeam: "", isActive: true };
  const [form, setForm] = useState(blank);

  const { data, isLoading } = useQuery({ queryKey: ["service-catalog"], queryFn: api.services, staleTime: 30_000 });
  const mutCreate = useMutation({ mutationFn: api.createService, onSuccess: () => { qc.invalidateQueries({ queryKey: ["service-catalog"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); setDialog(null); toast({ title: "Layanan ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateService(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["service-catalog"] }); setDialog(null); toast({ title: "Layanan diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete = useMutation({ mutationFn: api.deleteService, onSuccess: () => { qc.invalidateQueries({ queryKey: ["service-catalog"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); toast({ title: "Layanan dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });

  const openAdd = () => { setForm(blank); setDialog({ mode: "add" }); };
  const openEdit = (r: ServiceCatalog) => {
    setForm({ serviceCode: r.serviceCode ?? "", serviceName: r.serviceName, category: r.category ?? "", description: r.description ?? "", basePrice: r.basePrice ?? "", estimatedDays: r.estimatedDays ?? "", slaHours: r.slaHours ?? "", suggestedTeam: r.suggestedTeam ?? "", isActive: r.isActive });
    setDialog({ mode: "edit", row: r });
  };
  const handleSave = () => {
    if (dialog?.mode === "add") mutCreate.mutate(form);
    else if (dialog?.row) mutUpdate.mutate({ id: dialog.row.id, b: form });
  };

  const filtered = (data ?? []).filter((r) => !search || r.serviceName.toLowerCase().includes(search.toLowerCase()) || (r.serviceCode ?? "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Cari layanan…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {canEdit && <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah Layanan</Button>}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Kode</TableHead><TableHead>Nama Layanan</TableHead><TableHead>Kategori</TableHead>
              <TableHead>Tim</TableHead><TableHead>SLA</TableHead><TableHead>Status</TableHead>
              {canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={canEdit ? 7 : 6} /> : !filtered.length ? <EmptyRow cols={canEdit ? 7 : 6} label="Belum ada layanan" /> :
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.serviceCode ?? "—"}</TableCell>
                  <TableCell className="font-medium">{r.serviceName}</TableCell>
                  <TableCell className="text-sm">{r.category ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.suggestedTeam ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.slaHours ? `${r.slaHours}j` : "—"}</TableCell>
                  <TableCell><ActiveBadge v={r.isActive} /></TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus layanan ini?")) mutDelete.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah Layanan" : "Edit Layanan"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Kode Layanan</Label><Input value={form.serviceCode} onChange={(e) => setForm((f) => ({ ...f, serviceCode: e.target.value }))} placeholder="cth: SVC-001" /></div>
              <div><Label className="text-xs mb-1">Nama Layanan *</Label><Input value={form.serviceName} onChange={(e) => setForm((f) => ({ ...f, serviceName: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Kategori</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></div>
              <div><Label className="text-xs mb-1">Tim yang Disarankan</Label><Input value={form.suggestedTeam} onChange={(e) => setForm((f) => ({ ...f, suggestedTeam: e.target.value }))} placeholder="cth: Tim Operasional" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs mb-1">Harga Dasar</Label><Input value={form.basePrice} onChange={(e) => setForm((f) => ({ ...f, basePrice: e.target.value }))} placeholder="cth: 150000" /></div>
              <div><Label className="text-xs mb-1">Est. Hari</Label><Input value={form.estimatedDays} onChange={(e) => setForm((f) => ({ ...f, estimatedDays: e.target.value }))} placeholder="cth: 3" /></div>
              <div><Label className="text-xs mb-1">SLA (jam)</Label><Input value={form.slaHours} onChange={(e) => setForm((f) => ({ ...f, slaHours: e.target.value }))} placeholder="cth: 24" /></div>
            </div>
            <div><Label className="text-xs mb-1">Deskripsi</Label><Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} /><Label className="text-sm">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={handleSave} disabled={mutCreate.isPending || mutUpdate.isPending}>
              {(mutCreate.isPending || mutUpdate.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA TEMPLATES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function DataTemplatesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; tpl?: DataTemplate } | null>(null);
  const [fieldDialog, setFieldDialog] = useState<{ tplId: number } | null>(null);
  const [form, setForm] = useState({ name: "", category: "", description: "", isActive: true });
  const [fieldForm, setFieldForm] = useState({ fieldName: "", fieldLabel: "", fieldType: "text", isRequired: true, helpText: "", sampleValue: "" });

  const { data, isLoading } = useQuery({ queryKey: ["data-templates"], queryFn: api.dataTpls, staleTime: 30_000 });
  const mutCreate  = useMutation({ mutationFn: api.createDataTpl,  onSuccess: () => { qc.invalidateQueries({ queryKey: ["data-templates"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); setDialog(null); toast({ title: "Template ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate  = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateDataTpl(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["data-templates"] }); setDialog(null); toast({ title: "Template diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete  = useMutation({ mutationFn: api.deleteDataTpl,  onSuccess: () => { qc.invalidateQueries({ queryKey: ["data-templates"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); toast({ title: "Template dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutAddField   = useMutation({ mutationFn: ({ tplId, b }: { tplId: number; b: object }) => api.addDataField(tplId, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["data-templates"] }); setFieldDialog(null); toast({ title: "Field ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelField   = useMutation({ mutationFn: ({ tplId, fId }: { tplId: number; fId: number }) => api.deleteDataField(tplId, fId), onSuccess: () => { qc.invalidateQueries({ queryKey: ["data-templates"] }); toast({ title: "Field dihapus" }); } });

  const openAdd  = () => { setForm({ name: "", category: "", description: "", isActive: true }); setDialog({ mode: "add" }); };
  const openEdit = (t: DataTemplate) => { setForm({ name: t.name, category: t.category ?? "", description: t.description ?? "", isActive: t.isActive }); setDialog({ mode: "edit", tpl: t }); };
  const handleSave = () => {
    if (dialog?.mode === "add") mutCreate.mutate(form);
    else if (dialog?.tpl) mutUpdate.mutate({ id: dialog.tpl.id, b: form });
  };

  return (
    <div className="space-y-3">
      {canEdit && <div className="flex justify-end"><Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah Template</Button></div>}

      {isLoading ? <Skeleton className="h-24 w-full" /> : !(data ?? []).length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Belum ada data template</CardContent></Card>
      ) : (data ?? []).map((tpl) => (
        <Card key={tpl.id} className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30" onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)}>
            <div className="flex items-center gap-3">
              {expanded === tpl.id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <div>
                <p className="font-medium text-sm">{tpl.name}</p>
                <p className="text-xs text-muted-foreground">{tpl.category ?? "—"} · {tpl.fields.length} field</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ActiveBadge v={tpl.isActive} />
              {canEdit && (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(tpl)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus template ini?")) mutDelete.mutate(tpl.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          </div>

          {expanded === tpl.id && (
            <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
              {tpl.description && <p className="text-sm text-muted-foreground">{tpl.description}</p>}
              <Table>
                <TableHeader><TableRow className="bg-muted/40"><TableHead className="text-xs">Field</TableHead><TableHead className="text-xs">Label</TableHead><TableHead className="text-xs">Tipe</TableHead><TableHead className="text-xs">Contoh</TableHead><TableHead className="text-xs">Wajib</TableHead>{canEdit && <TableHead className="w-12" />}</TableRow></TableHeader>
                <TableBody>
                  {!tpl.fields.length ? <EmptyRow cols={canEdit ? 6 : 5} label="Belum ada field" /> :
                    tpl.fields.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-xs">{f.fieldName}</TableCell>
                        <TableCell className="text-sm">{f.fieldLabel}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.fieldType}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.sampleValue ?? "—"}</TableCell>
                        <TableCell>{f.isRequired ? <Check className="h-3.5 w-3.5 text-green-600" /> : <X className="h-3.5 w-3.5 text-gray-400" />}</TableCell>
                        {canEdit && <TableCell><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => { if (confirm("Hapus field?")) mutDelField.mutate({ tplId: tpl.id, fId: f.id }); }}><Trash2 className="h-3 w-3" /></Button></TableCell>}
                      </TableRow>
                    ))
                  }
                </TableBody>
              </Table>
              {canEdit && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setFieldForm({ fieldName: "", fieldLabel: "", fieldType: "text", isRequired: true, helpText: "", sampleValue: "" }); setFieldDialog({ tplId: tpl.id }); }}>
                  <Plus className="h-3.5 w-3.5" />Tambah Field
                </Button>
              )}
            </div>
          )}
        </Card>
      ))}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah Data Template" : "Edit Data Template"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs mb-1">Nama Template *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><Label className="text-xs mb-1">Kategori</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></div>
            <div><Label className="text-xs mb-1">Deskripsi</Label><Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} /><Label className="text-sm">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={handleSave} disabled={mutCreate.isPending || mutUpdate.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fieldDialog} onOpenChange={(o) => !o && setFieldDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Tambah Field</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Field Name *</Label><Input value={fieldForm.fieldName} onChange={(e) => setFieldForm((f) => ({ ...f, fieldName: e.target.value }))} placeholder="cth: no_ktp" /></div>
              <div><Label className="text-xs mb-1">Label *</Label><Input value={fieldForm.fieldLabel} onChange={(e) => setFieldForm((f) => ({ ...f, fieldLabel: e.target.value }))} placeholder="cth: Nomor KTP" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Tipe</Label>
                <Select value={fieldForm.fieldType} onValueChange={(v) => setFieldForm((f) => ({ ...f, fieldType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="date">Date</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="email">Email</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs mb-1">Contoh Nilai</Label><Input value={fieldForm.sampleValue} onChange={(e) => setFieldForm((f) => ({ ...f, sampleValue: e.target.value }))} placeholder="cth: 3271234567890001" /></div>
            </div>
            <div><Label className="text-xs mb-1">Help Text</Label><Input value={fieldForm.helpText} onChange={(e) => setFieldForm((f) => ({ ...f, helpText: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={fieldForm.isRequired} onCheckedChange={(v) => setFieldForm((f) => ({ ...f, isRequired: v }))} /><Label className="text-sm">Wajib diisi</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFieldDialog(null)}>Batal</Button>
            <Button onClick={() => fieldDialog && mutAddField.mutate({ tplId: fieldDialog.tplId, b: fieldForm })} disabled={mutAddField.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT TEMPLATES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function DocTemplatesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; tpl?: DocTemplate } | null>(null);
  const [fieldDialog, setFieldDialog] = useState<{ tplId: number } | null>(null);
  const [form, setForm] = useState({ name: "", category: "", description: "", isActive: true });
  const [fieldForm, setFieldForm] = useState({ documentName: "", documentType: "", isRequired: true, description: "", exampleFileDescription: "" });

  const { data, isLoading } = useQuery({ queryKey: ["doc-templates"], queryFn: api.docTpls, staleTime: 30_000 });
  const mutCreate  = useMutation({ mutationFn: api.createDocTpl,  onSuccess: () => { qc.invalidateQueries({ queryKey: ["doc-templates"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); setDialog(null); toast({ title: "Template ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate  = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateDocTpl(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["doc-templates"] }); setDialog(null); toast({ title: "Template diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete  = useMutation({ mutationFn: api.deleteDocTpl,  onSuccess: () => { qc.invalidateQueries({ queryKey: ["doc-templates"] }); qc.invalidateQueries({ queryKey: ["kb-stats"] }); toast({ title: "Template dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutAddField   = useMutation({ mutationFn: ({ tplId, b }: { tplId: number; b: object }) => api.addDocField(tplId, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["doc-templates"] }); setFieldDialog(null); toast({ title: "Dokumen ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelField   = useMutation({ mutationFn: ({ tplId, fId }: { tplId: number; fId: number }) => api.deleteDocField(tplId, fId), onSuccess: () => { qc.invalidateQueries({ queryKey: ["doc-templates"] }); toast({ title: "Dokumen dihapus" }); } });

  const openAdd  = () => { setForm({ name: "", category: "", description: "", isActive: true }); setDialog({ mode: "add" }); };
  const openEdit = (t: DocTemplate) => { setForm({ name: t.name, category: t.category ?? "", description: t.description ?? "", isActive: t.isActive }); setDialog({ mode: "edit", tpl: t }); };
  const handleSave = () => {
    if (dialog?.mode === "add") mutCreate.mutate(form);
    else if (dialog?.tpl) mutUpdate.mutate({ id: dialog.tpl.id, b: form });
  };

  return (
    <div className="space-y-3">
      {canEdit && <div className="flex justify-end"><Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah Template</Button></div>}

      {isLoading ? <Skeleton className="h-24 w-full" /> : !(data ?? []).length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Belum ada document template</CardContent></Card>
      ) : (data ?? []).map((tpl) => (
        <Card key={tpl.id} className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30" onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)}>
            <div className="flex items-center gap-3">
              {expanded === tpl.id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <div>
                <p className="font-medium text-sm">{tpl.name}</p>
                <p className="text-xs text-muted-foreground">{tpl.category ?? "—"} · {tpl.fields.length} dokumen</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ActiveBadge v={tpl.isActive} />
              {canEdit && (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(tpl)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus template ini?")) mutDelete.mutate(tpl.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          </div>

          {expanded === tpl.id && (
            <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
              {tpl.description && <p className="text-sm text-muted-foreground">{tpl.description}</p>}
              <Table>
                <TableHeader><TableRow className="bg-muted/40"><TableHead className="text-xs">Nama Dokumen</TableHead><TableHead className="text-xs">Tipe</TableHead><TableHead className="text-xs">Contoh File</TableHead><TableHead className="text-xs">Wajib</TableHead>{canEdit && <TableHead className="w-12" />}</TableRow></TableHeader>
                <TableBody>
                  {!tpl.fields.length ? <EmptyRow cols={canEdit ? 5 : 4} label="Belum ada dokumen" /> :
                    tpl.fields.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="text-sm font-medium">{f.documentName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.documentType ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.exampleFileDescription ?? "—"}</TableCell>
                        <TableCell>{f.isRequired ? <Check className="h-3.5 w-3.5 text-green-600" /> : <X className="h-3.5 w-3.5 text-gray-400" />}</TableCell>
                        {canEdit && <TableCell><Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => { if (confirm("Hapus dokumen?")) mutDelField.mutate({ tplId: tpl.id, fId: f.id }); }}><Trash2 className="h-3 w-3" /></Button></TableCell>}
                      </TableRow>
                    ))
                  }
                </TableBody>
              </Table>
              {canEdit && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setFieldForm({ documentName: "", documentType: "", isRequired: true, description: "", exampleFileDescription: "" }); setFieldDialog({ tplId: tpl.id }); }}>
                  <Plus className="h-3.5 w-3.5" />Tambah Dokumen
                </Button>
              )}
            </div>
          )}
        </Card>
      ))}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah Document Template" : "Edit Document Template"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs mb-1">Nama Template *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><Label className="text-xs mb-1">Kategori</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></div>
            <div><Label className="text-xs mb-1">Deskripsi</Label><Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} /><Label className="text-sm">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={handleSave} disabled={mutCreate.isPending || mutUpdate.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fieldDialog} onOpenChange={(o) => !o && setFieldDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Tambah Dokumen Required</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Nama Dokumen *</Label><Input value={fieldForm.documentName} onChange={(e) => setFieldForm((f) => ({ ...f, documentName: e.target.value }))} placeholder="cth: KTP" /></div>
              <div><Label className="text-xs mb-1">Tipe File</Label><Input value={fieldForm.documentType} onChange={(e) => setFieldForm((f) => ({ ...f, documentType: e.target.value }))} placeholder="cth: PDF/JPG" /></div>
            </div>
            <div><Label className="text-xs mb-1">Deskripsi</Label><Input value={fieldForm.description} onChange={(e) => setFieldForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div><Label className="text-xs mb-1">Contoh File / Keterangan</Label><Input value={fieldForm.exampleFileDescription} onChange={(e) => setFieldForm((f) => ({ ...f, exampleFileDescription: e.target.value }))} placeholder="cth: KTP asli scan resolusi 300dpi" /></div>
            <div className="flex items-center gap-2"><Switch checked={fieldForm.isRequired} onCheckedChange={(v) => setFieldForm((f) => ({ ...f, isRequired: v }))} /><Label className="text-sm">Wajib dilampirkan</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFieldDialog(null)}>Batal</Button>
            <Button onClick={() => fieldDialog && mutAddField.mutate({ tplId: fieldDialog.tplId, b: fieldForm })} disabled={mutAddField.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATOR TAB
// ═══════════════════════════════════════════════════════════════════════════════

function SimulatorTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [result, setResult] = useState<null | {
    input: string; companyId: string; matchedKeywords: { keyword: string; intentCode: string; weight: number }[];
    rankedIntents: { intentCode: string; score: number; intent: IntentMaster | null }[];
    topIntent: { intentCode: string; intentName: string; score: number; suggestedPriority: string; suggestedDivision: string | null; slaHours: number | null } | null;
    totalMatches: number;
  }>(null);
  const [loading, setLoading] = useState(false);

  const runSim = async () => {
    if (!message.trim()) return;
    setLoading(true);
    try {
      const body: Record<string, string> = { message };
      if (isSuperAdmin && companyId.trim()) body.companyId = companyId.trim();
      const res = await api.simulate(body) as typeof result;
      setResult(res);
    } catch (e) {
      toast({ title: "Simulator error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <Label className="text-xs mb-1">Pesan WhatsApp (simulasi)</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Masukkan contoh pesan customer…" rows={3} onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) runSim(); }} />
            <p className="text-xs text-muted-foreground mt-1">Ctrl+Enter untuk jalankan</p>
          </div>
          {isSuperAdmin && (
            <div>
              <Label className="text-xs mb-1">Company ID (opsional, khusus super admin)</Label>
              <Input value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="cth: default" className="max-w-xs" />
            </div>
          )}
          <Button onClick={runSim} disabled={loading || !message.trim()} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Jalankan Simulator
          </Button>
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-3">
          {result.topIntent ? (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-4">
                <p className="text-sm font-semibold text-green-700 mb-2">✅ Intent Terdeteksi</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground text-xs">Intent:</span><p className="font-mono font-semibold">{result.topIntent.intentCode}</p></div>
                  <div><span className="text-muted-foreground text-xs">Nama:</span><p>{result.topIntent.intentName}</p></div>
                  <div><span className="text-muted-foreground text-xs">Score:</span><p className="font-bold">{result.topIntent.score.toFixed(2)}</p></div>
                  <div><span className="text-muted-foreground text-xs">Prioritas:</span>{priorityBadge(result.topIntent.suggestedPriority)}</div>
                  {result.topIntent.suggestedDivision && <div><span className="text-muted-foreground text-xs">Divisi:</span><p>{result.topIntent.suggestedDivision}</p></div>}
                  {result.topIntent.slaHours && <div><span className="text-muted-foreground text-xs">SLA:</span><p>{result.topIntent.slaHours} jam</p></div>}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-yellow-200 bg-yellow-50">
              <CardContent className="p-4 flex items-center gap-2 text-yellow-700">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">Tidak ada intent yang cocok ditemukan. Coba tambahkan keyword yang lebih relevan.</span>
              </CardContent>
            </Card>
          )}

          {result.matchedKeywords.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Keyword Cocok ({result.totalMatches})</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  {result.matchedKeywords.map((kw, i) => (
                    <Badge key={i} variant="outline" className="gap-1 font-mono text-xs">
                      {kw.keyword} <span className="text-muted-foreground">→ {kw.intentCode} ({kw.weight})</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {result.rankedIntents.length > 1 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Semua Intent Ranked</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-1">
                {result.rankedIntents.map((ri, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                    <span className="font-mono text-blue-600">{ri.intentCode}</span>
                    <div className="flex items-center gap-3">
                      {ri.intent && priorityBadge(ri.intent.suggestedPriority)}
                      <span className="font-bold text-xs bg-muted px-2 py-0.5 rounded">{ri.score.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB (read-only)
// ═══════════════════════════════════════════════════════════════════════════════

function AnalyticsTab() {
  const { data, isLoading } = useQuery({ queryKey: ["kb-analytics"], queryFn: api.analytics, staleTime: 60_000 });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Total Intent"    value={data.summary.totalIntents}   icon={<Brain className="h-5 w-5 text-purple-600" />}  color="bg-purple-50" />
        <StatCard label="Intent Aktif"    value={data.summary.activeIntents}  icon={<Check className="h-5 w-5 text-green-600" />}   color="bg-green-50" />
        <StatCard label="Nonaktif"        value={data.summary.inactiveIntents} icon={<X className="h-5 w-5 text-gray-500" />}       color="bg-gray-50" />
        <StatCard label="Total Keyword"   value={data.summary.totalKeywords}  icon={<Hash className="h-5 w-5 text-blue-600" />}     color="bg-blue-50" />
        <StatCard label="Total Layanan"   value={data.summary.totalServices}  icon={<Package className="h-5 w-5 text-orange-600" />} color="bg-orange-50" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Tag className="h-4 w-4" />Intent per Kategori</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">
            {!data.intentsByCategory.length ? <p className="text-sm text-muted-foreground">Belum ada data</p> :
              data.intentsByCategory.map((r) => (
                <div key={r.category} className="flex items-center justify-between text-sm">
                  <span>{r.category}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(8, (r.count / Math.max(...data.intentsByCategory.map((x) => x.count))) * 80)}px` }} />
                    <span className="font-mono text-xs font-bold w-6 text-right">{r.count}</span>
                  </div>
                </div>
              ))
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Intent dengan Keyword Terbanyak</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">
            {!data.topIntentsByKeyword.length ? <p className="text-sm text-muted-foreground">Belum ada data</p> :
              data.topIntentsByKeyword.map((r, i) => (
                <div key={r.intentCode} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span className="text-xs text-muted-foreground w-4">{i + 1}.</span><span className="font-mono text-blue-600 text-xs">{r.intentCode}</span></span>
                  <Badge variant="outline" className="font-mono text-xs">{r.keywordCount} keyword</Badge>
                </div>
              ))
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4" />Layanan per Kategori</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">
            {!data.servicesByCategory.length ? <p className="text-sm text-muted-foreground">Belum ada data</p> :
              data.servicesByCategory.map((r) => (
                <div key={r.category} className="flex items-center justify-between text-sm">
                  <span>{r.category}</span>
                  <Badge variant="outline" className="font-mono text-xs">{r.count}</Badge>
                </div>
              ))
            }
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_TABS = ["intents", "keywords", "services", "data-templates", "doc-templates", "simulator", "analytics"] as const;
type TabKey = typeof VALID_TABS[number];

export default function KnowledgeBasePage() {
  const { user }   = useAuth();
  const { toast }  = useToast();
  const qc         = useQueryClient();
  const [, setLoc] = useLocation();

  const params     = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const initTab    = (params.get("tab") as TabKey | null) ?? "intents";
  const [tab, setTab] = useState<TabKey>(VALID_TABS.includes(initTab as TabKey) ? initTab : "intents");

  const role        = user?.role ?? "staff";
  const isSuperAdmin = role === "super_admin";
  const canEdit      = ["super_admin", "company_admin"].includes(role);

  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ["kb-stats"], queryFn: api.stats, staleTime: 30_000 });

  const mutCacheReload = useMutation({
    mutationFn: api.cacheReload,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["intent-master"] });
      qc.invalidateQueries({ queryKey: ["keyword-rules"] });
      toast({ title: "Cache di-reload", description: `Berhasil pada ${format(new Date(r.reloadedAt), "HH:mm:ss")}` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleTabChange = (v: string) => {
    setTab(v as TabKey);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto w-full space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-purple-600" />
            Knowledge Base
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Konfigurasi AI — intent, keyword, layanan, dan template</p>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => mutCacheReload.mutate()} disabled={mutCacheReload.isPending}>
            {mutCacheReload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Reload Cache
          </Button>
        )}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Intent"          value={statsLoading ? undefined : stats?.intents}           icon={<Brain className="h-5 w-5 text-purple-600" />}   color="bg-purple-50" />
        <StatCard label="Keyword"         value={statsLoading ? undefined : stats?.keywords}          icon={<Hash className="h-5 w-5 text-blue-600" />}      color="bg-blue-50" />
        <StatCard label="Layanan"         value={statsLoading ? undefined : stats?.services}          icon={<Package className="h-5 w-5 text-orange-600" />} color="bg-orange-50" />
        <StatCard label="Data Template"   value={statsLoading ? undefined : stats?.dataTemplates}     icon={<FileText className="h-5 w-5 text-teal-600" />}  color="bg-teal-50" />
        <StatCard label="Doc Template"    value={statsLoading ? undefined : stats?.documentTemplates} icon={<FolderOpen className="h-5 w-5 text-pink-600" />} color="bg-pink-50" />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="intents"       className="gap-1.5 text-xs"><Brain className="h-3.5 w-3.5" />Intent Master</TabsTrigger>
          <TabsTrigger value="keywords"      className="gap-1.5 text-xs"><Hash className="h-3.5 w-3.5" />Keyword Rules</TabsTrigger>
          <TabsTrigger value="services"      className="gap-1.5 text-xs"><Package className="h-3.5 w-3.5" />Service Catalog</TabsTrigger>
          <TabsTrigger value="data-templates"  className="gap-1.5 text-xs"><FileText className="h-3.5 w-3.5" />Data Templates</TabsTrigger>
          <TabsTrigger value="doc-templates"   className="gap-1.5 text-xs"><FolderOpen className="h-3.5 w-3.5" />Doc Templates</TabsTrigger>
          <TabsTrigger value="simulator"     className="gap-1.5 text-xs"><PlayCircle className="h-3.5 w-3.5" />Simulator</TabsTrigger>
          <TabsTrigger value="analytics"     className="gap-1.5 text-xs"><BarChart2 className="h-3.5 w-3.5" />Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="intents"       className="mt-4"><IntentMasterTab  canEdit={canEdit} /></TabsContent>
        <TabsContent value="keywords"      className="mt-4"><KeywordRulesTab  canEdit={canEdit} /></TabsContent>
        <TabsContent value="services"      className="mt-4"><ServiceCatalogTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="data-templates"  className="mt-4"><DataTemplatesTab  canEdit={canEdit} /></TabsContent>
        <TabsContent value="doc-templates"   className="mt-4"><DocTemplatesTab   canEdit={canEdit} /></TabsContent>
        <TabsContent value="simulator"     className="mt-4"><SimulatorTab isSuperAdmin={isSuperAdmin} /></TabsContent>
        <TabsContent value="analytics"     className="mt-4"><AnalyticsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
