import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, BarChart2, Users,
  MessageSquare, CheckCircle, Loader2, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyPoint {
  month: string;
  total: string;
  completed: string;
  active: string;
}

interface CategoryPoint {
  name: string;
  value: string;
}

interface TeamMember {
  name: string;
  total: string;
  completed: string;
  active: string;
  completion_rate: string;
}

interface MessagePoint {
  month: string;
  total: string;
  processed: string;
}

interface AnalyticsData {
  monthlyTrend: MonthlyPoint[];
  byCategory: CategoryPoint[];
  byDivision: CategoryPoint[];
  teamPerformance: TeamMember[];
  byStatus: CategoryPoint[];
  byPriority: CategoryPoint[];
  messageTrend: MessagePoint[];
  summary: {
    thisMonth: { new_tasks: string; completed: string };
    lastMonth: { new_tasks: string; completed: string };
  };
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#6366f1",
];

const STATUS_COLORS: Record<string, string> = {
  "completed":         "#10b981",
  "in_progress":       "#f97316",
  "new_inquiry":       "#3b82f6",
  "waiting_documents": "#f59e0b",
  "assigned":          "#6366f1",
  "cancelled":         "#9ca3af",
  "ready_for_review":  "#8b5cf6",
  "waiting_customer":  "#06b6d4",
};

const PRIORITY_COLORS: Record<string, string> = {
  high:   "#ef4444",
  medium: "#f59e0b",
  low:    "#10b981",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: string | number | undefined): number {
  return Number(v ?? 0);
}

function pct(a: number, b: number): number {
  if (!b) return 0;
  return Math.round((a / b) * 100);
}

function formatLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function trendIcon(curr: number, prev: number) {
  if (curr > prev) return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (curr < prev) return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

function trendText(curr: number, prev: number): string {
  if (!prev) return "—";
  const diff = curr - prev;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff} dari bulan lalu`;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchAnalytics(): Promise<AnalyticsData> {
  const token = localStorage.getItem("auth_token");
  const res = await fetch("/api/dashboard/analytics", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  title, value, prev, icon: Icon, color,
}: {
  title: string;
  value: number;
  prev: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-gray-500">{title}</p>
          <div className={`p-1.5 rounded-lg ${color}`}>
            <Icon className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <div className="flex items-center gap-1 mt-1">
          {trendIcon(value, prev)}
          <p className="text-xs text-gray-500">{trendText(value, prev)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ height = 200 }: { height?: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-gray-300 gap-2"
      style={{ height }}
    >
      <BarChart2 className="w-8 h-8" />
      <p className="text-xs">Belum ada data</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { data, isLoading, isFetching, refetch } = useQuery<AnalyticsData>({
    queryKey: ["dashboard-analytics"],
    queryFn: fetchAnalytics,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const thisMonth = num(data?.summary?.thisMonth?.new_tasks);
  const lastMonth = num(data?.summary?.lastMonth?.new_tasks);
  const thisCompleted = num(data?.summary?.thisMonth?.completed);
  const lastCompleted = num(data?.summary?.lastMonth?.completed);

  const monthlyTrend = (data?.monthlyTrend ?? []).map((d) => ({
    month: d.month,
    Total: num(d.total),
    Selesai: num(d.completed),
    Aktif: num(d.active),
  }));

  const messageTrend = (data?.messageTrend ?? []).map((d) => ({
    month: d.month,
    Masuk: num(d.total),
    Diproses: num(d.processed),
  }));

  const byCategory = (data?.byCategory ?? []).map((d) => ({
    name: d.name,
    value: num(d.value),
  }));

  const byDivision = (data?.byDivision ?? []).map((d) => ({
    name: d.name,
    value: num(d.value),
  }));

  const byStatus = (data?.byStatus ?? []).map((d) => ({
    name: formatLabel(d.name),
    value: num(d.value),
    fill: STATUS_COLORS[d.name] ?? "#9ca3af",
  }));

  const byPriority = (data?.byPriority ?? []).map((d) => ({
    name: formatLabel(d.name),
    value: num(d.value),
    fill: PRIORITY_COLORS[d.name] ?? "#9ca3af",
  }));

  const teamPerf = (data?.teamPerformance ?? []).map((d) => ({
    name: d.name,
    Total: num(d.total),
    Selesai: num(d.completed),
    "% Selesai": num(d.completion_rate),
  }));

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-5 pb-4 border-b bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              Analitik
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Laporan performa 6 bulan terakhir
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 px-4 sm:px-6 py-5 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-gray-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">Memuat analitik…</span>
          </div>
        ) : (
          <>
            {/* ── Ringkasan Bulan Ini ── */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Bulan Ini</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  title="Tugas Baru"
                  value={thisMonth}
                  prev={lastMonth}
                  icon={BarChart2}
                  color="bg-blue-500"
                />
                <StatCard
                  title="Tugas Selesai"
                  value={thisCompleted}
                  prev={lastCompleted}
                  icon={CheckCircle}
                  color="bg-green-500"
                />
                <StatCard
                  title="Tingkat Selesai"
                  value={pct(thisCompleted, thisMonth)}
                  prev={pct(lastCompleted, lastMonth)}
                  icon={TrendingUp}
                  color="bg-violet-500"
                />
                <StatCard
                  title="Pesan WA Bulan Ini"
                  value={num((messageTrend[messageTrend.length - 1] as { Masuk?: number } | undefined)?.Masuk)}
                  prev={num((messageTrend[messageTrend.length - 2] as { Masuk?: number } | undefined)?.Masuk)}
                  icon={MessageSquare}
                  color="bg-amber-500"
                />
              </div>
            </section>

            {/* ── Tren Bulanan ── */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    Tren Tugas Bulanan
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {monthlyTrend.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={monthlyTrend} barSize={14} barGap={2}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Total"   fill="#3b82f6" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="Selesai" fill="#10b981" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="Aktif"   fill="#f59e0b" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    Tren Pesan WhatsApp Masuk
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {messageTrend.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={messageTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="Masuk"    stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="Diproses" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* ── Distribusi Status & Prioritas ── */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    Distribusi Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {byStatus.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={byStatus} layout="vertical" barSize={14}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="value" name="Jumlah" radius={[0, 3, 3, 0]}>
                          {byStatus.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    Distribusi Prioritas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {byPriority.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width="60%" height={200}>
                        <PieChart>
                          <Pie
                            data={byPriority}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={3}
                            dataKey="value"
                          >
                            {byPriority.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-col gap-2">
                        {byPriority.map((p) => (
                          <div key={p.name} className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: p.fill }}
                            />
                            <span className="text-xs text-gray-600">{p.name}</span>
                            <Badge variant="secondary" className="text-xs ml-auto">{p.value}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* ── Distribusi Kategori & Divisi ── */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    Tugas per Kategori
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {byCategory.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={byCategory} barSize={16}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={45} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="value" name="Jumlah" radius={[3, 3, 0, 0]}>
                          {byCategory.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    Tugas per Divisi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {byDivision.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={byDivision} layout="vertical" barSize={14}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="value" name="Jumlah" radius={[0, 3, 3, 0]}>
                          {byDivision.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* ── Performa Tim ── */}
            <section>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    Performa Anggota Tim
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {teamPerf.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-300 gap-2">
                      <Users className="w-8 h-8" />
                      <p className="text-xs">Belum ada tugas yang diassign ke anggota tim</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Chart */}
                      <ResponsiveContainer width="100%" height={Math.max(180, teamPerf.length * 42)}>
                        <BarChart data={teamPerf} layout="vertical" barSize={12} barGap={2}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                          <Tooltip contentStyle={{ fontSize: 12 }} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Bar dataKey="Total"   fill="#3b82f6" radius={[0, 3, 3, 0]} />
                          <Bar dataKey="Selesai" fill="#10b981" radius={[0, 3, 3, 0]} />
                        </BarChart>
                      </ResponsiveContainer>

                      {/* Table */}
                      <div className="overflow-x-auto mt-4">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-gray-500">
                              <th className="text-left py-2 font-medium">Nama</th>
                              <th className="text-right py-2 font-medium">Total</th>
                              <th className="text-right py-2 font-medium">Selesai</th>
                              <th className="text-right py-2 font-medium">Aktif</th>
                              <th className="text-right py-2 font-medium">% Selesai</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(data?.teamPerformance ?? []).map((m) => (
                              <tr key={m.name} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="py-2 font-medium text-gray-800">{m.name}</td>
                                <td className="py-2 text-right text-gray-600">{m.total}</td>
                                <td className="py-2 text-right text-green-600 font-medium">{m.completed}</td>
                                <td className="py-2 text-right text-amber-600">{m.active}</td>
                                <td className="py-2 text-right">
                                  <span
                                    className={`inline-flex items-center justify-center w-10 h-5 rounded text-[11px] font-semibold
                                      ${num(m.completion_rate) >= 80
                                        ? "bg-green-100 text-green-700"
                                        : num(m.completion_rate) >= 50
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-red-100 text-red-700"
                                      }`}
                                  >
                                    {m.completion_rate}%
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
