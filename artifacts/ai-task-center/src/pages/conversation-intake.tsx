import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, CheckCircle2, XCircle, AlertCircle, RefreshCw,
  Clock, ArrowRightCircle, CheckCheck, Eye, ChevronDown, ChevronUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { getStoredToken } from "@/lib/auth-api";

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
  requiredFields: string[];
  requiredDocuments: string[];
  completionPct: string | null;
  needsAdminReview: boolean;
  aiSummary: string | null;
  lastQuestion: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  taskId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface IntakeStats {
  active: number;
  waitingUser: number;
  waitingDocument: number;
  completedToday: number;
  expiredToday: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  collecting:     { label: "Mengumpulkan Data",  color: "bg-blue-100 text-blue-800",    icon: MessageSquare },
  form_sent:      { label: "Menunggu Dokumen",    color: "bg-purple-100 text-purple-800", icon: Clock },
  ready_for_task: { label: "Siap Buat Task",      color: "bg-green-100 text-green-800",  icon: CheckCircle2 },
  submitted:      { label: "Task Dibuat",          color: "bg-gray-100 text-gray-800",    icon: CheckCheck },
  cancelled:      { label: "Dibatalkan",           color: "bg-red-100 text-red-800",      icon: XCircle },
  expired:        { label: "Kedaluwarsa",          color: "bg-yellow-100 text-yellow-800", icon: AlertCircle },
};

const FILTER_STATUSES = [
  { value: "all",           label: "Semua Status" },
  { value: "collecting",    label: "Aktif (Mengumpulkan)" },
  { value: "form_sent",     label: "Menunggu Dokumen" },
  { value: "ready_for_task", label: "Siap Buat Task" },
  { value: "submitted",     label: "Task Sudah Dibuat" },
  { value: "expired",       label: "Kedaluwarsa" },
  { value: "cancelled",     label: "Dibatalkan" },
];

function pct(session: IntakeSession): number {
  const val = parseFloat(session.completionPct ?? "0");
  return isNaN(val) ? 0 : val;
}

function pctColor(p: number) {
  if (p >= 80) return "text-green-600";
  if (p >= 50) return "text-yellow-600";
  return "text-red-600";
}

