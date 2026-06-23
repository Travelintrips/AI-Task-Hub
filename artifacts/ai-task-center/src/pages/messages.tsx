import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerEvents } from "@/hooks/use-server-events";
import { formatDistanceToNow, format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Link } from "wouter";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  Send,
  CheckCircle2,
  Clock,
  Search,
  RefreshCw,
  MessageSquare,
  Phone,
  User,
  FileText,
  AlertCircle,
  ArrowUpRight,
  Inbox,
  Loader2,
} from "lucide-react";
import { getStoredToken } from "@/lib/auth-api";

// ─── Types ─────────────────────────────────────────────────────────────────

interface WaMessage {
  id: number;
  from: string | null;
  senderPhone: string | null;
  senderName: string | null;
  body: string | null;
  messageText: string | null;
  messageType: string | null;
  direction: string | null;
  processed: boolean | null;
  aiProcessed: boolean | null;
  detectedIntent: string | null;
  taskId: number | null;
  timestamp: string | null;
  createdAt: string | null;
  attachmentUrl: string | null;
}

// ─── API helper ────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ─── Intent badge mapping ─────────────────────────────────────────────────

const INTENT_CONFIG: Record<string, { label: string; color: string }> = {
  import:             { label: "Import",       color: "bg-blue-100 text-blue-700 border-blue-200" },
  export:             { label: "Export",       color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  trucking:           { label: "Trucking",     color: "bg-amber-100 text-amber-700 border-amber-200" },
  customs:            { label: "Bea Cukai",    color: "bg-red-100 text-red-700 border-red-200" },
  warehouse:          { label: "Gudang",       color: "bg-teal-100 text-teal-700 border-teal-200" },
  freight:            { label: "Freight",      color: "bg-purple-100 text-purple-700 border-purple-200" },
  general_inquiry:    { label: "Umum",         color: "bg-gray-100 text-gray-600 border-gray-200" },
  complaint:          { label: "Komplain",     color: "bg-red-100 text-red-700 border-red-200" },
  finance:            { label: "Finance",      color: "bg-green-100 text-green-700 border-green-200" },
  voice_note:         { label: "Voice Note",   color: "bg-orange-100 text-orange-700 border-orange-200" },
  attachment_submission: { label: "Dokumen",   color: "bg-sky-100 text-sky-700 border-sky-200" },
};

function intentBadge(intent: string | null) {
  if (!intent) return null;
  const key = intent.toLowerCase().replace(/[- /]/g, "_");
  const cfg = INTENT_CONFIG[key] ?? { label: intent, color: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
      <Bot className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function msgTypeIcon(type: string | null) {
  if (type === "image") return "🖼️";
  if (type === "document") return "📄";
  if (type === "audio") return "🎙️";
  if (type === "video") return "🎥";
  if (type === "sticker") return "🪄";
  return "💬";
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function Messages() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "processed">("all");
  const [selected, setSelected] = useState<WaMessage | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyMsg, setReplyMsg] = useState("");

  // ── Realtime SSE — inbox update otomatis saat pesan WA masuk ────────────────
  useServerEvents({
    new_message: () => {
      void queryClient.invalidateQueries({ queryKey: ["wa-messages"] });
    },
    new_task: () => {
      void queryClient.invalidateQueries({ queryKey: ["wa-messages"] });
    },
  });

  const { data: messages = [], isLoading, isFetching } = useQuery<WaMessage[]>({
    queryKey: ["wa-messages"],
    queryFn: () => apiFetch("/messages"),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  // Mark as processed
  const processMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/messages/${id}/process`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "✅ Pesan ditandai sudah diproses" });
      void queryClient.invalidateQueries({ queryKey: ["wa-messages"] });
    },
    onError: () => toast({ title: "Gagal memproses pesan", variant: "destructive" }),
  });

  // Send reply via Fonnte
  const replyMutation = useMutation({
    mutationFn: ({ to, message }: { to: string; message: string }) =>
      apiFetch("/ai-tasks/reply-wa", {
        method: "POST",
        body: JSON.stringify({ to, message }),
      }),
    onSuccess: () => {
      toast({ title: "✅ Balasan WA dikirim" });
      setReplyOpen(false);
      setReplyMsg("");
    },
    onError: (err) =>
      toast({
        title: "❌ Gagal kirim balasan",
        description: err instanceof Error ? err.message : "Terjadi kesalahan",
        variant: "destructive",
      }),
  });

  // Filter + search
  const filtered = messages.filter((m) => {
    if (filter === "unread" && m.processed) return false;
    if (filter === "processed" && !m.processed) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        m.body?.toLowerCase().includes(q) ||
        m.senderName?.toLowerCase().includes(q) ||
        m.from?.includes(q) ||
        m.detectedIntent?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const total    = messages.length;
  const unread   = messages.filter((m) => !m.processed).length;
  const aiDone   = messages.filter((m) => m.aiProcessed).length;
  const withTask = messages.filter((m) => m.taskId).length;

  function openReply(msg: WaMessage) {
    setSelected(msg);
    setReplyMsg("");
    setReplyOpen(true);
  }

  function formatTs(m: WaMessage): string {
    try {
      const ts = m.timestamp
        ? new Date(Number(m.timestamp) * 1000)
        : m.createdAt
        ? new Date(m.createdAt)
        : null;
      if (!ts || isNaN(ts.getTime())) return "";
      return formatDistanceToNow(ts, { addSuffix: true, locale: localeId });
    } catch {
      return "";
    }
  }

  function formatTsFull(m: WaMessage): string {
    try {
      const ts = m.timestamp
        ? new Date(Number(m.timestamp) * 1000)
        : m.createdAt
        ? new Date(m.createdAt)
        : null;
      if (!ts || isNaN(ts.getTime())) return "-";
      return format(ts, "dd MMM yyyy, HH:mm", { locale: localeId });
    } catch {
      return "-";
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto w-full space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Inbox className="h-6 w-6 text-green-600" />
            WhatsApp Inbox
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Pesan masuk dari customer via Fonnte / WhatsApp Business
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["wa-messages"] })}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Pesan",   value: total,    icon: MessageSquare, color: "text-gray-700" },
          { label: "Belum Dibaca",  value: unread,   icon: AlertCircle,   color: "text-amber-600" },
          { label: "Diproses AI",   value: aiDone,   icon: Bot,           color: "text-blue-600" },
          { label: "Ada Task",      value: withTask, icon: FileText,      color: "text-green-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white border rounded-xl p-3 flex items-center gap-3">
            <s.icon className={`h-5 w-5 shrink-0 ${s.color}`} />
            <div>
              <p className="text-xl font-bold leading-none">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-8 h-9 text-sm"
            placeholder="Cari nama, nomor, atau intent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-44 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Pesan</SelectItem>
            <SelectItem value="unread">Belum Diproses</SelectItem>
            <SelectItem value="processed">Sudah Diproses</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-gray-400">{filtered.length} pesan</span>
      </div>

      {/* Message list */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border rounded-xl p-4 flex gap-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <Inbox className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Tidak ada pesan</p>
            <p className="text-gray-400 text-sm mt-1">
              {search
                ? "Coba ubah kata kunci pencarian"
                : "Belum ada pesan WhatsApp masuk. Pastikan Fonnte webhook sudah dikonfigurasi di halaman Webhook Setup."}
            </p>
          </div>
        ) : (
          filtered.map((msg) => (
            <div
              key={msg.id}
              className={`bg-white border rounded-xl p-4 transition-shadow hover:shadow-sm ${
                !msg.processed
                  ? "border-l-4 border-l-green-500"
                  : "border-gray-200"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center shrink-0 font-semibold text-green-700 text-sm">
                  {msg.senderName
                    ? msg.senderName.charAt(0).toUpperCase()
                    : <User className="h-5 w-5" />}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Row 1: name + type icon + timestamp */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">
                      {msg.senderName ?? msg.from ?? "Unknown"}
                    </span>
                    <span className="text-base leading-none" title={msg.messageType ?? "text"}>
                      {msgTypeIcon(msg.messageType)}
                    </span>
                    {!msg.processed && (
                      <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">
                        Baru
                      </span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTs(msg)}
                    </span>
                  </div>

                  {/* Row 2: phone */}
                  <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400 font-mono">
                    <Phone className="h-3 w-3" />
                    {msg.from ?? msg.senderPhone ?? "-"}
                  </div>

                  {/* Row 3: message body */}
                  <p className="mt-2 text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
                    {msg.body ?? "(pesan tanpa teks)"}
                  </p>

                  {/* Row 4: AI intent + task link */}
                  {(msg.detectedIntent || msg.taskId) && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {msg.detectedIntent && intentBadge(msg.detectedIntent)}
                      {msg.taskId && (
                        <Link
                          href={`/ai-tasks/${msg.taskId}`}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          <ArrowUpRight className="h-3 w-3" />
                          Lihat Task #{msg.taskId}
                        </Link>
                      )}
                      {msg.aiProcessed && !msg.detectedIntent && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> AI Selesai
                        </span>
                      )}
                    </div>
                  )}

                  {/* Row 5: action buttons */}
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                      onClick={() => openReply(msg)}
                    >
                      <Send className="h-3 w-3" />
                      Balas WA
                    </Button>

                    {!msg.processed && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1.5 text-gray-600 hover:bg-gray-100"
                        disabled={processMutation.isPending}
                        onClick={() => processMutation.mutate(msg.id)}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Tandai Selesai
                      </Button>
                    )}

                    {msg.processed && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        Sudah diproses
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Reply Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={replyOpen} onOpenChange={(open) => { setReplyOpen(open); if (!open) setSelected(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <MessageSquare className="h-5 w-5" />
              Balas Pesan WhatsApp
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 py-1">
              {/* Penerima */}
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
                <User className="h-4 w-4 text-green-600 shrink-0" />
                <span className="font-medium text-green-800">{selected.senderName ?? selected.from}</span>
                <span className="text-green-600 ml-1 font-mono text-xs">{selected.from}</span>
              </div>

              {/* Pesan asli */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Pesan asli</p>
                <div className="bg-gray-50 border rounded-lg px-3 py-2 text-sm text-gray-700 line-clamp-4 whitespace-pre-wrap">
                  {selected.body ?? "(tidak ada teks)"}
                </div>
                <p className="text-xs text-gray-400 text-right">{formatTsFull(selected)}</p>
              </div>

              {/* Input balasan */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Balasan Anda</label>
                <Textarea
                  value={replyMsg}
                  onChange={(e) => setReplyMsg(e.target.value)}
                  placeholder="Ketik balasan di sini…"
                  className="min-h-[120px] text-sm font-mono resize-none"
                />
                <p className="text-xs text-gray-400 text-right">{replyMsg.length} karakter</p>
              </div>

              {/* Preview bubble */}
              {replyMsg.trim() && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500">Preview</p>
                  <div className="bg-[#DCF8C6] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-gray-800 whitespace-pre-wrap shadow-sm border border-green-200">
                    {replyMsg}
                  </div>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                ⚠️ Balasan dikirim via <strong>Fonnte</strong>. Pastikan <code>FONNTE_TOKEN</code> sudah disetel.
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReplyOpen(false)}>Batal</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
              disabled={!replyMsg.trim() || replyMutation.isPending || !selected?.from}
              onClick={() =>
                replyMutation.mutate({ to: selected!.from!, message: replyMsg })
              }
            >
              {replyMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</>
                : <><Send className="h-4 w-4" /> Kirim Balasan</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
