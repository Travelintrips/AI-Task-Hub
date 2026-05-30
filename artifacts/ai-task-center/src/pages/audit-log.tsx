import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Search, Filter, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getStoredToken } from "@/lib/auth-api";
import { format } from "date-fns";
import { id } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

interface AuditLog {
  id: number;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  module: string;
  entityId: number | null;
  entityType: string | null;
  before: string | null;
  after: string | null;
  ipAddress: string | null;
  createdAt: string;
}

const MODULE_COLORS: Record<string, string> = {
  tasks: "bg-blue-100 text-blue-700",
  ai_tasks: "bg-violet-100 text-violet-700",
  documents: "bg-amber-100 text-amber-700",
  users: "bg-red-100 text-red-700",
  team: "bg-green-100 text-green-700",
  quotations: "bg-indigo-100 text-indigo-700",
  customers: "bg-teal-100 text-teal-700",
  settings: "bg-orange-100 text-orange-700",
};

const ACTION_COLORS: Record<string, string> = {
  create: "text-green-600",
  update: "text-blue-600",
  delete: "text-red-600",
  login: "text-indigo-600",
  logout: "text-gray-600",
};

export default function AuditLogPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(today);

  const params = new URLSearchParams({ limit: "200", ...(moduleFilter !== "all" ? { module: moduleFilter } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });

  const { data: logs = [], isLoading, refetch } = useQuery<AuditLog[]>({
    queryKey: ["audit-logs", moduleFilter, from, to],
    queryFn: () => apiFetch(`/audit-logs?${params}`),
  });

  const filtered = search
    ? logs.filter((l) => l.action.toLowerCase().includes(search.toLowerCase()) || (l.userName ?? "").toLowerCase().includes(search.toLowerCase()) || (l.module ?? "").toLowerCase().includes(search.toLowerCase()))
    : logs;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-primary" />Audit Log</h1>
          <p className="text-muted-foreground text-sm mt-1">Riwayat seluruh aktivitas sistem</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
      </div>

      <div className="flex gap-3 flex-wrap items-end">
        <div className="relative flex-1 min-w-[180px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Cari aksi, user, modul..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div><Label className="text-xs">Modul</Label><Select value={moduleFilter} onValueChange={setModuleFilter}><SelectTrigger className="w-36 mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem>{Object.keys(MODULE_COLORS).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Dari</Label><Input type="date" className="mt-1 h-9 w-36 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">Sampai</Label><Input type="date" className="mt-1 h-9 w-36 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <div className="text-sm text-muted-foreground">{filtered.length} entri ditemukan</div>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground"><ShieldCheck className="h-12 w-12 mx-auto mb-3 opacity-30" /><p>Tidak ada log yang ditemukan</p></CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Waktu</th>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Modul</th>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Aksi</th>
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide">Detail</th>
              </tr></thead>
              <tbody className="divide-y">
                {filtered.map((log) => {
                  const actionBase = log.action.split("_")[0];
                  const actionColor = ACTION_COLORS[actionBase] ?? "text-foreground";
                  const moduleCls = MODULE_COLORS[log.module] ?? "bg-gray-100 text-gray-700";
                  return (
                    <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{format(new Date(log.createdAt), "dd/MM/yy HH:mm:ss", { locale: id })}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-xs">{log.userName ?? "System"}</p>
                        {log.userEmail && <p className="text-xs text-muted-foreground">{log.userEmail}</p>}
                      </td>
                      <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${moduleCls}`}>{log.module}</span></td>
                      <td className="px-4 py-2.5"><span className={`font-mono text-xs font-medium ${actionColor}`}>{log.action}</span></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[280px]">
                        {log.entityType && <span>{log.entityType} #{log.entityId}</span>}
                        {log.ipAddress && <span className="ml-2 font-mono text-xs opacity-60">{log.ipAddress}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
