import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, CheckCheck, AlertTriangle, MessageSquare, FileText,
  TrendingUp, Clock, ShieldCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useServerEvents } from "@/hooks/use-server-events";
import { getStoredToken } from "@/lib/auth-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface AdminNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  taskId: number | null;
  customerPhone: string | null;
  customerName: string | null;
  isRead: boolean;
  createdAt: string;
}

const NOTIF_ICONS: Record<string, React.ReactNode> = {
  new_inquiry:           <MessageSquare className="h-3.5 w-3.5 text-blue-500" />,
  high_priority_task:    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
  document_uploaded:     <FileText className="h-3.5 w-3.5 text-green-500" />,
  audit_missing_data:    <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />,
  audit_complete:        <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />,
  missing_data_resolved: <CheckCheck className="h-3.5 w-3.5 text-green-500" />,
  team_progress_update:  <TrendingUp className="h-3.5 w-3.5 text-indigo-500" />,
  vendor_quotation:      <FileText className="h-3.5 w-3.5 text-purple-500" />,
  waiting_review:        <Clock className="h-3.5 w-3.5 text-amber-500" />,
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidateNotifs = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
  }, [queryClient]);

  // ── SSE real-time updates ─────────────────────────────────────────────────
  useServerEvents({
    new_task: (data) => {
      invalidateNotifs();
      const priority = String(data.priority ?? "");
      const title    = String(data.title ?? "Task baru");
      toast({
        title: priority.toLowerCase() === "high"
          ? "🔴 Task prioritas tinggi!"
          : "💬 Task baru dari WhatsApp",
        description: title.length > 80 ? title.slice(0, 77) + "…" : title,
      });
    },
    audit_complete: (data) => {
      invalidateNotifs();
      const status = String(data.auditStatus ?? "");
      const statusLabel: Record<string, string> = {
        pass:    "✅ Lulus",
        warning: "⚠️ Perlu perhatian",
        fail:    "❌ Gagal",
      };
      toast({
        title: "Audit dokumen selesai",
        description: `Task #${data.taskId} — ${statusLabel[status] ?? status}`,
      });
    },
  });

  // ── Data fetching (fallback polling removed — SSE handles refresh) ─────────
  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["notifications-count"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/notifications/unread-count`, { headers: authHeaders() });
      return res.json();
    },
    refetchInterval: 60_000, // safety fallback every 60s (was 15s)
  });

  const { data: notifications = [] } = useQuery<AdminNotification[]>({
    queryKey: ["notifications-list"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/notifications?limit=20`, { headers: authHeaders() });
      return res.json();
    },
    enabled: open,
    refetchInterval: open ? 60_000 : false,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/notifications/${id}/read`, { method: "PATCH", headers: authHeaders() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/notifications/read-all`, { method: "POST", headers: authHeaders() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const unread = countData?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full h-4 w-4 flex items-center justify-center leading-none">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifikasi</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] text-blue-600 px-2"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              Tandai semua dibaca
            </Button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto divide-y">
          {notifications.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">Tidak ada notifikasi</p>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${!n.isRead ? "bg-blue-50/50" : ""}`}
              onClick={() => { if (!n.isRead) markRead.mutate(n.id); }}
            >
              <div className="mt-0.5 shrink-0">
                {NOTIF_ICONS[n.type] ?? <Bell className="h-3.5 w-3.5 text-gray-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium leading-tight ${!n.isRead ? "text-gray-900" : "text-gray-600"}`}>
                  {n.title}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-snug line-clamp-2">{n.body}</p>
                <p className="text-[10px] text-gray-400 mt-1">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </p>
              </div>
              {!n.isRead && (
                <div className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
