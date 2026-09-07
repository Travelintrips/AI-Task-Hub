import { useState, useMemo, useRef, useEffect } from "react";
import { getStoredToken } from "@/lib/auth-api";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerEvents } from "@/hooks/use-server-events";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import {
  Search, RefreshCw, Filter, ChevronDown, Plus, X, Calendar, AlertCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
  "New Inquiry", "Waiting Documents", "Ready for Review",
  "Assigned", "In Progress", "Completed",
] as const;

type TaskStatus = typeof STATUSES[number];

const STATUS_CONFIG: Record<TaskStatus, { dot: string; badge: string; cardBorder: string; cardText: string }> = {
  "New Inquiry":       { dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700",    cardBorder: "border-blue-200",   cardText: "text-blue-700"   },
  "Waiting Documents": { dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-700",  cardBorder: "border-amber-200",  cardText: "text-amber-700"  },
  "Ready for Review":  { dot: "bg-violet-500", badge: "bg-violet-100 text-violet-700",cardBorder: "border-violet-200", cardText: "text-violet-700" },
  "Assigned":          { dot: "bg-indigo-500", badge: "bg-indigo-100 text-indigo-700",cardBorder: "border-indigo-200", cardText: "text-indigo-700" },
  "In Progress":       { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700",cardBorder: "border-orange-200", cardText: "text-orange-700" },
  "Completed":         { dot: "bg-green-500",  badge: "bg-green-100 text-green-700",  cardBorder: "border-green-200",  cardText: "text-green-700"  },
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

const DIVISIONS = [
  "Import", "Export", "Trucking", "Customs Clearance", "Warehouse",
  "Finance", "CS", "Sales", "Operasional",
];

// ─── Status normalization ─────────────────────────────────────────────────────

function normalizeStatus(status: string): TaskStatus {
  if (STATUS_CONFIG[status as TaskStatus]) return status as TaskStatus;
  if (status === "pending" || status === "draft" || status === "new" || status === "new_inquiry") return "New Inquiry";
  if (status === "waiting_documents" || status === "waiting_doc") return "Waiting Documents";
  if (status === "documents_received" || status === "audit_in_progress" || status === "missing_data" || status === "ready_for_review" || status === "review") return "Ready for Review";
  if (status === "assigned") return "Assigned";
  if (status === "in_progress" || status === "processing" || status === "waiting_customer" || status === "waiting_vendor" || status === "quotation_ready" || status === "approved_by_customer") return "In Progress";
  if (status === "completed" || status === "done" || status === "paid") return "Completed";
  if (status === "cancelled") return "Completed";
  return "New Inquiry";
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

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

interface TaskFilters {
  category?: string;
  division?: string;
  priority?: string;
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function fetchAiTasks(filters: TaskFilters = {}): Promise<AiTask[]> {
  const qs = new URLSearchParams();
  if (filters.category && filters.category !== "all") qs.set("category", filters.category);
  if (filters.division && filters.division !== "all") qs.set("division", filters.division);
  if (filters.priority && filters.priority !== "all") qs.set("priority", filters.priority);
  if (filters.status   && filters.status   !== "all") qs.set("status",   filters.status);
  if (filters.search)   qs.set("search",   filters.search);
  if (filters.dateFrom) qs.set("dateFrom", filters.dateFrom);
  if (filters.dateTo)   qs.set("dateTo",   filters.dateTo);
  return apiFetch<AiTask[]>(`${BASE}/api/ai-tasks${qs.toString() ? `?${qs}` : ""}`);
}

// ─── Status summary cards ─────────────────────────────────────────────────────

function StatusCards({
  tasks, activeFilter, onFilter,
}: { tasks: AiTask[]; activeFilter: string; onFilter: (s: string) => void }) {
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
              <span className={`text-[11px] font-medium truncate ${active ? cfg.cardText : "text-gray-500"}`}>{s}</span>
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

// ─── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, highlight }: { task: AiTask; highlight?: string }) {
  const normalized = normalizeStatus(task.status);
  const cfg = STATUS_CONFIG[normalized];
  const age = formatDistanceToNow(new Date(task.createdAt), { addSuffix: true });

  function hl(text: string) {
    if (!highlight?.trim()) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(highlight.toLowerCase());
    if (idx === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 rounded px-0.5">{text.slice(idx, idx + highlight.length)}</mark>
        {text.slice(idx + highlight.length)}
      </>
    );
  }

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="px-3 py-2.5 whitespace-nowrap">
        <Link href={`/ai-tasks/${task.id}`}>
          <span className="text-sm font-mono text-blue-600 hover:underline cursor-pointer">
            {task.taskNumber ?? `#${task.id}`}
          </span>
        </Link>
        <div className="text-[11px] text-gray-400">{age}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="text-sm font-medium text-gray-800 truncate max-w-[120px]">
          {task.customerName ? hl(task.customerName) : "—"}
        </div>
        {task.customerPhone && (
          <div className="text-[11px] text-gray-400">{hl(task.customerPhone)}</div>
        )}
      </td>
      <td className="px-3 py-2.5 max-w-[200px]">
        <Link href={`/ai-tasks/${task.id}`}>
          <span className="text-sm text-blue-700 hover:underline cursor-pointer line-clamp-2 leading-snug">
            {hl(task.title)}
          </span>
        </Link>
        {task.description && (
          <div className="text-[11px] text-gray-400 line-clamp-1 mt-0.5">{task.description}</div>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {normalized}
        </span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold capitalize ${PRIORITY_BADGE[task.priority] ?? "bg-gray-100 text-gray-700"}`}>
          {task.priority}
        </span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-xs text-gray-600">{task.category ?? "—"}</span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-xs text-gray-600">{task.division ?? "—"}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs text-gray-500 line-clamp-1">{task.aiIntent ?? "—"}</span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {task.auditStatus
          ? <span className="text-xs text-gray-600">{task.auditStatus}</span>
          : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 max-w-[140px]">
        <span className="text-xs text-gray-500 line-clamp-1">{task.latestMessage ?? "—"}</span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {task.assignedTo
          ? <span className="text-xs font-medium text-gray-700">{task.assignedTo}</span>
          : <span className="text-xs text-gray-300 italic">Belum</span>}
      </td>
    </tr>
  );
}

// ─── Table Skeleton ───────────────────────────────────────────────────────────

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

// ─── Add Task Dialog ──────────────────────────────────────────────────────────

interface NewTaskForm {
  title: string;
  customerName: string;
  customerPhone: string;
  category: string;
  division: string;
  priority: string;
  description: string;
}

const EMPTY_FORM: NewTaskForm = {
  title: "", customerName: "", customerPhone: "",
  category: "", division: "", priority: "medium", description: "",
};

function AddTaskDialog({
  open, onClose, onSuccess,
}: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<NewTaskForm>(EMPTY_FORM);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data: NewTaskForm) =>
      apiFetch<AiTask>(`${BASE}/api/ai-tasks`, {
        method: "POST",
        body: JSON.stringify({
          title:         data.title,
          customerName:  data.customerName || undefined,
          customerPhone: data.customerPhone || undefined,
          category:      data.category || undefined,
          division:      data.division || undefined,
          priority:      data.priority,
          description:   data.description || undefined,
          status:        "new_inquiry",
        }),
      }),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setError("");
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function set(field: keyof NewTaskForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Judul wajib diisi"); return; }
    setError("");
    mutation.mutate(form);
  }

  function handleClose() {
    if (!mutation.isPending) { setForm(EMPTY_FORM); setError(""); onClose(); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tambah Task Baru</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Judul */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Judul <span className="text-red-500">*</span></Label>
            <Input
              id="title"
              placeholder="Misal: Pengiriman barang ke Jakarta"
              value={form.title}
              onChange={set("title")}
              required
            />
          </div>

          {/* Customer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="customerName">Nama Customer</Label>
              <Input id="customerName" placeholder="Budi Santoso" value={form.customerName} onChange={set("customerName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customerPhone">No. HP Customer</Label>
              <Input id="customerPhone" placeholder="628111222333" value={form.customerPhone} onChange={set("customerPhone")} />
            </div>
          </div>

          {/* Kategori & Divisi */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <select
                value={form.category}
                onChange={set("category")}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="">— Pilih Kategori —</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Divisi</Label>
              <select
                value={form.division}
                onChange={set("division")}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="">— Pilih Divisi —</option>
                {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Prioritas */}
          <div className="space-y-1.5">
            <Label>Prioritas</Label>
            <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">🟢 Low</SelectItem>
                <SelectItem value="medium">🟡 Medium</SelectItem>
                <SelectItem value="high">🔴 High</SelectItem>
                <SelectItem value="urgent">🚨 Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Deskripsi */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Deskripsi</Label>
            <Textarea
              id="description"
              placeholder="Detail tambahan tentang task ini..."
              value={form.description}
              onChange={set("description")}
              rows={3}
              className="resize-none"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={mutation.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Menyimpan..." : "Buat Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Active filter badge ──────────────────────────────────────────────────────

function FilterBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[11px] text-blue-700 font-medium">
      {label}
      <button onClick={onRemove} className="ml-0.5 hover:text-blue-900">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AiTaskBoard() {
  const [search, setSearch]           = useState("");
  const [debouncedSearch, setDebounced] = useState("");
  const [categoryFilter, setCategory] = useState("all");
  const [divisionFilter, setDivision] = useState("all");
  const [priorityFilter, setPriority] = useState("all");
  const [statusFilter,   setStatus]   = useState("all");
  const [dateFrom,       setDateFrom] = useState("");
  const [dateTo,         setDateTo]   = useState("");
  const [addOpen,        setAddOpen]  = useState(false);
  const queryClient = useQueryClient();

  // Debounce search 300ms
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Derive unique divisions from loaded data untuk filter dinamis
  const queryKey = useMemo(
    () => ["ai-tasks", categoryFilter, divisionFilter, priorityFilter, dateFrom, dateTo],
    [categoryFilter, divisionFilter, priorityFilter, dateFrom, dateTo],
  );

  const { data: allTasks = [], isLoading, isFetching, refetch } = useQuery<AiTask[]>({
    queryKey,
    queryFn: () => fetchAiTasks({ category: categoryFilter, division: divisionFilter, priority: priorityFilter, dateFrom, dateTo }),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  // SSE realtime — invalidate saat ada task baru / update
  useServerEvents({
    new_task:     () => void queryClient.invalidateQueries({ queryKey: ["ai-tasks"] }),
    task_updated: () => void queryClient.invalidateQueries({ queryKey: ["ai-tasks"] }),
  });

  // Client-side filter: status + search (debounced)
  const filtered = useMemo(() => {
    let result = allTasks;
    if (statusFilter !== "all") {
      result = result.filter((t) => normalizeStatus(t.status) === statusFilter);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (t.customerPhone ?? "").toLowerCase().includes(q) ||
          (t.taskNumber ?? "").toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [allTasks, debouncedSearch, statusFilter]);

  // Hitung berapa filter aktif (selain search)
  const activeServerFilters = [
    categoryFilter !== "all" && `Kat: ${categoryFilter}`,
    divisionFilter !== "all" && `Div: ${divisionFilter}`,
    priorityFilter !== "all" && `Prior: ${priorityFilter}`,
    dateFrom && `Dari: ${dateFrom}`,
    dateTo   && `S/d: ${dateTo}`,
  ].filter(Boolean) as string[];

  function resetAllFilters() {
    setCategory("all"); setDivision("all"); setPriority("all");
    setDateFrom(""); setDateTo(""); setStatus("all"); setSearch("");
  }

  const hasFilters = activeServerFilters.length > 0 || statusFilter !== "all" || search;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b bg-white space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">AI Task Center</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {filtered.length !== allTasks.length
                ? <><span className="font-medium text-blue-600">{filtered.length}</span> dari {allTasks.length} task</>
                : <>{allTasks.length} task</>}
              {isFetching && <span className="ml-2 text-[11px] text-gray-400 animate-pulse">memperbarui…</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="w-3.5 h-3.5" />
              Tambah Task
            </Button>
          </div>
        </div>

        {/* Status summary cards */}
        <StatusCards tasks={allTasks} activeFilter={statusFilter} onFilter={setStatus} />

        {/* Search + Filter bar */}
        <div className="flex gap-2 flex-wrap items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              placeholder="Cari judul, nama, HP, nomor task..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm pr-8"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={activeServerFilters.length > 0 ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5 text-sm"
              >
                <Filter className="w-3.5 h-3.5" />
                Filter
                {activeServerFilters.length > 0 && (
                  <span className="ml-0.5 bg-white text-blue-700 text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {activeServerFilters.length}
                  </span>
                )}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-3 space-y-3" onCloseAutoFocus={(e) => e.preventDefault()}>
              {/* Kategori */}
              <div>
                <p className="text-[11px] text-gray-500 font-semibold mb-1.5 uppercase tracking-wide">Kategori</p>
                <Select value={categoryFilter} onValueChange={setCategory}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Semua Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Divisi */}
              <div>
                <p className="text-[11px] text-gray-500 font-semibold mb-1.5 uppercase tracking-wide">Divisi</p>
                <Select value={divisionFilter} onValueChange={setDivision}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Semua Divisi" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Divisi</SelectItem>
                    {DIVISIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Prioritas */}
              <div>
                <p className="text-[11px] text-gray-500 font-semibold mb-1.5 uppercase tracking-wide">Prioritas</p>
                <Select value={priorityFilter} onValueChange={setPriority}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Semua Prioritas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Prioritas</SelectItem>
                    <SelectItem value="urgent">🚨 Urgent</SelectItem>
                    <SelectItem value="high">🔴 High</SelectItem>
                    <SelectItem value="medium">🟡 Medium</SelectItem>
                    <SelectItem value="low">🟢 Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Rentang tanggal */}
              <div>
                <p className="text-[11px] text-gray-500 font-semibold mb-1.5 uppercase tracking-wide flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Rentang Tanggal
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 w-8">Dari</span>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      max={dateTo || undefined}
                      className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 w-8">S/d</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      min={dateFrom || undefined}
                      className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Reset */}
              {activeServerFilters.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-gray-500"
                  onClick={() => { setCategory("all"); setDivision("all"); setPriority("all"); setDateFrom(""); setDateTo(""); }}
                >
                  <X className="w-3 h-3 mr-1" /> Reset Filter
                </Button>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Reset semua */}
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 text-xs text-gray-500 gap-1" onClick={resetAllFilters}>
              <X className="w-3 h-3" /> Hapus Semua
            </Button>
          )}
        </div>

        {/* Active filter badges */}
        {(activeServerFilters.length > 0 || statusFilter !== "all") && (
          <div className="flex flex-wrap gap-1.5 -mt-1">
            {statusFilter !== "all" && (
              <FilterBadge label={`Status: ${statusFilter}`} onRemove={() => setStatus("all")} />
            )}
            {categoryFilter !== "all" && (
              <FilterBadge label={`Kategori: ${categoryFilter}`} onRemove={() => setCategory("all")} />
            )}
            {divisionFilter !== "all" && (
              <FilterBadge label={`Divisi: ${divisionFilter}`} onRemove={() => setDivision("all")} />
            )}
            {priorityFilter !== "all" && (
              <FilterBadge label={`Prioritas: ${priorityFilter}`} onRemove={() => setPriority("all")} />
            )}
            {dateFrom && (
              <FilterBadge label={`Dari: ${dateFrom}`} onRemove={() => setDateFrom("")} />
            )}
            {dateTo && (
              <FilterBadge label={`S/d: ${dateTo}`} onRemove={() => setDateTo("")} />
            )}
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse min-w-[960px]">
          <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
            <tr>
              {["No. Task", "Pelanggan", "Judul", "Status", "Prioritas", "Kategori", "Divisi", "AI Intent", "Audit", "Pesan Terakhir", "Assignee"].map((h) => (
                <th key={h} className="px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
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
                <td colSpan={11} className="px-3 py-16 text-center">
                  <div className="flex flex-col items-center gap-3 text-gray-400">
                    <Search className="w-10 h-10 opacity-25" />
                    <div>
                      <p className="text-sm font-medium text-gray-500">
                        {hasFilters ? "Tidak ada task yang sesuai filter" : "Belum ada task"}
                      </p>
                      <p className="text-xs text-gray-400 mt-1 text-center">
                        {hasFilters
                          ? "Coba ubah atau hapus filter untuk melihat semua task"
                          : "Task dibuat otomatis ketika pesan WA masuk dan terdeteksi oleh AI, atau buat manual dengan tombol di kanan atas"}
                      </p>
                    </div>
                    {hasFilters && (
                      <Button variant="ghost" size="sm" onClick={resetAllFilters} className="text-xs">
                        Hapus semua filter
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {filtered.map((task) => (
                <TaskRow key={task.id} task={task} highlight={debouncedSearch} />
              ))}
            </tbody>
          )}
        </table>
      </div>

      {/* ── Add Task Dialog ── */}
      <AddTaskDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => void queryClient.invalidateQueries({ queryKey: ["ai-tasks"] })}
      />
    </div>
  );
}
