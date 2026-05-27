import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { Search, RefreshCw, MessageSquare, FileSearch, AlertCircle, Clock, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
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
  "Waiting Customer",
  "Completed",
] as const;

type TaskStatus = typeof STATUSES[number];

const STATUS_CONFIG: Record<TaskStatus, { color: string; headerBg: string; dot: string; badge: string }> = {
  "New Inquiry":        { color: "text-blue-700",   headerBg: "bg-blue-50 border-blue-200",   dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700 border-blue-200" },
  "Waiting Documents":  { color: "text-amber-700",  headerBg: "bg-amber-50 border-amber-200", dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-700 border-amber-200" },
  "Ready for Review":   { color: "text-violet-700", headerBg: "bg-violet-50 border-violet-200",dot:"bg-violet-500", badge: "bg-violet-100 text-violet-700 border-violet-200" },
  "Assigned":           { color: "text-indigo-700", headerBg: "bg-indigo-50 border-indigo-200",dot:"bg-indigo-500", badge: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  "In Progress":        { color: "text-orange-700", headerBg: "bg-orange-50 border-orange-200",dot:"bg-orange-500", badge: "bg-orange-100 text-orange-700 border-orange-200" },
  "Waiting Customer":   { color: "text-teal-700",   headerBg: "bg-teal-50 border-teal-200",   dot: "bg-teal-500",   badge: "bg-teal-100 text-teal-700 border-teal-200" },
  "Completed":          { color: "text-green-700",  headerBg: "bg-green-50 border-green-200", dot: "bg-green-500",  badge: "bg-green-100 text-green-700 border-green-200" },
};

const CATEGORY_COLORS: Record<string, string> = {
  "Import":          "bg-blue-100 text-blue-800",
  "Export":          "bg-emerald-100 text-emerald-800",
  "Trucking":        "bg-orange-100 text-orange-800",
  "Customs":         "bg-purple-100 text-purple-800",
  "Warehouse":       "bg-yellow-100 text-yellow-800",
  "Freight":         "bg-sky-100 text-sky-800",
  "Product Sales":   "bg-pink-100 text-pink-800",
  "Complaint":       "bg-red-100 text-red-800",
  "Finance":         "bg-indigo-100 text-indigo-800",
  "General Inquiry": "bg-gray-100 text-gray-700",
};

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-red-500",
  medium: "bg-amber-400",
  low:    "bg-green-500",
};

const CATEGORIES = [
  "Import", "Export", "Trucking", "Customs", "Warehouse",
  "Freight", "Product Sales", "Complaint", "Finance", "General Inquiry",
];

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

async function fetchAiTasks(params?: { category?: string; priority?: string; search?: string }): Promise<AiTask[]> {
  const qs = new URLSearchParams();
  if (params?.category && params.category !== "all") qs.set("category", params.category);
  if (params?.priority && params.priority !== "all") qs.set("priority", params.priority);
  if (params?.search) qs.set("search", params.search);
  const url = `/api/ai-tasks${qs.toString() ? `?${qs}` : ""}`;
  return apiFetch<AiTask[]>(url);
}

async function patchAiTask(id: number, updates: Partial<Pick<AiTask, "status" | "priority" | "assignedTo">>): Promise<AiTask> {
  return apiFetch<AiTask>(`/api/ai-tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
    headers: { "content-type": "application/json" },
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriorityDot({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[priority] ?? "bg-gray-400"}`}
      title={`Priority: ${priority}`}
    />
  );
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  const cls = CATEGORY_COLORS[category] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {category}
    </span>
  );
}

