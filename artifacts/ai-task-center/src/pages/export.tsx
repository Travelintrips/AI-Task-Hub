import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  Download,
  FileSpreadsheet,
  Kanban,
  MessageSquare,
  BellRing,
  Activity,
  Package,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "@/lib/auth-api";

// ─── helpers ──────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function downloadExport(endpoint: string, filename: string) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${endpoint}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Export gagal");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStr() {
  return format(new Date(), "yyyy-MM-dd");
}

// ─── export card config ────────────────────────────────────────────────────────

const EXPORT_ITEMS = [
  {
    id: "all",
    icon: Package,
    color: "text-violet-600",
    bg: "bg-violet-50 border-violet-200",
    badge: "bg-violet-100 text-violet-700",
    title: "Backup Lengkap",
    desc: "Semua data dalam satu file Excel — AI Tasks, Pesan WA, Notifikasi, Aktivitas (4 sheet).",
    endpoint: "/export/all",
    filename: () => `backup-lengkap_${todayStr()}.xlsx`,
    statsKey: "all",
  },
  {
    id: "ai-tasks",
    icon: Kanban,
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
    badge: "bg-blue-100 text-blue-700",
    title: "AI Tasks",
    desc: "Semua task beserta detail customer, status, prioritas, kuotasi, dan ringkasan AI.",
    endpoint: "/export/ai-tasks",
    filename: () => `ai-tasks_${todayStr()}.xlsx`,
    statsKey: "aiTasks",
  },
  {
    id: "messages",
    icon: MessageSquare,
    color: "text-green-600",
    bg: "bg-green-50 border-green-200",
    badge: "bg-green-100 text-green-700",
    title: "Pesan WA Masuk",
    desc: "Semua pesan WhatsApp dari customer beserta intent AI yang terdeteksi.",
    endpoint: "/export/messages",
    filename: () => `wa-messages_${todayStr()}.xlsx`,
    statsKey: "messages",
  },
  {
    id: "wa-notifications",
    icon: BellRing,
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
    badge: "bg-amber-100 text-amber-700",
    title: "Notifikasi WA Keluar",
    desc: "Log semua pesan WA yang dikirimkan keluar via Fonnte — status, template, dan pesan error.",
    endpoint: "/export/wa-notifications",
    filename: () => `wa-notifikasi_${todayStr()}.xlsx`,
    statsKey: "waNotifs",
  },
] as const;

// ─── component ────────────────────────────────────────────────────────────────

export default function ExportPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);

  // Fetch counts for stat display
  const { data: stats } = useQuery({
    queryKey: ["export-stats"],
    queryFn: async () => {
      const [tasks, msgs, notifs] = await Promise.allSettled([
        apiFetch("/ai-tasks"),
        apiFetch("/messages"),
        apiFetch("/wa-notifications/stats"),
      ]);
      return {
        aiTasks:  tasks.status  === "fulfilled" && Array.isArray(tasks.value)  ? tasks.value.length  : 0,
        messages: msgs.status   === "fulfilled" && Array.isArray(msgs.value)   ? msgs.value.length   : 0,
        waNotifs: notifs.status === "fulfilled" ? (notifs.value as { total?: number })?.total ?? 0 : 0,
      };
    },
    staleTime: 30_000,
  });

  async function handleDownload(item: typeof EXPORT_ITEMS[number]) {
    setLoading(item.id);
    try {
      await downloadExport(item.endpoint, item.filename());
      toast({ title: `✅ ${item.title} berhasil diunduh` });
    } catch (err) {
      toast({
        title: `❌ Gagal mengunduh ${item.title}`,
        description: err instanceof Error ? err.message : "Terjadi kesalahan",
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  }

  const totalRows =
    (stats?.aiTasks ?? 0) +
    (stats?.messages ?? 0) +
    (stats?.waNotifs ?? 0);

  return (
    <div className="p-6 max-w-3xl mx-auto w-full space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6 text-violet-600" />
          Export & Backup Data
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Unduh data ke file Excel (.xlsx) untuk backup atau analisis lebih lanjut.
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "AI Tasks",     value: stats?.aiTasks  ?? "—", icon: Kanban,        color: "text-blue-600"  },
          { label: "Pesan Masuk",  value: stats?.messages ?? "—", icon: MessageSquare, color: "text-green-600" },
          { label: "Notif WA",     value: stats?.waNotifs ?? "—", icon: BellRing,       color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white border rounded-xl p-4 flex items-center gap-3">
            <s.icon className={`h-5 w-5 shrink-0 ${s.color}`} />
            <div>
              <p className="text-xl font-bold leading-none">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Total {totalRows.toLocaleString("id-ID")} baris data</span> siap diunduh.
          File Excel dibuka dengan Microsoft Excel, Google Sheets, atau aplikasi spreadsheet lainnya.
          Kolom lebar otomatis diatur untuk kemudahan membaca.
        </div>
      </div>

      {/* Export cards */}
      <div className="space-y-3">
        {EXPORT_ITEMS.map((item) => {
          const isLoading = loading === item.id;
          const isAnyLoading = loading !== null;
          const count =
            item.statsKey === "aiTasks"  ? stats?.aiTasks  :
            item.statsKey === "messages" ? stats?.messages  :
            item.statsKey === "waNotifs" ? stats?.waNotifs  :
            item.statsKey === "all"      ? totalRows        : undefined;

          return (
            <div
              key={item.id}
              className={`flex items-center gap-4 border rounded-xl p-4 bg-white hover:shadow-sm transition-shadow ${isLoading ? "opacity-80" : ""}`}
            >
              {/* Icon */}
              <div className={`h-12 w-12 rounded-xl border flex items-center justify-center shrink-0 ${item.bg}`}>
                <item.icon className={`h-6 w-6 ${item.color}`} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{item.title}</span>
                  {count !== undefined && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.badge}`}>
                      {item.statsKey === "all" ? `${count} baris total` : `${count} baris`}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">.xlsx</span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5 leading-snug">{item.desc}</p>
              </div>

              {/* Download button */}
              <Button
                size="sm"
                variant="outline"
                className={`shrink-0 gap-1.5 ${item.color} border-current hover:bg-current/5`}
                disabled={isAnyLoading}
                onClick={() => handleDownload(item)}
              >
                {isLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Mengunduh…</>
                ) : (
                  <><Download className="h-4 w-4" /> Unduh</>
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="text-xs text-gray-400 flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        File diunduh langsung dari server — data real-time, tidak ada cache.
        Nama file otomatis menyertakan tanggal hari ini.
      </div>
    </div>
  );
}
