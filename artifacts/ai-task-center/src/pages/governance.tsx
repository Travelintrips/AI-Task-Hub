import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, GitBranch, Clock, AlertTriangle, CheckCircle2, PlayCircle,
  ScrollText, Plus, Pencil, Trash2, Search, Loader2, Check, X,
  ChevronDown, Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RoutingRule {
  id: number; companyId: string; intentCode: string | null; category: string | null;
  priority: string | null; assignedRole: string | null; assignedDivision: string | null;
  assignedTeam: string | null; notes: string | null; isActive: boolean; createdAt: string;
}

interface SlaMatrix {
  id: number; companyId: string; intentCode: string | null; category: string | null;
  priority: string | null; slaHours: number; escalationHours: number | null;
  notes: string | null; isActive: boolean; createdAt: string;
}

interface EscalationRule {
  id: number; companyId: string; intentCode: string | null; category: string | null;
  priority: string | null; triggerHours: number; escalateTo: string;
  notifyChannel: string; messageTemplate: string | null; isActive: boolean; createdAt: string;
}

interface EscalationLog {
  id: number; companyId: string; taskId: number | null; ruleId: number | null;
  escalatedTo: string | null; channel: string | null; message: string | null;
  isSuccess: boolean; errorMessage: string | null; firedAt: string;
}

interface ApprovalRule {
  id: number; companyId: string; intentCode: string | null; category: string | null;
  priority: string | null; approvalType: string; approverRole: string;
  requiresNote: boolean; timeoutHours: number; isActive: boolean; createdAt: string;
}

interface ApprovalRequest {
  id: number; companyId: string; taskId: number | null; ruleId: number | null;
  requestedBy: string | null; approverRole: string; approvalType: string;
  status: string; decidedBy: string | null; decidedAt: string | null;
  notes: string | null; requestedAt: string;
}

interface SimulatorResult {
  input: { intentCode?: string; category?: string; priority?: string };
  routing: { assignedRole: string | null; assignedDivision: string | null; assignedTeam: string | null; ruleId: number | null; specificity: number };
  sla: { slaHours: number | null; escalationHours: number | null; ruleId: number | null; specificity: number };
  approval: { needsApproval: boolean; approvalType: string | null; approverRole: string | null; requiresNote: boolean; timeoutHours: number; ruleId: number | null; specificity: number };
  resolvedAt: string;
}

