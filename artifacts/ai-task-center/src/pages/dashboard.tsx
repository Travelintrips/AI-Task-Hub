import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import {
  Search, RefreshCw, MessageSquare, AlertCircle, Clock,
  ChevronDown, Filter, X, Brain, ShieldCheck, Phone,
  Building2, Users, Layers, Tag,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiTask {
  id: number;
  taskNumber: string | null;
  companyId: string;
  source: string;
  customerName: string | null;
  customerPhone: string | null;
  title: string;
  description: string | null;
  category: string | null;
  division: string | null;
  priority: string;
  status: string;
  assignedTo: string | null;
  assignedRole: string | null;
  aiSummary: string | null;
  aiIntent: string | null;
  auditStatus: string | null;
  latestMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUMMARY_STATUSES = [
  "New Inquiry",
  "Waiting Documents",
  "Ready for Review",
  "Assigned",
  "In Progress",
  "Completed",
] as const;

const ALL_STATUSES = [
  "New Inquiry",
  "Waiting Documents",
  "Ready for Review",
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Completed",
] as const;

const STATUS_CONFIG: Record<string, { dot: string; badge: string; card: string; cardText: string }> = {
  "New Inquiry":       { dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700 border-blue-200",    card: "bg-blue-50 border-blue-200",    cardText: "text-blue-700" },
  "Waiting Documents": { dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-700 border-amber-200", card: "bg-amber-50 border-amber-200",  cardText: "text-amber-700" },
  "Ready for Review":  { dot: "bg-violet-500", badge: "bg-violet-100 text-violet-700 border-violet-200", card: "bg-violet-50 border-violet-200", cardText: "text-violet-700" },
  "Assigned":          { dot: "bg-indigo-500", badge: "bg-indigo-100 text-indigo-700 border-indigo-200", card: "bg-indigo-50 border-indigo-200", cardText: "text-indigo-700" },
  "In Progress":       { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700 border-orange-200", card: "bg-orange-50 border-orange-200", cardText: "text-orange-700" },
  "Waiting Customer":  { dot: "bg-teal-500",   badge: "bg-teal-100 text-teal-700 border-teal-200",    card: "bg-teal-50 border-teal-200",    cardText: "text-teal-700" },
  "Completed":         { dot: "bg-green-500",  badge: "bg-green-100 text-green-700 border-green-200", card: "bg-green-50 border-green-200",  cardText: "text-green-700" },
};

const PRIORITY_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  high:   { label: "High",   dot: "bg-red-500",   badge: "bg-red-100 text-red-700 border-red-200" },
  medium: { label: "Medium", dot: "bg-amber-400", badge: "bg-amber-100 text-amber-700 border-amber-200" },
  low:    { label: "Low",    dot: "bg-green-500", badge: "bg-green-100 text-green-700 border-green-200" },
};

const AUDIT_CONFIG: Record<string, { label: string; badge: string }> = {
  passed:     { label: "Passed",     badge: "bg-green-100 text-green-700 border-green-200" },
  incomplete: { label: "Incomplete", badge: "bg-amber-100 text-amber-700 border-amber-200" },
  failed:     { label: "Failed",     badge: "bg-red-100 text-red-700 border-red-200" },
  pending:    { label: "Pending",    badge: "bg-gray-100 text-gray-600 border-gray-200" },
};

const CATEGORIES = [
  "Import", "Export", "Trucking", "Customs", "Warehouse",
  "Freight", "Product Sales", "Complaint", "Finance", "General Inquiry",
];

const DIVISIONS = [
  "Import", "Export", "Trucking", "Customs Clearance",
  "Warehouse", "Finance", "Customer Service", "Operations",
];

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchAiTasks(params: Record<string, string>): Promise<AiTask[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v !== "all") qs.set(k, v);
  }
  const res = await fetch(`/api/ai-tasks${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function patchAiTask(id: number, updates: Partial<Pick<AiTask, "status" | "priority" | "assignedTo">>): Promise<AiTask> {
  const res = await fetch(`/api/ai-tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  status, count, active, onClick,
}: { status: string; count: number; active: boolean; onClick: () => void }) {
  const cfg = STATUS_CONFIG[status] ?? { card: "bg-gray-50 border-gray-200", cardText: "text-gray-700", dot: "bg-gray-400" };

  return (
    <button
      onClick={onClick}
      className={`rounded-xl border-2 p-4 text-left transition-all hover:shadow-md w-full
        ${active ? `${cfg.card} border-opacity-100 shadow-md ring-2 ring-offset-1` : "bg-white border-gray-200 hover:border-gray-300"}
      `}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className={`text-xs font-semibold truncate ${active ? cfg.cardText : "text-gray-600"}`}>
          {status}
        </span>
      </div>
      <div className={`text-3xl font-bold ${active ? cfg.cardText : "text-gray-900"}`}>
        {count}
      </div>
    </button>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { dot: "bg-gray-400", badge: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority];
  if (!cfg) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function AuditBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-300">—</span>;
  const cfg = AUDIT_CONFIG[status.toLowerCase()] ?? AUDIT_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${cfg.badge}`}>
      <ShieldCheck className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Active Filter Pills ──────────────────────────────────────────────────────

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium border border-blue-200">
      {label}
      <button onClick={onRemove} className="hover:bg-blue-200 rounded-full p-0.5">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

// ─── Table Skeleton ───────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded" />
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [assignedFilter, setAssignedFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const queryParams = {
    status: statusFilter,
    category: categoryFilter,
    division: divisionFilter,
    priority: priorityFilter,
    companyId: companyFilter,
    assignedTo: assignedFilter,
  };

  const queryKey = ["ai-tasks-dashboard", queryParams];

  const { data: tasks = [], isLoading, isFetching, refetch } = useQuery<AiTask[]>({
    queryKey,
    queryFn: () => fetchAiTasks(queryParams),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => patchAiTask(id, { status }),
    onSuccess: (updated) => {
      queryClient.setQueryData<AiTask[]>(queryKey, (prev = []) =>
        prev.map((t) => (t.id === updated.id ? { ...t, status: updated.status } : t)),
      );
      toast({ title: `Status diubah ke "${updated.status}"` });
    },
    onError: () => toast({ title: "Gagal memperbarui status", variant: "destructive" }),
  });

  // Client-side search (name or phone)
  const filtered = useMemo(() => {
    if (!search.trim()) return tasks;
    const q = search.toLowerCase().trim();
    return tasks.filter(
      (t) =>
        (t.customerName ?? "").toLowerCase().includes(q) ||
        (t.customerPhone ?? "").toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q),
    );
  }, [tasks, search]);

  // Summary counts (from all server-filtered tasks, not client search)
  const summaryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of SUMMARY_STATUSES) map[s] = 0;
    for (const t of tasks) {
      if (t.status in map) map[t.status]++;
    }
    return map;
  }, [tasks]);

  // Unique values for dynamic filter options
  const companies = useMemo(() => [...new Set(tasks.map((t) => t.companyId).filter(Boolean))], [tasks]);
  const assignees = useMemo(() => [...new Set(tasks.map((t) => t.assignedTo).filter(Boolean))], [tasks]);

  // Active filter pills
  const activeFilters: { label: string; clear: () => void }[] = [];
  if (statusFilter !== "all")   activeFilters.push({ label: `Status: ${statusFilter}`,     clear: () => setStatusFilter("all") });
  if (categoryFilter !== "all") activeFilters.push({ label: `Kategori: ${categoryFilter}`, clear: () => setCategoryFilter("all") });
  if (divisionFilter !== "all") activeFilters.push({ label: `Divisi: ${divisionFilter}`,   clear: () => setDivisionFilter("all") });
  if (priorityFilter !== "all") activeFilters.push({ label: `Prioritas: ${priorityFilter}`, clear: () => setPriorityFilter("all") });
  if (companyFilter !== "all")  activeFilters.push({ label: `Perusahaan: ${companyFilter}`, clear: () => setCompanyFilter("all") });
  if (assignedFilter !== "all") activeFilters.push({ label: `Assignee: ${assignedFilter}`,  clear: () => setAssignedFilter("all") });

  const clearAll = () => {
    setStatusFilter("all"); setCategoryFilter("all"); setDivisionFilter("all");
    setPriorityFilter("all"); setCompanyFilter("all"); setAssignedFilter("all");
    setSearch("");
  };

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-5 pb-3 border-b bg-white">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              AI Task Center
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {filtered.length} task
              {isFetching && !isLoading && (
                <span className="ml-2 text-blue-500 text-xs">● memperbarui…</span>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 flex-shrink-0">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {/* ── Summary Cards ── */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            {SUMMARY_STATUSES.map((s) => <Skeleton key={s} className="h-20 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            {SUMMARY_STATUSES.map((s) => (
              <SummaryCard
                key={s}
                status={s}
                count={summaryCounts[s] ?? 0}
                active={statusFilter === s}
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              />
            ))}
          </div>
        )}

        {/* ── Search + Filter Toggle ── */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-44">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              placeholder="Cari nama atau nomor HP…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-1.5 h-8"
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
            {activeFilters.length > 0 && (
              <span className="ml-0.5 bg-white text-blue-700 rounded-full text-[10px] font-bold w-4 h-4 flex items-center justify-center">
                {activeFilters.length}
              </span>
            )}
          </Button>
        </div>

        {/* ── Expanded Filters ── */}
        {showFilters && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {/* Status */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs gap-1">
                <Layers className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Category */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 text-xs gap-1">
                <Tag className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <SelectValue placeholder="Kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kategori</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Division */}
            <Select value={divisionFilter} onValueChange={setDivisionFilter}>
              <SelectTrigger className="h-8 text-xs gap-1">
                <Layers className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <SelectValue placeholder="Divisi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Divisi</SelectItem>
                {DIVISIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Priority */}
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 text-xs gap-1">
                <AlertCircle className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <SelectValue placeholder="Prioritas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Prioritas</SelectItem>
                <SelectItem value="high">🔴 High</SelectItem>
                <SelectItem value="medium">🟡 Medium</SelectItem>
                <SelectItem value="low">🟢 Low</SelectItem>
              </SelectContent>
            </Select>

            {/* Company */}
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="h-8 text-xs gap-1">
                <Building2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <SelectValue placeholder="Perusahaan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Perusahaan</SelectItem>
                {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Assigned Team */}
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger className="h-8 text-xs gap-1">
                <Users className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tim</SelectItem>
                {assignees.map((a) => <SelectItem key={a!} value={a!}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* ── Active Filter Pills ── */}
        {activeFilters.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 items-center">
            {activeFilters.map((f) => (
              <FilterPill key={f.label} label={f.label} onRemove={f.clear} />
            ))}
            <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-600 ml-1">
              Hapus semua
            </button>
          </div>
        )}
      </div>

      {/* ── Task Table ── */}
      <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
            <Search className="w-10 h-10 opacity-30" />
            <p className="text-sm font-medium">Tidak ada task yang cocok</p>
            {(search || activeFilters.length > 0) && (
              <Button variant="ghost" size="sm" onClick={clearAll}>Hapus filter</Button>
            )}
          </div>
        ) : (
          <>
            {/* ── Desktop Table ── */}
            <div className="hidden md:block rounded-lg border border-gray-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="text-xs font-semibold text-gray-500 w-28">No. Task</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500">Pelanggan</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500">Judul</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 w-32">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 w-24">Prioritas</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 w-24">Kategori</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 w-24">Divisi</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 w-32">AI Intent</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 w-24">Audit</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500">Pesan Terakhir</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 w-28">Assignee</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((task) => (
                    <TaskRow key={task.id} task={task} onStatusChange={(s) => updateMutation.mutate({ id: task.id, status: s })} />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* ── Mobile Cards ── */}
            <div className="md:hidden space-y-3">
              {filtered.map((task) => (
                <MobileTaskCard key={task.id} task={task} onStatusChange={(s) => updateMutation.mutate({ id: task.id, status: s })} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Desktop Table Row ────────────────────────────────────────────────────────

function TaskRow({ task, onStatusChange }: { task: AiTask; onStatusChange: (s: string) => void }) {
  const age = formatDistanceToNow(new Date(task.createdAt), { addSuffix: true });

  return (
    <TableRow className="hover:bg-gray-50 group">
      {/* Task number */}
      <TableCell className="py-2.5">
        <Link href={`/ai-tasks/${task.id}`}>
          <span className="font-mono text-xs text-blue-600 hover:underline cursor-pointer">
            {task.taskNumber ?? `#${task.id}`}
          </span>
        </Link>
        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400">
          <Clock className="w-3 h-3" />{age}
        </div>
      </TableCell>

      {/* Customer */}
      <TableCell className="py-2.5">
        <div className="text-sm font-medium text-gray-900 truncate max-w-[120px]">
          {task.customerName ?? <span className="text-gray-400 italic">—</span>}
        </div>
        {task.customerPhone && (
          <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
            <Phone className="w-3 h-3" />
            {task.customerPhone}
          </div>
        )}
      </TableCell>

      {/* Title */}
      <TableCell className="py-2.5 max-w-[200px]">
        <Link href={`/ai-tasks/${task.id}`}>
          <p className="text-sm font-medium text-gray-900 hover:text-blue-600 cursor-pointer line-clamp-2 leading-snug">
            {task.title}
          </p>
        </Link>
      </TableCell>

      {/* Status */}
      <TableCell className="py-2.5">
        <StatusBadge status={task.status} />
      </TableCell>

      {/* Priority */}
      <TableCell className="py-2.5">
        <PriorityBadge priority={task.priority} />
      </TableCell>

      {/* Category */}
      <TableCell className="py-2.5">
        {task.category ? (
          <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded font-medium">
            {task.category}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </TableCell>

      {/* Division */}
      <TableCell className="py-2.5">
        {task.division ? (
          <span className="text-xs text-gray-600">{task.division}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </TableCell>

      {/* AI Intent */}
      <TableCell className="py-2.5 max-w-[120px]">
        {task.aiIntent ? (
          <div className="flex items-start gap-1">
            <Brain className="w-3 h-3 text-purple-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-purple-700 line-clamp-2 leading-snug">{task.aiIntent}</span>
          </div>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </TableCell>

      {/* Audit */}
      <TableCell className="py-2.5">
        <AuditBadge status={task.auditStatus} />
      </TableCell>

      {/* Latest Message */}
      <TableCell className="py-2.5 max-w-[180px]">
        {task.latestMessage ? (
          <div className="flex items-start gap-1">
            <MessageSquare className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-gray-600 line-clamp-2 leading-snug">{task.latestMessage}</span>
          </div>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </TableCell>

      {/* Assignee */}
      <TableCell className="py-2.5">
        {task.assignedTo ? (
          <span className="text-xs text-gray-700 font-medium truncate block max-w-[100px]">{task.assignedTo}</span>
        ) : (
          <span className="text-xs text-gray-300 italic">Belum</span>
        )}
        {task.assignedRole && (
          <span className="text-[10px] text-gray-400 block">{task.assignedRole}</span>
        )}
      </TableCell>

      {/* Actions */}
      <TableCell className="py-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronDown className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {ALL_STATUSES.filter((s) => s !== task.status).map((s) => {
              const cfg = STATUS_CONFIG[s];
              return (
                <DropdownMenuItem key={s} onClick={() => onStatusChange(s)} className="text-xs gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg?.dot ?? "bg-gray-400"}`} />
                  {s}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

// ─── Mobile Card ──────────────────────────────────────────────────────────────

function MobileTaskCard({ task, onStatusChange }: { task: AiTask; onStatusChange: (s: string) => void }) {
  const age = formatDistanceToNow(new Date(task.createdAt), { addSuffix: true });

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/ai-tasks/${task.id}`}>
              <span className="font-mono text-xs text-blue-600 hover:underline">
                {task.taskNumber ?? `#${task.id}`}
              </span>
            </Link>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1 flex-shrink-0">
                Pindah <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {ALL_STATUSES.filter((s) => s !== task.status).map((s) => {
                const cfg = STATUS_CONFIG[s];
                return (
                  <DropdownMenuItem key={s} onClick={() => onStatusChange(s)} className="text-xs gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg?.dot ?? "bg-gray-400"}`} />
                    {s}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Title */}
        <Link href={`/ai-tasks/${task.id}`}>
          <p className="text-sm font-semibold text-gray-900 hover:text-blue-600 mb-1 line-clamp-2">
            {task.title}
          </p>
        </Link>

        {/* Customer */}
        {(task.customerName || task.customerPhone) && (
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
            <Phone className="w-3 h-3 flex-shrink-0" />
            <span>{task.customerName ?? ""}</span>
            {task.customerPhone && <span className="text-gray-400">{task.customerPhone}</span>}
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-2">
          {task.category && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{task.category}</span>}
          {task.division && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{task.division}</span>}
          {task.assignedTo && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />{task.assignedTo}
            </span>
          )}
          <span className="flex items-center gap-1 text-gray-400">
            <Clock className="w-3 h-3" />{age}
          </span>
        </div>

        {/* AI Intent */}
        {task.aiIntent && (
          <div className="flex items-start gap-1 bg-purple-50 rounded px-2 py-1 mb-2">
            <Brain className="w-3 h-3 text-purple-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-purple-700 line-clamp-2">{task.aiIntent}</span>
          </div>
        )}

        {/* Latest message */}
        {task.latestMessage && (
          <div className="flex items-start gap-1 bg-green-50 rounded px-2 py-1 mb-2">
            <MessageSquare className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-gray-600 line-clamp-2">{task.latestMessage}</span>
          </div>
        )}

        {/* Audit */}
        <div className="flex items-center gap-1">
          <AuditBadge status={task.auditStatus} />
        </div>
      </CardContent>
    </Card>
  );
}
