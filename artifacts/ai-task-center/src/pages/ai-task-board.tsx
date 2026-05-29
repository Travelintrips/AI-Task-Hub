import { useState, useMemo } from "react";
import { getStoredToken } from "@/lib/auth-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import {
  Search,
  RefreshCw,
  Filter,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiTask {
  id: number;
  taskNumber: string | null;
  companyId: string | null;
  source?: string;
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

const STATUSES = [
  "New Inquiry",
  "Waiting Documents",
  "Ready for Review",
  "Assigned",
  "In Progress",
  "Completed",
] as const;

type TaskStatus = typeof STATUSES[number];

const STATUS_CONFIG: Record<TaskStatus, { dot: string; badge: string; cardBorder: string; cardText: string }> = {
  "New Inquiry":       { dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700",   cardBorder: "border-blue-200",   cardText: "text-blue-700"   },
  "Waiting Documents": { dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-700", cardBorder: "border-amber-200",  cardText: "text-amber-700"  },
  "Ready for Review":  { dot: "bg-violet-500", badge: "bg-violet-100 text-violet-700",cardBorder: "border-violet-200",cardText: "text-violet-700" },
  "Assigned":          { dot: "bg-indigo-500", badge: "bg-indigo-100 text-indigo-700",cardBorder: "border-indigo-200",cardText: "text-indigo-700" },
  "In Progress":       { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700",cardBorder: "border-orange-200",cardText: "text-orange-700" },
  "Completed":         { dot: "bg-green-500",  badge: "bg-green-100 text-green-700", cardBorder: "border-green-200",  cardText: "text-green-700"  },
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-100 text-red-700 border border-red-200",
  high:   "bg-red-100 text-red-700 border border-red-200",
  medium: "bg-amber-100 text-amber-700 border border-amber-200",
  low:    "bg-green-100 text-green-700 border border-green-200",
};

const CATEGORIES = [
  "Import", "Export", "Trucking", "Customs", "Warehouse",
  "Freight", "Product Sales", "Complaint", "Finance", "General Inquiry",
];

// ─── Status normalization ─────────────────────────────────────────────────────
// Memetakan nilai status lama (pending, in_progress, dll) ke label baru

function normalizeStatus(status: string): TaskStatus {
  if (STATUS_CONFIG[status as TaskStatus]) return status as TaskStatus;
  if (status === "pending" || status === "draft" || status === "new") return "New Inquiry";
  if (status === "waiting_documents" || status === "waiting_doc") return "Waiting Documents";
  if (status === "ready_for_review" || status === "review") return "Ready for Review";
  if (status === "assigned") return "Assigned";
  if (status === "in_progress" || status === "processing") return "In Progress";
  if (status === "completed" || status === "done" || status === "paid") return "Completed";
  if (status === "cancelled") return "Completed";
  return "New Inquiry";
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers as Record<string, string> | undefined ?? {}),
    },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

async function fetchAiTasks(params?: {
  category?: string;
  priority?: string;
  search?: string;
}): Promise<AiTask[]> {
  const qs = new URLSearchParams();
  if (params?.category && params.category !== "all") qs.set("category", params.category);
  if (params?.priority && params.priority !== "all") qs.set("priority", params.priority);
  if (params?.search) qs.set("search", params.search);
  return apiFetch<AiTask[]>(`/api/ai-tasks${qs.toString() ? `?${qs}` : ""}`);
}

// ─── Status summary cards ─────────────────────────────────────────────────────

function StatusCards({
  tasks,
  activeFilter,
  onFilter,
}: {
  tasks: AiTask[];
  activeFilter: string;
  onFilter: (s: string) => void;
}) {
  const counts = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const t of tasks) map[normalizeStatus(t.status)]++;
    return map;
  }, [tasks]);

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {STATUSES.map((s) => {
        const cfg = STATUS_CONFIG[s];
        const active = activeFilter === s;
        return (
          <button
            key={s}
            onClick={() => onFilter(active ? "all" : s)}
            className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all
              ${active
                ? `${cfg.cardBorder} bg-white shadow-sm ring-2 ring-offset-1 ring-current ${cfg.cardText}`
                : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
              }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
              <span className={`text-[11px] font-medium truncate ${active ? cfg.cardText : "text-gray-500"}`}>
                {s}
              </span>
            </div>
            <span className={`text-xl font-bold tabular-nums ${active ? cfg.cardText : "text-gray-800"}`}>
              {counts[s]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────

function TaskRow({ task }: { task: AiTask }) {
  const normalized = normalizeStatus(task.status);
  const cfg = STATUS_CONFIG[normalized];
  const age = formatDistanceToNow(new Date(task.createdAt), { addSuffix: true });

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      {/* No. Task */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <Link href={`/ai-tasks/${task.id}`}>
          <span className="text-sm font-mono text-blue-600 hover:underline cursor-pointer">
            {task.taskNumber ?? `#${task.id}`}
          </span>
        </Link>
        <div className="text-[11px] text-gray-400">{age}</div>
      </td>

      {/* Pelanggan */}
      <td className="px-3 py-2.5">
        <div className="text-sm font-medium text-gray-800 truncate max-w-[120px]">
          {task.customerName ?? "—"}
        </div>
        {task.customerPhone && (
          <div className="text-[11px] text-gray-400">{task.customerPhone}</div>
        )}
      </td>

      {/* Judul */}
      <td className="px-3 py-2.5 max-w-[180px]">
        <Link href={`/ai-tasks/${task.id}`}>
          <span className="text-sm text-blue-700 hover:underline cursor-pointer line-clamp-2 leading-snug">
            {task.title}
          </span>
        </Link>
      </td>

      {/* Status */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {normalized}
        </span>
      </td>

      {/* Prioritas */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold capitalize ${PRIORITY_BADGE[task.priority] ?? "bg-gray-100 text-gray-700"}`}>
          {task.priority}
        </span>
      </td>

      {/* Kategori */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-xs text-gray-600">{task.category ?? "—"}</span>
      </td>

      {/* Divisi */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-xs text-gray-600">{task.division ?? "—"}</span>
      </td>

      {/* AI Intent */}
      <td className="px-3 py-2.5">
        <span className="text-xs text-gray-500 line-clamp-1">
          {task.aiIntent ?? "—"}
        </span>
      </td>

      {/* Audit */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        {task.auditStatus ? (
          <span className="text-xs text-gray-600">{task.auditStatus}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>

      {/* Pesan Terakhir */}
      <td className="px-3 py-2.5 max-w-[140px]">
        <span className="text-xs text-gray-500 line-clamp-1">
          {task.latestMessage ?? "—"}
        </span>
      </td>

      {/* Assignee */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        {task.assignedTo ? (
          <span className="text-xs font-medium text-gray-700">{task.assignedTo}</span>
        ) : (
          <span className="text-xs text-gray-300 italic">Belum</span>
        )}
      </td>
    </tr>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-gray-100">
          {Array.from({ length: 11 }).map((__, j) => (
            <td key={j} className="px-3 py-2.5">
              <Skeleton className="h-4 w-full rounded" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AiTaskBoard() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const queryClient = useQueryClient();

  const queryKey = ["ai-tasks", categoryFilter, priorityFilter];

  const { data: allTasks = [], isLoading, isFetching, refetch } = useQuery<AiTask[]>({
    queryKey,
    queryFn: () => fetchAiTasks({ category: categoryFilter, priority: priorityFilter }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Client-side filter: search + status
  const filtered = useMemo(() => {
    let result = allTasks;

    if (statusFilter !== "all") {
      result = result.filter((t) => normalizeStatus(t.status) === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (t.customerPhone ?? "").toLowerCase().includes(q) ||
          (t.taskNumber ?? "").toLowerCase().includes(q),
      );
    }

    return result;
  }, [allTasks, search, statusFilter]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b bg-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">AI Task Center</h1>
            <p className="text-sm text-gray-500 mt-0.5">{allTasks.length} task</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Status summary cards */}
        <div className="mb-4">
          <StatusCards
            tasks={allTasks}
            activeFilter={statusFilter}
            onFilter={setStatusFilter}
          />
        </div>

        {/* Search + Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              placeholder="Cari nama atau nomor HP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm">
                <Filter className="w-3.5 h-3.5" />
                Filter
                <ChevronDown className="w-3 h-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-2 space-y-2">
              <div>
                <p className="text-[11px] text-gray-500 font-medium mb-1 px-1">Kategori</p>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Semua Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-[11px] text-gray-500 font-medium mb-1 px-1">Prioritas</p>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Semua Prioritas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Prioritas</SelectItem>
                    <SelectItem value="high">🔴 High</SelectItem>
                    <SelectItem value="medium">🟡 Medium</SelectItem>
                    <SelectItem value="low">🟢 Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
            <tr>
              {[
                "No. Task", "Pelanggan", "Judul", "Status", "Prioritas",
                "Kategori", "Divisi", "AI Intent", "Audit", "Pesan Terakhir", "Assignee",
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          {isLoading ? (
            <TableSkeleton />
          ) : filtered.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={11} className="px-3 py-16 text-center text-sm text-gray-400">
                  {search || statusFilter !== "all"
                    ? "Tidak ada task yang sesuai filter."
                    : "Belum ada task."}
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {filtered.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
