import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Trash2, AlertTriangle, Info, User, FileText, MessageSquare, Clock, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";
import { getStoredToken } from "@/lib/auth-api";

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

interface Notification {
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

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  task_created:    { icon: Check,         color: "text-green-600",  bg: "bg-green-50" },
  task_assigned:   { icon: User,          color: "text-blue-600",   bg: "bg-blue-50" },
  status_changed:  { icon: Info,          color: "text-indigo-600", bg: "bg-indigo-50" },
  document_upload: { icon: FileText,      color: "text-amber-600",  bg: "bg-amber-50" },
  customer_reply:  { icon: MessageSquare, color: "text-teal-600",   bg: "bg-teal-50" },
  task_overdue:    { icon: AlertTriangle, color: "text-red-600",    bg: "bg-red-50" },
  ai_alert:        { icon: Brain,         color: "text-violet-600", bg: "bg-violet-50" },
  default:         { icon: Bell,          color: "text-gray-600",   bg: "bg-gray-50" },
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("all");

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications", tab],
    queryFn: () => apiFetch(`/notifications?unreadOnly=${tab === "unread"}&limit=100`),
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiFetch(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notifications"] }); queryClient.invalidateQueries({ queryKey: ["notif-count"] }); },
  });

  const markAllRead = useMutation({
    mutationFn: () => apiFetch("/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notifications"] }); queryClient.invalidateQueries({ queryKey: ["notif-count"] }); toast({ title: "Semua notifikasi ditandai sudah dibaca" }); },
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="h-6 w-6 text-primary" /> Notifikasi</h1>
          <p className="text-muted-foreground text-sm mt-1">{unreadCount > 0 ? `${unreadCount} belum dibaca` : "Semua sudah dibaca"}</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
            <CheckCheck className="h-4 w-4 mr-2" /> Tandai Semua Dibaca
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">Semua</TabsTrigger>
          <TabsTrigger value="unread">Belum Dibaca {unreadCount > 0 && <Badge className="ml-2 h-5 text-xs" variant="destructive">{unreadCount}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-12 text-muted-foreground"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
          ) : notifications.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground"><Bell className="h-10 w-10 mx-auto mb-3 opacity-30" /><p>Tidak ada notifikasi</p></CardContent></Card>
          ) : (
            notifications.map((notif) => {
              const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG.default;
              const Icon = cfg.icon;
              return (
                <div
                  key={notif.id}
                  className={`flex gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${notif.isRead ? "bg-white border-border" : "bg-blue-50/50 border-blue-200"}`}
                  onClick={() => { if (!notif.isRead) markRead.mutate(notif.id); }}
                >
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${cfg.bg}`}>
                    <Icon className={`h-4 w-4 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${notif.isRead ? "text-foreground" : "text-foreground font-semibold"}`}>{notif.title}</p>
                      {!notif.isRead && <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true, locale: id })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