function SessionRow({ session, onAction }: { session: IntakeSession; onAction: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/intake-sessions/${session.id}/cancel`, { method: "PATCH" }),
    onSuccess: () => { toast({ title: "Session dibatalkan" }); queryClient.invalidateQueries({ queryKey: ["intake-sessions"] }); onAction(); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: () => apiFetch(`/intake-sessions/${session.id}/convert-to-task`, { method: "POST" }),
    onSuccess: (d: { taskNumber: string }) => { toast({ title: `Task ${d.taskNumber} dibuat` }); queryClient.invalidateQueries({ queryKey: ["intake-sessions"] }); onAction(); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const cfg = STATUS_CONFIG[session.status] ?? STATUS_CONFIG["collecting"]!;
  const Icon = cfg.icon;
  const p = pct(session);
  const missing = session.missingFields ?? [];
  const required = session.requiredFields ?? [];

  return (
    <div className="border rounded-lg bg-white shadow-sm">
      <div className="grid grid-cols-12 gap-3 p-3 items-center text-sm">
        {/* Phone */}
        <div className="col-span-2 font-mono text-xs text-muted-foreground">{session.phone}</div>

        {/* Intent */}
        <div className="col-span-2">
          <div className="font-medium truncate">{session.intentName ?? session.intentCode}</div>
          {session.category && <div className="text-xs text-muted-foreground">{session.category}</div>}
        </div>

        {/* Completion % */}
        <div className="col-span-2">
          <div className={`font-bold text-base ${pctColor(p)}`}>{p}%</div>
          <Progress value={p} className="h-1.5 mt-1" />
          <div className="text-xs text-muted-foreground mt-0.5">
            {required.length - missing.length}/{required.length} field
          </div>
        </div>

        {/* Status */}
        <div className="col-span-2">
          <Badge className={`${cfg.color} border-0 gap-1 text-xs`}>
            <Icon className="w-3 h-3" />
            {cfg.label}
          </Badge>
        </div>

        {/* Missing fields preview */}
        <div className="col-span-2 text-xs text-muted-foreground">
          {missing.length > 0 ? (
            <span className="text-orange-600">{missing.slice(0, 2).join(", ")}{missing.length > 2 ? ` +${missing.length - 2}` : ""}</span>
          ) : (
            <span className="text-green-600">Lengkap</span>
          )}
        </div>

        {/* Last activity */}
        <div className="col-span-1 text-xs text-muted-foreground">
          {session.lastMessageAt
            ? formatDistanceToNow(new Date(session.lastMessageAt), { addSuffix: true, locale: localeId })
            : formatDistanceToNow(new Date(session.updatedAt), { addSuffix: true, locale: localeId })}
        </div>

        {/* Task badge */}
        <div className="col-span-1 text-xs">
          {session.taskId
            ? <Badge className="bg-green-100 text-green-800 border-0 text-xs">Ada</Badge>
            : <span className="text-muted-foreground">—</span>}
        </div>
      </div>

      {/* Expandable detail */}
      <div className="px-3 pb-2 flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
          {expanded ? "Sembunyikan" : "Detail"}
        </Button>

        {["collecting", "form_sent", "ready_for_task"].includes(session.status) && (
          <>
            <Button
              variant="outline" size="sm" className="h-6 text-xs px-2 text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              <XCircle className="w-3 h-3 mr-1" /> Batalkan
            </Button>
            <Button
              variant="outline" size="sm" className="h-6 text-xs px-2 text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending}
            >
              <ArrowRightCircle className="w-3 h-3 mr-1" /> Buat Task
            </Button>
          </>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t pt-2 space-y-2 text-sm">
          {session.lastMessage && (
            <div>
              <span className="font-medium text-xs text-muted-foreground uppercase">Pesan Terakhir</span>
              <p className="text-sm mt-0.5 text-foreground/80 italic">"{session.lastMessage}"</p>
            </div>
          )}
          {session.lastQuestion && (
            <div>
              <span className="font-medium text-xs text-muted-foreground uppercase">Pertanyaan Terakhir AI</span>
              <p className="text-sm mt-0.5 text-blue-700">"{session.lastQuestion}"</p>
            </div>
          )}
          {Object.keys(session.collectedFields ?? {}).length > 0 && (
            <div>
              <span className="font-medium text-xs text-muted-foreground uppercase">Data Terkumpul</span>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {Object.entries(session.collectedFields).map(([k, v]) => (
                  <div key={k} className="flex gap-1 text-xs">
                    <span className="text-muted-foreground font-mono">{k}:</span>
                    <span>{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {missing.length > 0 && (
            <div>
              <span className="font-medium text-xs text-orange-600 uppercase">Field Belum Ada</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {missing.map((f) => (
                  <Badge key={f} className="bg-orange-100 text-orange-800 border-0 text-xs font-mono">{f}</Badge>
                ))}
              </div>
            </div>
          )}
          {session.aiSummary && (
            <div>
              <span className="font-medium text-xs text-muted-foreground uppercase">AI Summary</span>
              <p className="text-xs mt-0.5 text-foreground/70">{session.aiSummary}</p>
            </div>
          )}
          {session.expiresAt && (
            <div className="text-xs text-muted-foreground">
              Kedaluwarsa: {formatDistanceToNow(new Date(session.expiresAt), { addSuffix: true, locale: localeId })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConversationIntakePage() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPhone, setFilterPhone] = useState("");
  const queryClient = useQueryClient();

  const statsQ = useQuery<IntakeStats>({
    queryKey: ["intake-stats"],
    queryFn: () => apiFetch("/intake-sessions/stats"),
    refetchInterval: 30_000,
  });

  const sessionsQ = useQuery<{ data: IntakeSession[]; total: number }>({
    queryKey: ["intake-sessions", filterStatus, filterPhone],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (filterStatus && filterStatus !== "all") params.set("status", filterStatus);
      if (filterPhone) params.set("phone", filterPhone);
      return apiFetch(`/intake-sessions?${params}`);
    },
    refetchInterval: 20_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["intake-sessions"] });
    queryClient.invalidateQueries({ queryKey: ["intake-stats"] });
  };

  const stats = statsQ.data;
  const sessions = sessionsQ.data?.data ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Conversation Intake</h1>
          <p className="text-sm text-muted-foreground">Monitor sesi pengumpulan data WhatsApp sebelum task dibuat</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={sessionsQ.isFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${sessionsQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 px-6 py-3 border-b bg-muted/30">
          {[
            { label: "Sesi Aktif",          value: stats.active,           color: "text-blue-600" },
            { label: "Menunggu Jawaban",     value: stats.waitingUser,      color: "text-orange-600" },
            { label: "Menunggu Dokumen",     value: stats.waitingDocument,  color: "text-purple-600" },
            { label: "Selesai Hari Ini",     value: stats.completedToday,   color: "text-green-600" },
            { label: "Kedaluwarsa Hari Ini", value: stats.expiredToday,     color: "text-gray-500" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 px-6 py-3 border-b">
        <Input
          placeholder="Filter nomor HP..."
          className="w-48 h-8 text-sm"
          value={filterPhone}
          onChange={(e) => setFilterPhone(e.target.value)}
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-52 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground self-center ml-auto">
          {sessions.length} sesi
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-12 gap-3 px-3 py-2 border-b bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        <div className="col-span-2">Nomor HP</div>
        <div className="col-span-2">Intent</div>
        <div className="col-span-2">Kelengkapan</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-2">Field Belum Ada</div>
        <div className="col-span-1">Aktivitas</div>
        <div className="col-span-1">Task?</div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-auto px-6 py-3 space-y-2">
        {sessionsQ.isLoading && (
          <div className="text-center py-12 text-muted-foreground">Memuat data...</div>
        )}
        {sessionsQ.isError && (
          <div className="text-center py-12 text-red-500">Gagal memuat data. Coba refresh.</div>
        )}
        {!sessionsQ.isLoading && sessions.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Tidak ada sesi intake</p>
          </div>
        )}
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} onAction={refresh} />
        ))}
      </div>
    </div>
  );
}
