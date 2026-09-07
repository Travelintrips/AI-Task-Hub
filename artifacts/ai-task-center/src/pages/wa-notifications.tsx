import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquare,
  Search,
  RefreshCw,
  Phone,
  User,
  Briefcase,
  Eye,
  Send,
  Loader2,
} from "lucide-react";
import { getStoredToken } from "@/lib/auth-api";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WaNotification {
  id: number;
  taskId: number | null;
  companyId: string;
  recipientPhone: string;
  recipientType: string;
  templateName: string | null;
  messageText: string;
  status: string;
  externalMessageId: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface WaNotifStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
}

interface WaNotifResponse {
  total: number;
  items: WaNotification[];
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchWaNotifs(params: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<WaNotifResponse> {
  const token = getStoredToken();
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.search)  qs.set("search", params.search);
  if (params.limit)   qs.set("limit",  String(params.limit));
  if (params.offset)  qs.set("offset", String(params.offset));

  const res = await fetch(`/api/wa-notifications?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Gagal memuat notifikasi");
  return res.json() as Promise<WaNotifResponse>;
}

async function fetchWaStats(): Promise<WaNotifStats> {
  const token = getStoredToken();
  const res = await fetch("/api/wa-notifications/stats", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Gagal memuat statistik");
  return res.json() as Promise<WaNotifStats>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  switch (status) {
    case "sent":
      return (
        <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Terkirim
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
          <XCircle className="h-3 w-3" /> Gagal
        </Badge>
      );
    default:
      return (
        <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 gap-1">
          <Clock className="h-3 w-3" /> Pending
        </Badge>
      );
  }
}

function recipientBadge(type: string) {
  if (type === "customer") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-blue-600">
        <User className="h-3 w-3" /> Customer
      </span>
    );
  }
  if (type === "group") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <MessageSquare className="h-3 w-3" /> Grup WA
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-purple-600">
      <Briefcase className="h-3 w-3" /> Staff
    </span>
  );
}

function templateLabel(name: string | null): string {
  const map: Record<string, string> = {
    task_created_customer:  "Task Dibuat",
    status_changed_customer: "Status Berubah",
    task_assigned_customer: "Task Assigned (Customer)",
    task_assigned_staff:    "Task Assigned (Staff)",
  };
  return name ? (map[name] ?? name) : "—";
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: {
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold">
            {value === undefined ? <Skeleton className="h-7 w-10" /> : value}
          </p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

async function sendGroupWa(groupJid: string, message: string): Promise<{ success: boolean; error?: string }> {
  const token = getStoredToken();
  const res = await fetch("/api/whatsapp/send-group", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ groupJid, message }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export default function WaNotifications() {
  const { toast } = useToast();
  const [search,     setSearch]     = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page,       setPage]       = useState(0);
  const [selected,   setSelected]   = useState<WaNotification | null>(null);

  // ── Kirim ke Grup WA ────────────────────────────────────────────────────────
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupJid,        setGroupJid]        = useState("");
  const [groupMessage,    setGroupMessage]    = useState("");

  const sendGroupMutation = useMutation({
    mutationFn: () => sendGroupWa(groupJid.trim(), groupMessage.trim()),
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "✅ Pesan berhasil dikirim ke Grup WA" });
        setGroupDialogOpen(false);
        setGroupJid("");
        setGroupMessage("");
      } else {
        toast({ title: "⚠️ Fonnte tidak berhasil mengirim", description: data.error, variant: "destructive" });
      }
    },
    onError: (err: Error) =>
      toast({ title: "❌ Gagal kirim ke Grup WA", description: err.message, variant: "destructive" }),
  });

  const offset = page * PAGE_SIZE;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["wa-notif-stats"],
    queryFn: fetchWaStats,
    staleTime: 30_000,
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["wa-notifications", statusFilter, search, page],
    queryFn: () => fetchWaNotifs({ status: statusFilter, search: search || undefined, limit: PAGE_SIZE, offset }),
    staleTime: 15_000,
  });

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(0);
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto w-full space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-green-600" />
            Riwayat Notifikasi WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Log semua pesan WhatsApp yang dikirim sistem via Fonnte
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white gap-2"
            onClick={() => setGroupDialogOpen(true)}
          >
            <MessageSquare className="h-4 w-4" />
            Kirim ke Grup WA
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Dialog Kirim ke Grup WA ─────────────────────────────────────────────── */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <MessageSquare className="h-5 w-5" />
              Kirim Pesan ke Grup WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">
                Group JID
              </Label>
              <Input
                value={groupJid}
                onChange={(e) => setGroupJid(e.target.value)}
                placeholder="628xxxxxxxxxx-xxxxxxxxxx@g.us"
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-gray-400">
                Format: nomor_pembuat-timestamp@g.us · Dapatkan dari log webhook Fonnte saat ada pesan masuk dari grup tersebut.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Isi Pesan</Label>
              <Textarea
                value={groupMessage}
                onChange={(e) => setGroupMessage(e.target.value)}
                placeholder="Ketik pesan broadcast untuk grup WhatsApp…"
                className="min-h-[160px] text-sm font-mono resize-none leading-relaxed"
              />
              <p className="text-xs text-gray-400 text-right">{groupMessage.length} karakter</p>
            </div>

            {groupMessage.trim() && (
              <div className="bg-[#DCF8C6] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-gray-800 whitespace-pre-wrap max-h-[120px] overflow-y-auto shadow-sm border border-green-200">
                {groupMessage}
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
              💡 Sistem akan mencoba semua device Fonnte secara otomatis hingga satu berhasil mengirim ke grup.
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setGroupDialogOpen(false)}>Batal</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
              disabled={
                !groupJid.trim().endsWith("@g.us") ||
                !groupMessage.trim() ||
                sendGroupMutation.isPending
              }
              onClick={() => sendGroupMutation.mutate()}
            >
              {sendGroupMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</>
                : <><Send className="h-4 w-4" /> Kirim ke Grup</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Notifikasi"
          value={statsLoading ? undefined : stats?.total}
          icon={<MessageSquare className="h-5 w-5 text-blue-600" />}
          color="bg-blue-50"
        />
        <StatCard
          label="Terkirim"
          value={statsLoading ? undefined : stats?.sent}
          icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
          color="bg-green-50"
        />
        <StatCard
          label="Gagal"
          value={statsLoading ? undefined : stats?.failed}
          icon={<XCircle className="h-5 w-5 text-red-600" />}
          color="bg-red-50"
        />
        <StatCard
          label="Pending"
          value={statsLoading ? undefined : stats?.pending}
          icon={<Clock className="h-5 w-5 text-yellow-600" />}
          color="bg-yellow-50"
        />
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <Input
            placeholder="Cari nomor, pesan, atau template…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1"
          />
          <Button variant="outline" size="icon" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="sent">Terkirim</SelectItem>
            <SelectItem value="failed">Gagal</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto rounded-lg">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-[50px]">ID</TableHead>
                <TableHead>Nomor</TableHead>
                <TableHead>Penerima</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Waktu</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                    <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">Belum ada riwayat notifikasi</p>
                    <p className="text-sm mt-1">
                      Notifikasi akan muncul di sini saat task dibuat atau statusnya berubah
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((notif) => (
                  <TableRow key={notif.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setSelected(notif)}>
                    <TableCell className="text-muted-foreground text-xs font-mono">{notif.id}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 font-mono text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {notif.recipientPhone}
                      </span>
                    </TableCell>
                    <TableCell>{recipientBadge(notif.recipientType)}</TableCell>
                    <TableCell className="text-sm">{templateLabel(notif.templateName)}</TableCell>
                    <TableCell>{statusBadge(notif.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      <span title={format(new Date(notif.createdAt), "dd MMM yyyy HH:mm:ss")}>
                        {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true, locale: localeId })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, data?.total ?? 0)} dari {data?.total} notifikasi
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Sebelumnya
              </Button>
              <Button
                variant="outline" size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Berikutnya →
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-600" />
              Detail Notifikasi #{selected?.id}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Status</p>
                  {statusBadge(selected.status)}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Penerima</p>
                  {recipientBadge(selected.recipientType)}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Nomor Tujuan</p>
                  <span className="font-mono">{selected.recipientPhone}</span>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Template</p>
                  <span>{templateLabel(selected.templateName)}</span>
                </div>
                {selected.taskId && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Task ID</p>
                    <span className="font-mono">#{selected.taskId}</span>
                  </div>
                )}
                {selected.externalMessageId && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Message ID Fonnte</p>
                    <span className="font-mono text-xs break-all">{selected.externalMessageId}</span>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Dibuat</p>
                  <span>{format(new Date(selected.createdAt), "dd MMM yyyy HH:mm:ss")}</span>
                </div>
                {selected.sentAt && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Dikirim</p>
                    <span>{format(new Date(selected.sentAt), "dd MMM yyyy HH:mm:ss")}</span>
                  </div>
                )}
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Isi Pesan</p>
                <pre className="bg-muted rounded-md p-3 text-xs whitespace-pre-wrap leading-relaxed font-sans border">
                  {selected.messageText}
                </pre>
              </div>

              {selected.errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-700 text-xs">
                  <p className="font-medium mb-1">Error:</p>
                  <p>{selected.errorMessage}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
