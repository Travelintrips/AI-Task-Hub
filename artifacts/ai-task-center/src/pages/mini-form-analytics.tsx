/**
 * Mini Form Analytics — Sprint 9B
 * Route: /mini-form-analytics
 * Menampilkan statistik Mini Form Router: flow distribution, submission rate, form type breakdown
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, MessageSquare, Layers, CheckCircle2, Clock, XCircle, TrendingUp, BarChart3, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
    const b = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((b as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

interface AnalyticsData {
  period: { days: number; since: string };
  summary: {
    total: number;
    miniFormTotal: number;
    conversationTotal: number;
    hybridTotal: number;
    miniFormSubmitted: number;
    submissionRate: number;
    byStatus: Record<string, number>;
  };
  byFormType: Record<string, { sent: number; submitted: number; expired: number; pending: number }>;
  topIntents: { intentCode: string; count: number }[];
  daily: { date: string; conversation: number; mini_form: number; submitted: number }[];
}

const FORM_TYPE_LABELS: Record<string, string> = {
  trucking: "🚛 Trucking",
  freight: "🚢 Freight/Import",
  complaint: "⚠️ Komplain",
  "fleet-repair": "🔧 Fleet Repair",
  "cash-advance": "💰 Kasbon",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  collecting: { label: "Mengumpulkan", color: "bg-blue-100 text-blue-700" },
  form_sent: { label: "Form Dikirim", color: "bg-amber-100 text-amber-700" },
  submitted: { label: "Selesai", color: "bg-green-100 text-green-700" },
  ready_for_task: { label: "Siap Task", color: "bg-purple-100 text-purple-700" },
  expired: { label: "Kedaluwarsa", color: "bg-gray-100 text-gray-500" },
  cancelled: { label: "Dibatalkan", color: "bg-red-100 text-red-600" },
};

function StatCard({
  icon,
  title,
  value,
  sub,
  color = "blue",
}: {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  sub?: string;
  color?: "blue" | "green" | "amber" | "purple" | "red";
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    amber: "bg-amber-50 text-amber-600",
    purple: "bg-purple-50 text-purple-600",
    red: "bg-red-50 text-red-600",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold text-foreground leading-none mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SimpleBar({ value, max, color = "#3b82f6" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-muted-foreground w-6 text-right">{value}</span>
    </div>
  );
}

export default function MiniFormAnalyticsPage() {
  const [days, setDays] = useState(30);
  const { toast } = useToast();

  const { data, isLoading, error, refetch, isFetching } = useQuery<AnalyticsData>({
    queryKey: ["mini-form-analytics", days],
    queryFn: () => apiFetch(`/intake-sessions/analytics?days=${days}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-muted rounded w-64 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-600 font-medium">Gagal memuat analytics</p>
          <p className="text-sm text-red-500 mt-1">{(error as Error).message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Coba Lagi</Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, byFormType, topIntents, daily } = data;
  const maxDaily = Math.max(...daily.map((d) => d.conversation + d.mini_form), 1);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Mini Form Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Statistik routing: conversation vs mini form vs hybrid
          </p>
        </div>
        <div className="flex items-center gap-2">
          {([7, 14, 30, 60] as const).map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d}h
            </Button>
          ))}
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              refetch();
              toast({ title: "Memperbarui data..." });
            }}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Layers className="w-5 h-5" />}
          title="Total Intake Sessions"
          value={summary.total}
          sub={`${days} hari terakhir`}
          color="blue"
        />
        <StatCard
          icon={<FileText className="w-5 h-5" />}
          title="Mini Form Dikirim"
          value={summary.miniFormTotal}
          sub={`${summary.total > 0 ? Math.round((summary.miniFormTotal / summary.total) * 100) : 0}% dari total`}
          color="amber"
        />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          title="Submission Rate"
          value={`${summary.submissionRate}%`}
          sub={`${summary.miniFormSubmitted} dari ${summary.miniFormTotal} form`}
          color="green"
        />
        <StatCard
          icon={<MessageSquare className="w-5 h-5" />}
          title="Conversation Flow"
          value={summary.conversationTotal}
          sub={`${summary.hybridTotal} hybrid`}
          color="purple"
        />
      </div>

      {/* Flow Distribution */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Distribusi Flow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "💬 Conversation", value: summary.conversationTotal, color: "#8b5cf6" },
              { label: "📋 Mini Form", value: summary.miniFormTotal, color: "#f59e0b" },
              { label: "🔀 Hybrid", value: summary.hybridTotal, color: "#3b82f6" },
            ].map((f) => (
              <div key={f.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{f.label}</span>
                  <span className="text-muted-foreground">
                    {f.value} ({summary.total > 0 ? Math.round((f.value / summary.total) * 100) : 0}%)
                  </span>
                </div>
                <SimpleBar
                  value={f.value}
                  max={summary.total}
                  color={f.color}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Status Sesi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(summary.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => {
                const meta = STATUS_LABELS[status] ?? { label: status, color: "bg-gray-100 text-gray-600" };
                return (
                  <div key={status} className="flex items-center justify-between">
                    <Badge className={`text-xs ${meta.color} border-0`}>{meta.label}</Badge>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-current rounded-full"
                          style={{ width: `${summary.total > 0 ? (count / summary.total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold w-8 text-right">{count}</span>
                    </div>
                  </div>
                );
              })}
            {Object.keys(summary.byStatus).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Belum ada data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Form Type Breakdown */}
      {Object.keys(byFormType).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Breakdown Per Tipe Form</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(byFormType).map(([type, stats]) => {
                const label = FORM_TYPE_LABELS[type] ?? `📄 ${type}`;
                const rate = stats.sent > 0 ? Math.round((stats.submitted / stats.sent) * 100) : 0;
                return (
                  <div key={type} className="border border-border rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{label}</span>
                      <Badge variant="secondary" className="text-xs">{stats.sent} dikirim</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <div>
                        <p className="text-xs text-muted-foreground">Selesai</p>
                        <p className="text-base font-bold text-green-600">{stats.submitted}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Pending</p>
                        <p className="text-base font-bold text-amber-600">{stats.pending}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Expired</p>
                        <p className="text-base font-bold text-gray-400">{stats.expired}</p>
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Submission rate</span>
                        <span className="font-medium text-foreground">{rate}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full"
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Intents + Daily Trend side by side */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              <TrendingUp className="w-4 h-4 inline mr-1.5 text-muted-foreground" />
              Intent Terpopuler
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topIntents.map((item, i) => (
              <div key={item.intentCode} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.intentCode}</p>
                </div>
                <SimpleBar
                  value={item.count}
                  max={topIntents[0]?.count ?? 1}
                  color="#3b82f6"
                />
              </div>
            ))}
            {topIntents.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Belum ada data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              <BarChart3 className="w-4 h-4 inline mr-1.5 text-muted-foreground" />
              Tren Harian
            </CardTitle>
          </CardHeader>
          <CardContent>
            {daily.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Belum ada data</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {[...daily].reverse().slice(0, 14).map((d) => {
                  const total = d.conversation + d.mini_form;
                  return (
                    <div key={d.date} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-20 flex-shrink-0">
                        {new Date(d.date).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
                      </span>
                      <div className="flex-1 flex gap-0.5 h-4 rounded overflow-hidden bg-gray-100">
                        {total > 0 ? (
                          <>
                            {d.conversation > 0 && (
                              <div
                                className="bg-purple-400 h-full"
                                title={`Conversation: ${d.conversation}`}
                                style={{ width: `${(d.conversation / maxDaily) * 100}%` }}
                              />
                            )}
                            {d.mini_form > 0 && (
                              <div
                                className="bg-amber-400 h-full"
                                title={`Mini Form: ${d.mini_form}`}
                                style={{ width: `${(d.mini_form / maxDaily) * 100}%` }}
                              />
                            )}
                          </>
                        ) : (
                          <div className="w-full bg-gray-100" />
                        )}
                      </div>
                      <span className="text-muted-foreground w-6 text-right">{total}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex gap-4 mt-3 pt-3 border-t">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded bg-purple-400" /> Conversation
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded bg-amber-400" /> Mini Form
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Link to config */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-800">Konfigurasi flow untuk setiap intent</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Atur mana intent yang menggunakan conversation, mini form, atau hybrid di halaman Konfigurasi.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-blue-300 text-blue-700 hover:bg-blue-100 flex-shrink-0"
          onClick={() => { window.location.href = "/mini-form-config"; }}
        >
          Buka Konfigurasi →
        </Button>
      </div>
    </div>
  );
}
