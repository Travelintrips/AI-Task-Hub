import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, CheckCircle2, XCircle, AlertCircle, RefreshCw, X,
  ArrowRightCircle, CheckCheck, Eye,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { getStoredToken } from "@/lib/auth-api";

// ─── API helper ────────────────────────────────────────────────────────────────

async function apiFetch(path: string, init?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntakeSession {
  id: number;
  companyId: string;
  phone: string;
  customerId: string | null;
  intentCode: string;
  intentName: string | null;
  category: string | null;
  status: "collecting" | "form_sent" | "ready_for_task" | "submitted" | "cancelled" | "expired";
  collectedFields: Record<string, unknown>;
  missingFields: string[];
  requiredDocuments: string[];
  uploadedDocuments: string[];
  lastQuestion: string | null;
  lastMessage: string | null;
  taskId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  collecting:     { label: "Collecting",       color: "bg-blue-100 text-blue-800",    icon: MessageSquare },
  form_sent:      { label: "Form Dikirim",     color: "bg-purple-100 text-purple-800", icon: MessageSquare },
  ready_for_task: { label: "Siap Buat Task",   color: "bg-green-100 text-green-800",  icon: CheckCircle2 },
  submitted:      { label: "Task Dibuat",      color: "bg-gray-100 text-gray-800",    icon: CheckCircle2 },
  cancelled:      { label: "Dibatalkan",       color: "bg-red-100 text-red-800",      icon: XCircle },
  expired:        { label: "Kedaluwarsa",      color: "bg-yellow-100 text-yellow-800", icon: AlertCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-700", icon: MessageSquare };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function FieldsGrid({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground italic">Belum ada data terkumpul</p>;
  return (
    <div className="grid grid-cols-2 gap-1">
      {entries.map(([k, v]) => (
        <div key={k} className="text-xs">
          <span className="text-muted-foreground">{k}:</span>{" "}
          <span className="font-medium">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Detail Dialog ─────────────────────────────────────────────────────────────

function SessionDetailDialog({
  session,
  onClose,
  onCancel,
  onMarkReady,
  onConvert,
  isLoading,
}: {
  session: IntakeSession;
  onClose: () => void;
  onCancel: (id: number) => void;
  onMarkReady: (id: number) => void;
  onConvert: (id: number) => void;
  isLoading: boolean;
}) {
  const canCancel  = !["submitted","cancelled","expired"].includes(session.status);
  const canReady   = ["collecting","form_sent"].includes(session.status);
  const canConvert = !["submitted","cancelled","expired"].includes(session.status);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Detail Intake Session #{session.id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Nomor HP</p>
              <p className="font-mono font-medium">{session.phone}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Status</p>
              <StatusBadge status={session.status} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Intent</p>
              <p className="font-medium">{session.intentName ?? session.intentCode}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Kategori</p>
              <p>{session.category ?? "-"}</p>
            </div>
            {session.taskId && (
              <div>
                <p className="text-muted-foreground text-xs mb-1">Task ID</p>
                <p className="font-mono font-medium text-primary">#{session.taskId}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs mb-1">Dibuat</p>
              <p>{new Date(session.createdAt).toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Kadaluarsa</p>
              <p>{session.expiresAt ? new Date(session.expiresAt).toLocaleString("id-ID") : "-"}</p>
            </div>
          </div>

          {session.lastMessage && (
            <div>
              <p className="text-muted-foreground text-xs mb-1 font-medium">Pesan Terakhir</p>
              <div className="bg-muted/50 rounded p-3 italic">"{session.lastMessage}"</div>
            </div>
          )}

          {session.lastQuestion && (
            <div>
              <p className="text-muted-foreground text-xs mb-1 font-medium">Pertanyaan Terakhir AI</p>
              <div className="bg-blue-50 rounded p-3">{session.lastQuestion}</div>
            </div>
          )}

          <div>
            <p className="text-muted-foreground text-xs mb-2 font-medium">
              Data Terkumpul ({Object.keys(session.collectedFields ?? {}).length} field)
            </p>
            <div className="bg-muted/30 rounded p-3">
              <FieldsGrid fields={(session.collectedFields as Record<string, unknown>) ?? {}} />
            </div>
          </div>

          {(session.missingFields ?? []).length > 0 && (
            <div>
              <p className="text-muted-foreground text-xs mb-2 font-medium text-orange-600">
                Field Kurang ({session.missingFields.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {session.missingFields.map((f) => (
                  <span key={f} className="bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded-full">{f}</span>
                ))}
              </div>
            </div>
          )}

          {(session.requiredDocuments ?? []).length > 0 && (
            <div>
              <p className="text-muted-foreground text-xs mb-2 font-medium">Dokumen Diperlukan</p>
              <div className="flex flex-wrap gap-1">
                {session.requiredDocuments.map((d) => (
                  <span key={d} className="bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full">{d}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2 pt-2">
          {canReady && (
            <Button
              variant="outline" size="sm"
              disabled={isLoading}
              onClick={() => { onMarkReady(session.id); onClose(); }}
            >
              <CheckCheck className="w-3 h-3 mr-1" /> Tandai Siap
            </Button>
          )}
          {canConvert && (
            <Button
              size="sm"
              disabled={isLoading}
              onClick={() => { onConvert(session.id); onClose(); }}
            >
              <ArrowRightCircle className="w-3 h-3 mr-1" /> Buat Task Sekarang
            </Button>
          )}
          {canCancel && (
            <Button
              variant="destructive" size="sm"
              disabled={isLoading}
              onClick={() => { onCancel(session.id); onClose(); }}
            >
              <XCircle className="w-3 h-3 mr-1" /> Batalkan
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntakeSessionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("collecting,ready_for_task");
  const [phoneFilter, setPhoneFilter] = useState("");
  const [selectedSession, setSelectedSession] = useState<IntakeSession | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["intake-sessions", statusFilter, phoneFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter) params.set("status", statusFilter);
      if (phoneFilter.trim()) params.set("phone", phoneFilter.trim());
      return apiFetch(`/intake-sessions?${params}`) as Promise<{ data: IntakeSession[]; total: number }>;
    },
    refetchInterval: 15000,
  });

  const sessions = data?.data ?? [];

  const mutCancel = useMutation({
    mutationFn: (id: number) => apiFetch(`/intake-sessions/${id}/cancel`, { method: "PATCH" }),
    onSuccess: () => {
      toast({ title: "Session dibatalkan" });
      queryClient.invalidateQueries({ queryKey: ["intake-sessions"] });
      setSelectedSession(null);
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const mutMarkReady = useMutation({
    mutationFn: (id: number) => apiFetch(`/intake-sessions/${id}/mark-ready`, { method: "PATCH" }),
    onSuccess: () => {
      toast({ title: "Session ditandai siap buat task" });
      queryClient.invalidateQueries({ queryKey: ["intake-sessions"] });
      setSelectedSession(null);
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const mutConvert = useMutation({
    mutationFn: (id: number) => apiFetch(`/intake-sessions/${id}/convert-to-task`, { method: "POST" }),
    onSuccess: (res: { taskId?: number; taskNumber?: string }) => {
      toast({ title: `✅ Task #${res.taskNumber ?? res.taskId} berhasil dibuat!` });
      queryClient.invalidateQueries({ queryKey: ["intake-sessions"] });
      setSelectedSession(null);
    },
    onError: (err: Error) => toast({ title: "Gagal buat task", description: err.message, variant: "destructive" }),
  });

  const isMutating = mutCancel.isPending || mutMarkReady.isPending || mutConvert.isPending;

  const activeCnt   = sessions.filter((s) => s.status === "collecting").length;
  const readyCnt    = sessions.filter((s) => s.status === "ready_for_task").length;
  const formSentCnt = sessions.filter((s) => s.status === "form_sent").length;
  const totalCnt    = sessions.length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Intake Sessions</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Percakapan pengumpulan data sebelum task dibuat
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Sedang Berjalan", value: activeCnt,   color: "text-blue-600" },
          { label: "Form Dikirim",    value: formSentCnt, color: "text-purple-600" },
          { label: "Siap Buat Task",  value: readyCnt,    color: "text-green-600" },
          { label: "Total",           value: totalCnt,    color: "text-gray-600" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Filter Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="collecting,ready_for_task">Aktif</SelectItem>
            <SelectItem value="collecting">Sedang Mengumpulkan</SelectItem>
            <SelectItem value="form_sent">Form Dikirim</SelectItem>
            <SelectItem value="ready_for_task">Siap Buat Task</SelectItem>
            <SelectItem value="submitted">Task Dibuat</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
            <SelectItem value="expired">Kedaluwarsa</SelectItem>
            <SelectItem value="">Semua</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Filter nomor HP..."
          value={phoneFilter}
          onChange={(e) => setPhoneFilter(e.target.value)}
          className="w-48"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Memuat...
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
          <p>Tidak ada intake session ditemukan</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nomor HP</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Intent</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Terkumpul</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Kurang</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Terakhir</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sessions.map((s) => {
                const collectedCount = Object.keys(s.collectedFields ?? {}).filter(
                  (k) => (s.collectedFields as Record<string, unknown>)[k] !== null
                ).length;
                const missingCount = (s.missingFields ?? []).length;
                return (
                  <tr
                    key={s.id}
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelectedSession(s)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{s.phone}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{s.intentName ?? s.intentCode}</div>
                      {s.category && <div className="text-xs text-muted-foreground">{s.category}</div>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-green-700">{collectedCount}</span> field
                    </td>
                    <td className="px-4 py-3">
                      {missingCount > 0
                        ? <span className="font-medium text-orange-600">{missingCount} kurang</span>
                        : <span className="text-green-600">Lengkap ✓</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(s.updatedAt), { addSuffix: true, locale: localeId })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2"
                          onClick={(e) => { e.stopPropagation(); setSelectedSession(s); }}
                          title="Lihat detail"
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                        {!["submitted","cancelled","expired"].includes(s.status) && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            disabled={isMutating}
                            onClick={(e) => { e.stopPropagation(); mutConvert.mutate(s.id); }}
                            title="Buat task sekarang"
                          >
                            <ArrowRightCircle className="w-3 h-3" />
                          </Button>
                        )}
                        {["collecting","form_sent"].includes(s.status) && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 px-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                            disabled={isMutating}
                            onClick={(e) => { e.stopPropagation(); mutMarkReady.mutate(s.id); }}
                            title="Tandai siap"
                          >
                            <CheckCheck className="w-3 h-3" />
                          </Button>
                        )}
                        {!["submitted","cancelled","expired"].includes(s.status) && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                            disabled={isMutating}
                            onClick={(e) => { e.stopPropagation(); mutCancel.mutate(s.id); }}
                            title="Batalkan"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Dialog */}
      {selectedSession && (
        <SessionDetailDialog
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onCancel={mutCancel.mutate}
          onMarkReady={mutMarkReady.mutate}
          onConvert={mutConvert.mutate}
          isLoading={isMutating}
        />
      )}
    </div>
  );
}