function TaskCard({ task, onStatusChange }: { task: AiTask; onStatusChange: (id: number, status: string) => void }) {
  const age = formatDistanceToNow(new Date(task.createdAt), { addSuffix: true });
  const summaryLines = task.aiSummary?.split("\n").filter(Boolean).slice(0, 2).join(" • ") ?? "";

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow group">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <PriorityDot priority={task.priority} />
          <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">
            {task.taskNumber ?? `#${task.id}`}
          </span>
        </div>
        <CategoryBadge category={task.category} />
      </div>

      {/* Title */}
      <Link href={`/ai-tasks/${task.id}`}>
        <p className="text-sm font-semibold text-gray-900 leading-snug mb-1 hover:text-blue-600 cursor-pointer line-clamp-2">
          {task.title}
        </p>
      </Link>

      {/* Customer */}
      {task.customerName && (
        <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
          <MessageSquare className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{task.customerName}</span>
          {task.customerPhone && (
            <span className="text-gray-400 truncate">{task.customerPhone}</span>
          )}
        </p>
      )}

      {/* AI summary snippet */}
      {summaryLines && (
        <p className="text-[11px] text-gray-400 leading-snug mb-2 line-clamp-2 bg-gray-50 rounded px-2 py-1">
          {summaryLines}
        </p>
      )}

      {/* Flags */}
      <div className="flex flex-wrap gap-1 mb-2">
        {task.assignedRole && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
            {task.assignedRole}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <span className="flex items-center gap-1 text-[10px] text-gray-400">
          <Clock className="w-3 h-3" />
          {age}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-gray-500 hover:text-gray-800 gap-1">
              Move
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {STATUSES.filter((s) => s !== task.status).map((s) => {
              const cfg = STATUS_CONFIG[s];
              return (
                <DropdownMenuItem
                  key={s}
                  onClick={() => onStatusChange(task.id, s)}
                  className="text-xs gap-2"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  {s}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function KanbanColumn({
  status,
  tasks,
  onStatusChange,
}: {
  status: TaskStatus;
  tasks: AiTask[];
  onStatusChange: (id: number, status: string) => void;
}) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex flex-col flex-shrink-0 w-72">
      {/* Column header */}
      <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-lg border ${cfg.headerBg} mb-0`}>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
          <span className={`text-xs font-semibold ${cfg.color}`}>{status}</span>
        </div>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full border ${cfg.badge}`}>
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 bg-gray-50 rounded-b-lg border border-t-0 border-gray-200 p-2 space-y-2 min-h-[120px] max-h-[calc(100vh-220px)] overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-xs text-gray-400 italic">
            No tasks
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard key={task.id} task={task} onStatusChange={onStatusChange} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function KanbanSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUSES.map((s) => (
        <div key={s} className="flex-shrink-0 w-72">
          <Skeleton className="h-10 w-full rounded-t-lg mb-0" />
          <div className="bg-gray-50 rounded-b-lg border border-t-0 p-2 space-y-2 min-h-[120px]">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AiTaskBoard() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const queryKey = ["ai-tasks", categoryFilter, priorityFilter];

  const { data: tasks = [], isLoading, isFetching, refetch } = useQuery<AiTask[]>({
    queryKey,
    queryFn: () => fetchAiTasks({ category: categoryFilter, priority: priorityFilter }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      patchAiTask(id, { status }),
    onSuccess: (updated) => {
      queryClient.setQueryData<AiTask[]>(queryKey, (prev = []) =>
        prev.map((t) => (t.id === updated.id ? updated : t)),
      );
      toast({ title: `Moved to "${updated.status}"` });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return tasks;
    const q = search.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.customerName ?? "").toLowerCase().includes(q) ||
        (t.taskNumber ?? "").toLowerCase().includes(q),
    );
  }, [tasks, search]);

  // Group by status
  const grouped = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map((s) => [s, [] as AiTask[]])) as Record<TaskStatus, AiTask[]>;
    for (const task of filtered) {
      const s = task.status as TaskStatus;
      if (map[s]) map[s].push(task);
      else map["New Inquiry"].push(task); // fallback for legacy statuses
    }
    return map;
  }, [filtered]);

  const totalOpen = tasks.filter((t) => t.status !== "Completed").length;
  const totalHigh = tasks.filter((t) => t.priority === "high").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b bg-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">AI Task Board</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalOpen} open tasks
              {totalHigh > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-red-600 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {totalHigh} high priority
                </span>
              )}
            </p>
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

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48 max-w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="high">🔴 High</SelectItem>
              <SelectItem value="medium">🟡 Medium</SelectItem>
              <SelectItem value="low">🟢 Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-4">
        {isLoading ? (
          <KanbanSkeleton />
        ) : filtered.length === 0 && search ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
            <FileSearch className="w-10 h-10" />
            <p className="text-sm">No tasks match "{search}"</p>
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>Clear search</Button>
          </div>
        ) : (
          <div className="flex gap-4 pb-4 h-full">
            {STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={grouped[status]}
                onStatusChange={(id, s) => updateMutation.mutate({ id, status: s })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