// ─── API helpers ───────────────────────────────────────────────────────────────

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
  routingRules:       () => apiFetch<RoutingRule[]>("/api/governance/routing-rules"),
  createRoutingRule:  (b: object) => apiFetch<RoutingRule>("/api/governance/routing-rules", { method: "POST", body: JSON.stringify(b) }),
  updateRoutingRule:  (id: number, b: object) => apiFetch<RoutingRule>(`/api/governance/routing-rules/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteRoutingRule:  (id: number) => apiFetch<void>(`/api/governance/routing-rules/${id}`, { method: "DELETE" }),
  slaMatrix:          () => apiFetch<SlaMatrix[]>("/api/governance/sla-matrix"),
  createSla:          (b: object) => apiFetch<SlaMatrix>("/api/governance/sla-matrix", { method: "POST", body: JSON.stringify(b) }),
  updateSla:          (id: number, b: object) => apiFetch<SlaMatrix>(`/api/governance/sla-matrix/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteSla:          (id: number) => apiFetch<void>(`/api/governance/sla-matrix/${id}`, { method: "DELETE" }),
  escalationRules:    () => apiFetch<EscalationRule[]>("/api/governance/escalation-rules"),
  createEscalation:   (b: object) => apiFetch<EscalationRule>("/api/governance/escalation-rules", { method: "POST", body: JSON.stringify(b) }),
  updateEscalation:   (id: number, b: object) => apiFetch<EscalationRule>(`/api/governance/escalation-rules/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteEscalation:   (id: number) => apiFetch<void>(`/api/governance/escalation-rules/${id}`, { method: "DELETE" }),
  escalationLogs:     () => apiFetch<EscalationLog[]>("/api/governance/escalation-logs"),
  approvalRules:      () => apiFetch<ApprovalRule[]>("/api/governance/approval-rules"),
  createApproval:     (b: object) => apiFetch<ApprovalRule>("/api/governance/approval-rules", { method: "POST", body: JSON.stringify(b) }),
  updateApproval:     (id: number, b: object) => apiFetch<ApprovalRule>(`/api/governance/approval-rules/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteApproval:     (id: number) => apiFetch<void>(`/api/governance/approval-rules/${id}`, { method: "DELETE" }),
  approvalRequests:   (status?: string) => apiFetch<ApprovalRequest[]>(`/api/governance/approval-requests${status ? `?status=${status}` : ""}`),
  decideApproval:     (id: number, b: object) => apiFetch<ApprovalRequest>(`/api/governance/approval-requests/${id}/decide`, { method: "POST", body: JSON.stringify(b) }),
  simulate:           (b: object) => apiFetch<SimulatorResult>("/api/governance/simulate", { method: "POST", body: JSON.stringify(b) }),
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

function ActiveBadge({ v }: { v: boolean }) {
  return v
    ? <Badge className="bg-green-100 text-green-700 text-xs">Aktif</Badge>
    : <Badge className="bg-gray-100 text-gray-500 text-xs">Nonaktif</Badge>;
}

function PriorityBadge({ p }: { p: string | null }) {
  if (!p) return <span className="text-muted-foreground text-sm">—</span>;
  const map: Record<string, string> = { high: "bg-red-100 text-red-700", medium: "bg-yellow-100 text-yellow-700", low: "bg-green-100 text-green-700" };
  return <Badge className={`text-xs ${map[p] ?? "bg-gray-100 text-gray-600"}`}>{p}</Badge>;
}

function NullableCell({ v }: { v: string | null | undefined }) {
  return <span className={v ? "text-sm" : "text-muted-foreground text-sm"} >{v ?? "—"}</span>;
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

function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center py-12 text-muted-foreground">
        <p className="font-medium">{label}</p>
      </TableCell>
    </TableRow>
  );
}

const PRIORITIES = ["", "high", "medium", "low"] as const;
const ROLES = ["supervisor", "company_admin", "super_admin", "staff", "vendor"] as const;

// ══════════════════════════════════════════════════════════════════════════════
// ROUTING MATRIX TAB
// ══════════════════════════════════════════════════════════════════════════════

function RoutingMatrixTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; row?: RoutingRule } | null>(null);
  const [form, setForm] = useState({ intentCode: "", category: "", priority: "", assignedRole: "", assignedDivision: "", assignedTeam: "", notes: "", isActive: true });

  const { data, isLoading } = useQuery({ queryKey: ["gov-routing"], queryFn: api.routingRules, staleTime: 30_000 });
  const mutCreate = useMutation({ mutationFn: api.createRoutingRule, onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-routing"] }); setDialog(null); toast({ title: "Routing rule ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateRoutingRule(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-routing"] }); setDialog(null); toast({ title: "Routing rule diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete = useMutation({ mutationFn: api.deleteRoutingRule, onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-routing"] }); toast({ title: "Routing rule dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });

  const blank = { intentCode: "", category: "", priority: "", assignedRole: "", assignedDivision: "", assignedTeam: "", notes: "", isActive: true };
  const openAdd = () => { setForm(blank); setDialog({ mode: "add" }); };
  const openEdit = (r: RoutingRule) => { setForm({ intentCode: r.intentCode ?? "", category: r.category ?? "", priority: r.priority ?? "", assignedRole: r.assignedRole ?? "", assignedDivision: r.assignedDivision ?? "", assignedTeam: r.assignedTeam ?? "", notes: r.notes ?? "", isActive: r.isActive }); setDialog({ mode: "edit", row: r }); };

  const handleSave = () => {
    const payload = { ...form, intentCode: form.intentCode || null, category: form.category || null, priority: form.priority || null, assignedRole: form.assignedRole || null, assignedDivision: form.assignedDivision || null, assignedTeam: form.assignedTeam || null };
    if (dialog?.mode === "add") mutCreate.mutate(payload);
    else if (dialog?.row) mutUpdate.mutate({ id: dialog.row.id, b: payload });
  };

  const filtered = (data ?? []).filter((r) => !search || [r.intentCode, r.category, r.assignedRole, r.assignedDivision, r.assignedTeam].some((v) => v?.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Cari intent, kategori, role…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {canEdit && <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah Rule</Button>}
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Intent Code</TableHead><TableHead>Kategori</TableHead><TableHead>Prioritas</TableHead>
              <TableHead>Role</TableHead><TableHead>Divisi</TableHead><TableHead>Tim</TableHead>
              <TableHead>Status</TableHead>{canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={canEdit ? 8 : 7} /> : !filtered.length ? <EmptyRow cols={canEdit ? 8 : 7} label="Belum ada routing rule" /> :
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><NullableCell v={r.intentCode} /></TableCell>
                  <TableCell><NullableCell v={r.category} /></TableCell>
                  <TableCell><PriorityBadge p={r.priority} /></TableCell>
                  <TableCell><NullableCell v={r.assignedRole} /></TableCell>
                  <TableCell><NullableCell v={r.assignedDivision} /></TableCell>
                  <TableCell><NullableCell v={r.assignedTeam} /></TableCell>
                  <TableCell><ActiveBadge v={r.isActive} /></TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus rule ini?")) mutDelete.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah Routing Rule" : "Edit Routing Rule"}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">Kosongkan field untuk membuat rule sebagai fallback yang lebih umum.</p>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Intent Code</Label><Input value={form.intentCode} onChange={(e) => setForm((f) => ({ ...f, intentCode: e.target.value }))} placeholder="cth: quotation_request" /></div>
              <div><Label className="text-xs mb-1">Kategori</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="cth: Logistik" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Prioritas</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v === "_none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Semua prioritas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Semua prioritas</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs mb-1">Role Yang Ditugaskan</Label><Input value={form.assignedRole} onChange={(e) => setForm((f) => ({ ...f, assignedRole: e.target.value }))} placeholder="cth: supervisor" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Divisi</Label><Input value={form.assignedDivision} onChange={(e) => setForm((f) => ({ ...f, assignedDivision: e.target.value }))} placeholder="cth: Operasional" /></div>
              <div><Label className="text-xs mb-1">Tim</Label><Input value={form.assignedTeam} onChange={(e) => setForm((f) => ({ ...f, assignedTeam: e.target.value }))} placeholder="cth: Tim A" /></div>
            </div>
            <div><Label className="text-xs mb-1">Catatan</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
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

// ══════════════════════════════════════════════════════════════════════════════
// SLA MATRIX TAB
// ══════════════════════════════════════════════════════════════════════════════

function SlaMatrixTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; row?: SlaMatrix } | null>(null);
  const [form, setForm] = useState({ intentCode: "", category: "", priority: "", slaHours: "", escalationHours: "", notes: "", isActive: true });

  const { data, isLoading } = useQuery({ queryKey: ["gov-sla"], queryFn: api.slaMatrix, staleTime: 30_000 });
  const mutCreate = useMutation({ mutationFn: api.createSla, onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-sla"] }); setDialog(null); toast({ title: "SLA rule ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateSla(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-sla"] }); setDialog(null); toast({ title: "SLA rule diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete = useMutation({ mutationFn: api.deleteSla, onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-sla"] }); toast({ title: "SLA rule dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });

  const blank = { intentCode: "", category: "", priority: "", slaHours: "", escalationHours: "", notes: "", isActive: true };
  const openAdd = () => { setForm(blank); setDialog({ mode: "add" }); };
  const openEdit = (r: SlaMatrix) => { setForm({ intentCode: r.intentCode ?? "", category: r.category ?? "", priority: r.priority ?? "", slaHours: String(r.slaHours), escalationHours: r.escalationHours ? String(r.escalationHours) : "", notes: r.notes ?? "", isActive: r.isActive }); setDialog({ mode: "edit", row: r }); };

  const handleSave = () => {
    const payload = { intentCode: form.intentCode || null, category: form.category || null, priority: form.priority || null, slaHours: parseInt(form.slaHours, 10), escalationHours: form.escalationHours ? parseInt(form.escalationHours, 10) : null, notes: form.notes || null, isActive: form.isActive };
    if (dialog?.mode === "add") mutCreate.mutate(payload);
    else if (dialog?.row) mutUpdate.mutate({ id: dialog.row.id, b: payload });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canEdit && <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah SLA Rule</Button>}
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Intent Code</TableHead><TableHead>Kategori</TableHead><TableHead>Prioritas</TableHead>
              <TableHead>SLA (jam)</TableHead><TableHead>Eskalasi (jam)</TableHead><TableHead>Status</TableHead>
              {canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={canEdit ? 7 : 6} /> : !(data ?? []).length ? <EmptyRow cols={canEdit ? 7 : 6} label="Belum ada SLA rule" /> :
              (data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell><NullableCell v={r.intentCode} /></TableCell>
                  <TableCell><NullableCell v={r.category} /></TableCell>
                  <TableCell><PriorityBadge p={r.priority} /></TableCell>
                  <TableCell className="font-semibold text-blue-600">{r.slaHours}h</TableCell>
                  <TableCell>{r.escalationHours ? <span className="text-orange-600 font-medium">{r.escalationHours}h</span> : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                  <TableCell><ActiveBadge v={r.isActive} /></TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus SLA rule ini?")) mutDelete.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah SLA Rule" : "Edit SLA Rule"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Intent Code</Label><Input value={form.intentCode} onChange={(e) => setForm((f) => ({ ...f, intentCode: e.target.value }))} placeholder="cth: quotation_request" /></div>
              <div><Label className="text-xs mb-1">Kategori</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="cth: Logistik" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs mb-1">Prioritas</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v === "_none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Semua" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Semua</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs mb-1">SLA (jam) *</Label><Input type="number" value={form.slaHours} onChange={(e) => setForm((f) => ({ ...f, slaHours: e.target.value }))} placeholder="24" /></div>
              <div><Label className="text-xs mb-1">Eskalasi (jam)</Label><Input type="number" value={form.escalationHours} onChange={(e) => setForm((f) => ({ ...f, escalationHours: e.target.value }))} placeholder="48" /></div>
            </div>
            <div><Label className="text-xs mb-1">Catatan</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} /><Label className="text-sm">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={handleSave} disabled={!form.slaHours || mutCreate.isPending || mutUpdate.isPending}>
              {(mutCreate.isPending || mutUpdate.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ESCALATION MATRIX TAB
// ══════════════════════════════════════════════════════════════════════════════

function EscalationMatrixTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; row?: EscalationRule } | null>(null);
  const [form, setForm] = useState({ intentCode: "", category: "", priority: "", triggerHours: "24", escalateTo: "supervisor", notifyChannel: "whatsapp", messageTemplate: "", isActive: true });

  const { data, isLoading } = useQuery({ queryKey: ["gov-escalation"], queryFn: api.escalationRules, staleTime: 30_000 });
  const mutCreate = useMutation({ mutationFn: api.createEscalation, onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-escalation"] }); setDialog(null); toast({ title: "Escalation rule ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateEscalation(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-escalation"] }); setDialog(null); toast({ title: "Escalation rule diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete = useMutation({ mutationFn: api.deleteEscalation, onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-escalation"] }); toast({ title: "Escalation rule dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });

  const blank = { intentCode: "", category: "", priority: "", triggerHours: "24", escalateTo: "supervisor", notifyChannel: "whatsapp", messageTemplate: "", isActive: true };
  const openAdd = () => { setForm(blank); setDialog({ mode: "add" }); };
  const openEdit = (r: EscalationRule) => { setForm({ intentCode: r.intentCode ?? "", category: r.category ?? "", priority: r.priority ?? "", triggerHours: String(r.triggerHours), escalateTo: r.escalateTo, notifyChannel: r.notifyChannel, messageTemplate: r.messageTemplate ?? "", isActive: r.isActive }); setDialog({ mode: "edit", row: r }); };

  const handleSave = () => {
    const payload = { intentCode: form.intentCode || null, category: form.category || null, priority: form.priority || null, triggerHours: parseInt(form.triggerHours, 10), escalateTo: form.escalateTo, notifyChannel: form.notifyChannel, messageTemplate: form.messageTemplate || null, isActive: form.isActive };
    if (dialog?.mode === "add") mutCreate.mutate(payload);
    else if (dialog?.row) mutUpdate.mutate({ id: dialog.row.id, b: payload });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canEdit && <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah Escalation Rule</Button>}
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Intent Code</TableHead><TableHead>Kategori</TableHead><TableHead>Prioritas</TableHead>
              <TableHead>Trigger (jam)</TableHead><TableHead>Eskalasi Ke</TableHead><TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>{canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={canEdit ? 8 : 7} /> : !(data ?? []).length ? <EmptyRow cols={canEdit ? 8 : 7} label="Belum ada escalation rule" /> :
              (data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell><NullableCell v={r.intentCode} /></TableCell>
                  <TableCell><NullableCell v={r.category} /></TableCell>
                  <TableCell><PriorityBadge p={r.priority} /></TableCell>
                  <TableCell className="font-semibold text-orange-600">{r.triggerHours}h</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.escalateTo}</Badge></TableCell>
                  <TableCell className="text-sm">{r.notifyChannel}</TableCell>
                  <TableCell><ActiveBadge v={r.isActive} /></TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus rule ini?")) mutDelete.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah Escalation Rule" : "Edit Escalation Rule"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Intent Code</Label><Input value={form.intentCode} onChange={(e) => setForm((f) => ({ ...f, intentCode: e.target.value }))} placeholder="cth: complaint" /></div>
              <div><Label className="text-xs mb-1">Kategori</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="cth: Logistik" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs mb-1">Prioritas</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v === "_none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Semua" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Semua</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs mb-1">Trigger (jam) *</Label><Input type="number" value={form.triggerHours} onChange={(e) => setForm((f) => ({ ...f, triggerHours: e.target.value }))} /></div>
              <div>
                <Label className="text-xs mb-1">Channel</Label>
                <Select value={form.notifyChannel} onValueChange={(v) => setForm((f) => ({ ...f, notifyChannel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs mb-1">Eskalasi Ke (role) *</Label><Input value={form.escalateTo} onChange={(e) => setForm((f) => ({ ...f, escalateTo: e.target.value }))} placeholder="cth: supervisor" /></div>
            <div>
              <Label className="text-xs mb-1">Template Pesan</Label>
              <Textarea value={form.messageTemplate} onChange={(e) => setForm((f) => ({ ...f, messageTemplate: e.target.value }))} rows={3} placeholder="⚠️ Task *{taskNumber}* sudah {triggerHours}jam belum terselesaikan." />
              <p className="text-xs text-muted-foreground mt-1">Variabel: &#123;taskNumber&#125;, &#123;title&#125;, &#123;customerName&#125;, &#123;priority&#125;</p>
            </div>
            <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} /><Label className="text-sm">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={handleSave} disabled={!form.triggerHours || !form.escalateTo || mutCreate.isPending || mutUpdate.isPending}>
              {(mutCreate.isPending || mutUpdate.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APPROVAL MATRIX TAB
// ══════════════════════════════════════════════════════════════════════════════

function ApprovalMatrixTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; row?: ApprovalRule } | null>(null);
  const [form, setForm] = useState({ intentCode: "", category: "", priority: "", approvalType: "admin_approval", approverRole: "company_admin", requiresNote: false, timeoutHours: "24", isActive: true });

  const { data, isLoading } = useQuery({ queryKey: ["gov-approval-rules"], queryFn: api.approvalRules, staleTime: 30_000 });
  const mutCreate = useMutation({ mutationFn: api.createApproval, onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-approval-rules"] }); setDialog(null); toast({ title: "Approval rule ditambahkan" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutUpdate = useMutation({ mutationFn: ({ id, b }: { id: number; b: object }) => api.updateApproval(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-approval-rules"] }); setDialog(null); toast({ title: "Approval rule diperbarui" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });
  const mutDelete = useMutation({ mutationFn: api.deleteApproval, onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-approval-rules"] }); toast({ title: "Approval rule dihapus" }); }, onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }) });

  const blank = { intentCode: "", category: "", priority: "", approvalType: "admin_approval", approverRole: "company_admin", requiresNote: false, timeoutHours: "24", isActive: true };
  const openAdd = () => { setForm(blank); setDialog({ mode: "add" }); };
  const openEdit = (r: ApprovalRule) => { setForm({ intentCode: r.intentCode ?? "", category: r.category ?? "", priority: r.priority ?? "", approvalType: r.approvalType, approverRole: r.approverRole, requiresNote: r.requiresNote, timeoutHours: String(r.timeoutHours), isActive: r.isActive }); setDialog({ mode: "edit", row: r }); };

  const handleSave = () => {
    const payload = { intentCode: form.intentCode || null, category: form.category || null, priority: form.priority || null, approvalType: form.approvalType, approverRole: form.approverRole, requiresNote: form.requiresNote, timeoutHours: parseInt(form.timeoutHours, 10) || 24, isActive: form.isActive };
    if (dialog?.mode === "add") mutCreate.mutate(payload);
    else if (dialog?.row) mutUpdate.mutate({ id: dialog.row.id, b: payload });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canEdit && <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-4 w-4" />Tambah Approval Rule</Button>}
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Intent Code</TableHead><TableHead>Kategori</TableHead><TableHead>Prioritas</TableHead>
              <TableHead>Tipe Approval</TableHead><TableHead>Role Approver</TableHead>
              <TableHead>Timeout</TableHead><TableHead>Status</TableHead>{canEdit && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <SkeletonRows cols={canEdit ? 8 : 7} /> : !(data ?? []).length ? <EmptyRow cols={canEdit ? 8 : 7} label="Belum ada approval rule" /> :
              (data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell><NullableCell v={r.intentCode} /></TableCell>
                  <TableCell><NullableCell v={r.category} /></TableCell>
                  <TableCell><PriorityBadge p={r.priority} /></TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.approvalType}</Badge></TableCell>
                  <TableCell><Badge className="bg-purple-100 text-purple-700 text-xs">{r.approverRole}</Badge></TableCell>
                  <TableCell className="text-sm">{r.timeoutHours}h</TableCell>
                  <TableCell><ActiveBadge v={r.isActive} /></TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => { if (confirm("Hapus approval rule ini?")) mutDelete.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{dialog?.mode === "add" ? "Tambah Approval Rule" : "Edit Approval Rule"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Intent Code</Label><Input value={form.intentCode} onChange={(e) => setForm((f) => ({ ...f, intentCode: e.target.value }))} placeholder="cth: complaint" /></div>
              <div><Label className="text-xs mb-1">Kategori</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="cth: Logistik" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Prioritas</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v === "_none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Semua" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Semua</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs mb-1">Timeout (jam)</Label><Input type="number" value={form.timeoutHours} onChange={(e) => setForm((f) => ({ ...f, timeoutHours: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1">Tipe Approval</Label><Input value={form.approvalType} onChange={(e) => setForm((f) => ({ ...f, approvalType: e.target.value }))} placeholder="admin_approval" /></div>
              <div>
                <Label className="text-xs mb-1">Role Approver</Label>
                <Select value={form.approverRole} onValueChange={(v) => setForm((f) => ({ ...f, approverRole: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="company_admin">Company Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2"><Switch checked={form.requiresNote} onCheckedChange={(v) => setForm((f) => ({ ...f, requiresNote: v }))} /><Label className="text-sm">Wajib catatan saat approve/reject</Label></div>
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

// ══════════════════════════════════════════════════════════════════════════════
// SIMULATOR TAB
// ══════════════════════════════════════════════════════════════════════════════

function SimulatorTab() {
  const { toast } = useToast();
  const [input, setInput] = useState({ intentCode: "", category: "", priority: "" });
  const [result, setResult] = useState<SimulatorResult | null>(null);

  const mutSim = useMutation({
    mutationFn: api.simulate,
    onSuccess: (data) => setResult(data),
    onError: (e: Error) => toast({ title: "Simulator gagal", description: e.message, variant: "destructive" }),
  });

  const run = () => mutSim.mutate({ intentCode: input.intentCode || undefined, category: input.category || undefined, priority: input.priority || undefined });

  const specLabel = (n: number) => {
    if (n < 0) return "Tidak ada rule cocok";
    const labels = ["Fallback", "Priority only", "Category only", "Category+Priority", "Intent only", "—", "Intent+Category", "Intent+Category+Priority"];
    return labels[n] ?? `Skor ${n}`;
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><PlayCircle className="h-4 w-4 text-blue-500" />Governance Simulator</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Masukkan parameter task untuk melihat routing, SLA, dan approval yang akan diterapkan oleh governance engine.</p>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs mb-1">Intent Code</Label><Input value={input.intentCode} onChange={(e) => setInput((f) => ({ ...f, intentCode: e.target.value }))} placeholder="cth: complaint" /></div>
            <div><Label className="text-xs mb-1">Kategori</Label><Input value={input.category} onChange={(e) => setInput((f) => ({ ...f, category: e.target.value }))} placeholder="cth: Logistik" /></div>
            <div>
              <Label className="text-xs mb-1">Prioritas</Label>
              <Select value={input.priority} onValueChange={(v) => setInput((f) => ({ ...f, priority: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">—</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={run} disabled={mutSim.isPending} className="gap-2">
            {mutSim.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Jalankan Simulasi
          </Button>
        </CardContent>
      </Card>

      {result && (
        <div className="grid gap-4">
          <Card className="border-blue-200 bg-blue-50/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><GitBranch className="h-4 w-4 text-blue-600" />Hasil Routing</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <div><p className="text-xs text-muted-foreground">Role</p><p className="font-medium">{result.routing.assignedRole ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Divisi</p><p className="font-medium">{result.routing.assignedDivision ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Tim</p><p className="font-medium">{result.routing.assignedTeam ?? "—"}</p></div>
              <div className="col-span-3"><p className="text-xs text-muted-foreground">Spesifisitas</p><Badge variant="outline" className="text-xs mt-1">{specLabel(result.routing.specificity)} (rule #{result.routing.ruleId ?? "N/A"})</Badge></div>
            </CardContent>
          </Card>

          <Card className="border-orange-200 bg-orange-50/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-orange-600" />Hasil SLA</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <div><p className="text-xs text-muted-foreground">SLA</p><p className="font-bold text-orange-700">{result.sla.slaHours != null ? `${result.sla.slaHours} jam` : "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Eskalasi Setelah</p><p className="font-medium">{result.sla.escalationHours != null ? `${result.sla.escalationHours} jam` : "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Spesifisitas</p><Badge variant="outline" className="text-xs mt-1">{specLabel(result.sla.specificity)}</Badge></div>
            </CardContent>
          </Card>

          <Card className={`border-purple-200 ${result.approval.needsApproval ? "bg-purple-50/40" : "bg-gray-50/40"}`}>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-purple-600" />Hasil Approval</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-muted-foreground">Perlu Approval</p>
                {result.approval.needsApproval
                  ? <Badge className="bg-red-100 text-red-700 text-xs mt-1">Ya</Badge>
                  : <Badge className="bg-green-100 text-green-700 text-xs mt-1">Tidak</Badge>}
              </div>
              <div><p className="text-xs text-muted-foreground">Tipe</p><p className="font-medium">{result.approval.approvalType ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Role Approver</p><p className="font-medium">{result.approval.approverRole ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Timeout</p><p className="font-medium">{result.approval.timeoutHours}h</p></div>
              <div className="col-span-2"><p className="text-xs text-muted-foreground">Spesifisitas</p><Badge variant="outline" className="text-xs mt-1">{specLabel(result.approval.specificity)}</Badge></div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-right">Disimulasi pada {format(new Date(result.resolvedAt), "dd MMM yyyy HH:mm:ss", { locale: localeId })}</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGS TAB (Escalation Logs + Approval Requests)
// ══════════════════════════════════════════════════════════════════════════════

function LogsTab({ canDecide }: { canDecide: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [logsTab, setLogsTab] = useState<"escalation" | "approvals">("escalation");
  const [decideDialog, setDecideDialog] = useState<{ req: ApprovalRequest } | null>(null);
  const [decisionForm, setDecisionForm] = useState({ decision: "approved" as "approved" | "rejected", notes: "" });

  const { data: escLogs, isLoading: escLoading } = useQuery({ queryKey: ["gov-esc-logs"], queryFn: api.escalationLogs, staleTime: 30_000 });
  const { data: approvals, isLoading: appLoading } = useQuery({ queryKey: ["gov-approvals"], queryFn: () => api.approvalRequests(), staleTime: 30_000 });
  const mutDecide = useMutation({
    mutationFn: ({ id, b }: { id: number; b: object }) => api.decideApproval(id, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gov-approvals"] }); setDecideDialog(null); toast({ title: "Keputusan disimpan" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusBadge = (s: string) => {
    const map: Record<string, string> = { pending: "bg-yellow-100 text-yellow-700", approved: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700", timeout: "bg-gray-100 text-gray-600" };
    return <Badge className={`text-xs ${map[s] ?? "bg-gray-100"}`}>{s}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant={logsTab === "escalation" ? "default" : "outline"} size="sm" onClick={() => setLogsTab("escalation")}>Escalation Logs</Button>
        <Button variant={logsTab === "approvals" ? "default" : "outline"} size="sm" onClick={() => setLogsTab("approvals")}>Approval Requests</Button>
      </div>

      {logsTab === "escalation" && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Task ID</TableHead><TableHead>Rule ID</TableHead><TableHead>Eskalasi Ke</TableHead>
                <TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Waktu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {escLoading ? <SkeletonRows cols={6} /> : !(escLogs ?? []).length ? <EmptyRow cols={6} label="Belum ada escalation log" /> :
                (escLogs ?? []).map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm font-mono">#{log.taskId ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">#{log.ruleId ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{log.escalatedTo ?? "—"}</Badge></TableCell>
                    <TableCell className="text-sm">{log.channel ?? "—"}</TableCell>
                    <TableCell>{log.isSuccess ? <Badge className="bg-green-100 text-green-700 text-xs">Berhasil</Badge> : <Badge className="bg-red-100 text-red-700 text-xs">Gagal</Badge>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(log.firedAt), "dd MMM HH:mm", { locale: localeId })}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {logsTab === "approvals" && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Task ID</TableHead><TableHead>Tipe</TableHead><TableHead>Approver Role</TableHead>
                <TableHead>Status</TableHead><TableHead>Diminta</TableHead><TableHead>Diputuskan Oleh</TableHead>
                {canDecide && <TableHead className="w-28" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {appLoading ? <SkeletonRows cols={canDecide ? 7 : 6} /> : !(approvals ?? []).length ? <EmptyRow cols={canDecide ? 7 : 6} label="Belum ada approval request" /> :
                (approvals ?? []).map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="text-sm font-mono">#{req.taskId ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{req.approvalType}</Badge></TableCell>
                    <TableCell><Badge className="bg-purple-100 text-purple-700 text-xs">{req.approverRole}</Badge></TableCell>
                    <TableCell>{statusBadge(req.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(req.requestedAt), "dd MMM HH:mm", { locale: localeId })}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{req.decidedBy ?? "—"}</TableCell>
                    {canDecide && (
                      <TableCell>
                        {req.status === "pending" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setDecisionForm({ decision: "approved", notes: "" }); setDecideDialog({ req }); }}>
                            Putuskan
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={!!decideDialog} onOpenChange={(o) => !o && setDecideDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Keputusan Approval #{decideDialog?.req.id}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-1">Keputusan</Label>
              <Select value={decisionForm.decision} onValueChange={(v) => setDecisionForm((f) => ({ ...f, decision: v as "approved" | "rejected" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Setujui</SelectItem>
                  <SelectItem value="rejected">Tolak</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs mb-1">Catatan</Label><Textarea value={decisionForm.notes} onChange={(e) => setDecisionForm((f) => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Alasan keputusan…" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecideDialog(null)}>Batal</Button>
            <Button
              onClick={() => decideDialog && mutDecide.mutate({ id: decideDialog.req.id, b: { decision: decisionForm.decision, notes: decisionForm.notes || undefined } })}
              disabled={mutDecide.isPending}
              className={decisionForm.decision === "approved" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
            >
              {mutDecide.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {decisionForm.decision === "approved" ? "Setujui" : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function GovernancePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("routing");

  const role = user?.role ?? "staff";
  const canEdit = role === "company_admin" || role === "super_admin";
  const canSimulate = canEdit || role === "supervisor";
  const canDecide = canEdit || role === "supervisor";

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-purple-100 flex items-center justify-center">
            <Shield className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Governance Engine</h1>
            <p className="text-sm text-muted-foreground">Kelola aturan routing, SLA, eskalasi, dan approval secara terpusat</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="routing" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" />Routing</TabsTrigger>
            <TabsTrigger value="sla" className="gap-1.5"><Clock className="h-3.5 w-3.5" />SLA Matrix</TabsTrigger>
            <TabsTrigger value="escalation" className="gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Eskalasi</TabsTrigger>
            <TabsTrigger value="approval" className="gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />Approval</TabsTrigger>
            {canSimulate && <TabsTrigger value="simulator" className="gap-1.5"><PlayCircle className="h-3.5 w-3.5" />Simulator</TabsTrigger>}
            <TabsTrigger value="logs" className="gap-1.5"><ScrollText className="h-3.5 w-3.5" />Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="routing"><RoutingMatrixTab canEdit={canEdit} /></TabsContent>
          <TabsContent value="sla"><SlaMatrixTab canEdit={canEdit} /></TabsContent>
          <TabsContent value="escalation"><EscalationMatrixTab canEdit={canEdit} /></TabsContent>
          <TabsContent value="approval"><ApprovalMatrixTab canEdit={canEdit} /></TabsContent>
          {canSimulate && <TabsContent value="simulator"><SimulatorTab /></TabsContent>}
          <TabsContent value="logs"><LogsTab canDecide={canDecide} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
