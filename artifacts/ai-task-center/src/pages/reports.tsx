import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BarChart2, TrendingUp, CheckCircle, AlertTriangle, Users2, Brain, RefreshCw, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getStoredToken } from "@/lib/auth-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"];

function StatCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: number | string; sub?: string; color: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${color}`}><Icon className="h-5 w-5 text-white" /></div>
          <div><p className="text-2xl font-bold leading-none">{value}</p><p className="text-sm text-muted-foreground mt-1">{label}</p>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const today = new Date();
  const [from, setFrom] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [enabled, setEnabled] = useState(true);

  const params = `from=${from}&to=${to}`;

  const { data: overview, isLoading: ovLoading, refetch: refetchOv } = useQuery({ queryKey: ["report-overview", from, to], queryFn: () => apiFetch(`/reports/overview?${params}`), enabled });
  const { data: team, isLoading: teamLoading, refetch: refetchTeam } = useQuery({ queryKey: ["report-team", from, to], queryFn: () => apiFetch(`/reports/team?${params}`), enabled });
  const { data: ai, isLoading: aiLoading, refetch: refetchAi } = useQuery({ queryKey: ["report-ai", from, to], queryFn: () => apiFetch(`/reports/ai?${params}`), enabled });
  const { data: customers, refetch: refetchCust } = useQuery({ queryKey: ["report-customers", from, to], queryFn: () => apiFetch(`/reports/customers?${params}`), enabled });

  const refresh = () => { refetchOv(); refetchTeam(); refetchAi(); refetchCust(); };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><BarChart2 className="h-6 w-6 text-primary" />Laporan & Analitik</h1><p className="text-muted-foreground text-sm mt-1">Data operasional, team, dan AI</p></div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2"><Label className="text-sm">Dari:</Label><Input type="date" className="h-8 w-36 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="flex items-center gap-2"><Label className="text-sm">Sampai:</Label><Input type="date" className="h-8 w-36 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
        </div>
      </div>

      <Tabs defaultValue="operational">
        <TabsList><TabsTrigger value="operational">Operasional</TabsTrigger><TabsTrigger value="team">Team</TabsTrigger><TabsTrigger value="customers">Customer</TabsTrigger><TabsTrigger value="ai">AI</TabsTrigger></TabsList>

        {/* OPERATIONAL */}
        <TabsContent value="operational" className="space-y-6 mt-4">
          {ovLoading ? <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div> : overview && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={TrendingUp} label="Total Inquiry" value={overview.totalInquiry} color="bg-blue-500" />
                <StatCard icon={CheckCircle} label="Task Selesai" value={overview.completedTask} color="bg-green-500" />
                <StatCard icon={AlertTriangle} label="Task Overdue" value={overview.overdueTask} color="bg-red-500" />
                <StatCard icon={BarChart2} label="SLA Compliance" value={`${overview.slaCompliance}%`} color="bg-violet-500" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card><CardHeader><CardTitle className="text-base">Tren Bulanan</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={overview.monthlyTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
                        <Line type="monotone" dataKey="total" name="Total" stroke="#3b82f6" strokeWidth={2} />
                        <Line type="monotone" dataKey="completed" name="Selesai" stroke="#10b981" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card><CardHeader><CardTitle className="text-base">Per Kategori</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={overview.byCategory} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11 }} /><Tooltip />
                        <Bar dataKey="value" name="Jumlah" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card><CardHeader><CardTitle className="text-base">Per Status</CardTitle></CardHeader>
                  <CardContent className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart><Pie data={overview.byStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name">
                        {overview.byStatus.map((_: unknown, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie><Tooltip /><Legend /></PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card><CardHeader><CardTitle className="text-base">Per Prioritas</CardTitle></CardHeader>
                  <CardContent className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart><Pie data={overview.byPriority} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name">
                        {overview.byPriority.map((_: unknown, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie><Tooltip /><Legend /></PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* TEAM */}
        <TabsContent value="team" className="mt-4">
          {teamLoading ? <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div> : team && (
            <Card><CardHeader><CardTitle className="text-base">Performa Tim</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b"><th className="text-left py-2 font-medium">Nama</th><th className="text-right py-2 font-medium">Total</th><th className="text-right py-2 font-medium">Selesai</th><th className="text-right py-2 font-medium">Aktif</th><th className="text-right py-2 font-medium">Completion Rate</th></tr></thead>
                    <tbody>
                      {team.teamPerformance.map((m: { name: string; total: number; completed: number; active: number; completionRate: number }, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-2.5 font-medium">{m.name}</td>
                          <td className="py-2.5 text-right">{m.total}</td>
                          <td className="py-2.5 text-right text-green-600">{m.completed}</td>
                          <td className="py-2.5 text-right text-blue-600">{m.active}</td>
                          <td className="py-2.5 text-right"><Badge variant={m.completionRate >= 80 ? "default" : m.completionRate >= 50 ? "secondary" : "destructive"}>{m.completionRate}%</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* CUSTOMERS */}
        <TabsContent value="customers" className="mt-4">
          {customers && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard icon={Users2} label="Total Customer" value={customers.totalCustomers} color="bg-blue-500" />
              <StatCard icon={TrendingUp} label="Customer Baru" value={customers.newCustomers} sub="dalam periode ini" color="bg-green-500" />
              <StatCard icon={CheckCircle} label="Customer Repeat" value={customers.repeatCustomers} sub="lebih dari 1 task" color="bg-violet-500" />
            </div>
          )}
        </TabsContent>

        {/* AI */}
        <TabsContent value="ai" className="mt-4">
          {ai && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={Brain} label="Task Dibuat AI" value={ai.aiCreatedTasks} color="bg-violet-500" />
              <StatCard icon={BarChart2} label="AI Summary Generated" value={ai.aiSummaryGenerated} color="bg-blue-500" />
              <StatCard icon={TrendingUp} label="Follow-Up Terkirim" value={ai.aiFollowUpSent} color="bg-amber-500" />
              <StatCard icon={CheckCircle} label="Follow-Up Berhasil" value={ai.aiFollowUpSuccess} color="bg-green-500" />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
