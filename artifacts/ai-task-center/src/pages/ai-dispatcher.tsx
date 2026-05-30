import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Zap, Users2, CheckCircle, AlertTriangle, Clock, ChevronRight,
  RefreshCw, Sparkles, BarChart2, History, Play, UserCheck, ShieldAlert,
  TrendingUp, Target, Info, X, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "@/lib/auth-api";
import { formatDistanceToNow, format } from "date-fns";
import { id } from "date-fns/locale";

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

// ─── Types ────────────────────────────────────────────────────────────────────
interface MemberWorkload {
  id: number;
  name: string;
  role: string;
  division: string | null;
  activeCount: number;
  overdueCount: number;
  dueSoonCount: number;
  status: "available" | "normal" | "busy" | "overloaded";
}

interface AiTask {
  id: number;
  taskNumber: string | null;
  title: string;
  category: string | null;
  priority: string;
  slaStatus: string | null;
  customerName: string | null;
  createdAt: string;
}

interface CandidateScore {
  memberId: number;
  memberName: string;
  role: string;
  division: string | null;
  activeTaskCount: number;
  workloadScore: number;
  skillScore: number;
  urgencyScore: number;
  availabilityScore: number;
  totalScore: number;
  reasons: string[];
}

interface DispatchSuggestion {
  taskId: number;
  taskTitle: string;
  taskCategory: string | null;
  taskPriority: string;
  taskSlaStatus: string;
  candidates: CandidateScore[];
  topCandidate: CandidateScore | null;
  explanation: string;
  confidence: number;
  fallbackMode: boolean;
}

interface DispatcherLog {
  id: number;
  taskNumber: string | null;
  taskTitle: string | null;
  taskCategory: string | null;
  suggestedMemberName: string | null;
  assignedMemberName: string | null;
  wasOverridden: boolean;
  totalScore: number | null;
  explanation: string | null;
  dispatchedBy: string | null;
  dispatchedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const WORKLOAD_CONFIG: Record<MemberWorkload["status"], { label: string; bg: string; border: string; dot: string; text: string }> = {
  available:  { label: "Tersedia",    bg: "bg-green-50",   border: "border-green-200", dot: "bg-green-500",  text: "text-green-700" },
  normal:     { label: "Normal",      bg: "bg-blue-50",    border: "border-blue-200",  dot: "bg-blue-500",   text: "text-blue-700" },
  busy:       { label: "Sibuk",       bg: "bg-amber-50",   border: "border-amber-200", dot: "bg-amber-500",  text: "text-amber-700" },
  overloaded: { label: "Overloaded",  bg: "bg-red-50",     border: "border-red-200",   dot: "bg-red-500",    text: "text-red-700" },
};

const PRIORITY_CONFIG: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high:     "bg-orange-100 text-orange-700 border-orange-200",
  medium:   "bg-blue-100 text-blue-700 border-blue-200",
  low:      "bg-gray-100 text-gray-600 border-gray-200",
};

const SLA_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  overdue:   { label: "Overdue",   color: "text-red-600",   icon: AlertTriangle },
  due_soon:  { label: "Due Soon",  color: "text-amber-600", icon: Clock },
  on_track:  { label: "On Track",  color: "text-green-600", icon: CheckCircle },
  completed: { label: "Selesai",   color: "text-blue-600",  icon: CheckCircle },
};

function ConfidenceRing({ value }: { value: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - value / 100);
  const color = value >= 70 ? "#10b981" : value >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative h-14 w-14 flex items-center justify-center">
      <svg className="absolute inset-0 rotate-[-90deg]" width="56" height="56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${circ}`} strokeDashoffset={fill} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <span className="text-sm font-bold" style={{ color }}>{value}%</span>
    </div>
  );
}

function ScoreBar({ label, value, max = 40, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Team Workload Panel ───────────────────────────────────────────────────────
function TeamWorkloadPanel({ onRefresh }: { onRefresh?: () => void }) {
  const { data: team = [], isLoading, refetch } = useQuery<MemberWorkload[]>({
    queryKey: ["dispatcher-team"],
    queryFn: () => apiFetch("/dispatcher/team-status"),
    refetchInterval: 30000,
  });

  const available = team.filter((m) => m.status === "available").length;
  const overloaded = team.filter((m) => m.status === "overloaded").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users2 className="h-4 w-4 text-primary" /> Status Tim ({team.length} anggota)
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { refetch(); onRefresh?.(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground mt-1">
          <span className="text-green-600 font-medium">{available} tersedia</span>
          {overloaded > 0 && <span className="text-red-600 font-medium">{overloaded} overloaded</span>}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" /></div>
        ) : team.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">Belum ada anggota tim</p>
        ) : (
          team.map((m) => {
            const cfg = WORKLOAD_CONFIG[m.status];
            return (
              <div key={m.id} className={`flex items-center gap-2.5 p-2.5 rounded-lg border ${cfg.bg} ${cfg.border}`}>
                <div className={`h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.role}{m.division ? ` · ${m.division}` : ""}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-xs font-semibold ${cfg.text}`}>{m.activeCount} task</p>
                  {(m.overdueCount > 0 || m.dueSoonCount > 0) && (
                    <p className="text-xs text-red-500">{m.overdueCount > 0 ? `${m.overdueCount}❗` : ""}{m.dueSoonCount > 0 ? ` ${m.dueSoonCount}⏰` : ""}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ─── Suggestion Dialog ─────────────────────────────────────────────────────────
function SuggestionDialog({
  task, onClose, onAssigned,
}: { task: AiTask | null; onClose: () => void; onAssigned: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [overrideMode, setOverrideMode] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateScore | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const { data: suggestion, isLoading: suggestLoading, refetch } = useQuery<DispatchSuggestion>({
    queryKey: ["dispatcher-suggest", task?.id],
    queryFn: () => apiFetch("/dispatcher/suggest", { method: "POST", body: JSON.stringify({ taskId: task!.id }) }),
    enabled: !!task,
    staleTime: 0,
  });

  const assignMut = useMutation({
    mutationFn: (payload: { taskId: number; memberName: string; wasOverridden: boolean; overrideReason?: string; suggestion?: DispatchSuggestion }) =>
      apiFetch("/dispatcher/assign", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["dispatcher-team"] });
      queryClient.invalidateQueries({ queryKey: ["dispatcher-queue"] });
      queryClient.invalidateQueries({ queryKey: ["dispatcher-logs"] });
      toast({ title: `✅ Task ditugaskan ke ${data.assignedTo}` });
      onAssigned();
      onClose();
    },
    onError: () => toast({ title: "Gagal menugaskan task", variant: "destructive" }),
  });

  const handleAssign = (candidate: CandidateScore, isOverride: boolean) => {
    if (!task || !suggestion) return;
    assignMut.mutate({
      taskId: task.id,
      memberName: candidate.memberName,
      wasOverridden: isOverride,
      overrideReason: isOverride ? overrideReason : undefined,
      suggestion,
    });
  };

  const top = suggestion?.topCandidate;
  const sla = SLA_CONFIG[task?.slaStatus ?? "on_track"] ?? SLA_CONFIG.on_track;
  const SlaIcon = sla.icon;

  return (
    <Dialog open={!!task} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" /> Smart AI Dispatcher
          </DialogTitle>
        </DialogHeader>

        {/* Task Info */}
        {task && (
          <div className="rounded-lg bg-muted/50 border p-3 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground">{task.taskNumber}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium}`}>{task.priority}</span>
              {task.category && <span className="text-xs text-muted-foreground bg-white border rounded-full px-2 py-0.5">{task.category}</span>}
              <span className={`text-xs flex items-center gap-1 font-medium ${sla.color}`}><SlaIcon className="h-3 w-3" />{sla.label}</span>
            </div>
            <p className="font-semibold">{task.title}</p>
            {task.customerName && <p className="text-sm text-muted-foreground">{task.customerName}</p>}
          </div>
        )}

        {suggestLoading ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground">AI sedang menganalisa tim...</p>
          </div>
        ) : suggestion ? (
          <div className="space-y-4">
            {/* Rekomendasi Utama */}
            {top && (
              <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {top.memberName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{top.memberName}</p>
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Rekomendasi AI</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{top.role}{top.division ? ` · ${top.division}` : ""}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{top.activeTaskCount} task aktif</p>
                    </div>
                  </div>
                  <ConfidenceRing value={suggestion.confidence} />
                </div>

                {/* Score breakdown */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <ScoreBar label="Workload" value={top.workloadScore} max={40} color="bg-green-500" />
                  <ScoreBar label="Skill Match" value={top.skillScore} max={30} color="bg-blue-500" />
                  <ScoreBar label="Urgency" value={top.urgencyScore} max={20} color="bg-orange-500" />
                  <ScoreBar label="Availability" value={top.availabilityScore} max={10} color="bg-violet-500" />
                </div>

                {/* GPT Explanation */}
                <div className="mt-3 p-3 bg-white rounded-lg border text-sm">
                  <p className="text-xs font-medium text-primary mb-1 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />Penjelasan AI</p>
                  <p className="text-muted-foreground leading-relaxed">{suggestion.explanation}</p>
                </div>

                {/* Rule reasons */}
                {top.reasons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {top.reasons.map((r, i) => (
                      <span key={i} className="text-xs bg-white border rounded-full px-2 py-0.5 text-muted-foreground">{r}</span>
                    ))}
                  </div>
                )}

                <Button
                  className="w-full mt-3"
                  onClick={() => handleAssign(top, false)}
                  disabled={assignMut.isPending}
                >
                  {assignMut.isPending ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />Menugaskan...</>
                  : <><Zap className="h-4 w-4 mr-2" />Tugaskan ke {top.memberName}</>}
                </Button>
              </div>
            )}

            {/* Kandidat lain */}
            {suggestion.candidates.length > 1 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Kandidat Lain</p>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setOverrideMode(!overrideMode)}>
                    {overrideMode ? "Batal" : "Override Manual"}
                  </Button>
                </div>
                <div className="space-y-2">
                  {suggestion.candidates.slice(1).map((c) => (
                    <div
                      key={c.memberId}
                      onClick={() => overrideMode && setSelectedCandidate(c)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${overrideMode ? "hover:border-primary/50 hover:bg-primary/5" : ""} ${selectedCandidate?.memberId === c.memberId ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                        {c.memberName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{c.memberName}</p>
                        <p className="text-xs text-muted-foreground">{c.role}{c.division ? ` · ${c.division}` : ""} · {c.activeTaskCount} task</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold">{c.totalScore.toFixed(0)}</p>
                        <p className="text-xs text-muted-foreground">/100</p>
                      </div>
                      {selectedCandidate?.memberId === c.memberId && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </div>
                  ))}
                </div>

                {overrideMode && selectedCandidate && (
                  <div className="mt-3 space-y-2">
                    <Label className="text-xs">Alasan Override (opsional)</Label>
                    <Textarea className="text-sm" rows={2} placeholder="Contoh: Permintaan customer, keahlian khusus..." value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                    <Button variant="outline" className="w-full" onClick={() => handleAssign(selectedCandidate, true)} disabled={assignMut.isPending}>
                      <UserCheck className="h-4 w-4 mr-2" />Override: Tugaskan ke {selectedCandidate.memberName}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => refetch()} disabled={suggestLoading} className="mr-auto">
            <RefreshCw className={`h-4 w-4 mr-1 ${suggestLoading ? "animate-spin" : ""}`} />Re-analyze
          </Button>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AiDispatcherPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedTask, setSelectedTask] = useState<AiTask | null>(null);
  const [tab, setTab] = useState("queue");

  const { data: queue = [], isLoading: queueLoading, refetch: refetchQueue } = useQuery<AiTask[]>({
    queryKey: ["dispatcher-queue"],
    queryFn: () => apiFetch("/dispatcher/queue"),
    refetchInterval: 30000,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<DispatcherLog[]>({
    queryKey: ["dispatcher-logs"],
    queryFn: () => apiFetch("/dispatcher/logs?limit=30"),
    refetchInterval: 60000,
  });

  const autoDispatch = useMutation({
    mutationFn: () => apiFetch("/dispatcher/auto-dispatch", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dispatcher-queue"] });
      queryClient.invalidateQueries({ queryKey: ["dispatcher-team"] });
      queryClient.invalidateQueries({ queryKey: ["dispatcher-logs"] });
      toast({ title: `🚀 Auto-dispatch selesai: ${data.dispatched}/${data.total} task ditugaskan` });
    },
    onError: () => toast({ title: "Auto-dispatch gagal", variant: "destructive" }),
  });

  const criticalCount = queue.filter((t) => t.priority === "critical" || t.priority === "high").length;
  const overdueCount = queue.filter((t) => t.slaStatus === "overdue").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            Smart AI Dispatcher
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Rule Engine + GPT · Workload Balancing · Skill Matching · Explainable Assignment
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetchQueue()}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
          {queue.length > 0 && (
            <Button onClick={() => autoDispatch.mutate()} disabled={autoDispatch.isPending} className="bg-gradient-to-r from-primary to-violet-600 text-white">
              {autoDispatch.isPending
                ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />Dispatching...</>
                : <><Zap className="h-4 w-4 mr-2" />Auto-Dispatch Semua ({queue.length})</>}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Antrian Unassigned", value: queue.length,    icon: Target,       color: "bg-blue-500" },
          { label: "High/Critical",       value: criticalCount,  icon: ShieldAlert,  color: "bg-orange-500" },
          { label: "Overdue",             value: overdueCount,   icon: AlertTriangle,color: "bg-red-500" },
          { label: "Total Dispatched",    value: logs.length,    icon: TrendingUp,   color: "bg-green-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${color}`}><Icon className="h-4 w-4 text-white" /></div>
                <div><p className="text-xl font-bold leading-none">{value}</p><p className="text-xs text-muted-foreground mt-0.5">{label}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Team Status */}
        <div className="lg:col-span-1">
          <TeamWorkloadPanel onRefresh={() => {}} />
        </div>

        {/* Right: Queue + Logs */}
        <div className="lg:col-span-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="queue">
                Antrian <Badge className="ml-1.5 h-5 text-xs" variant={queue.length > 0 ? "destructive" : "secondary"}>{queue.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="logs">Riwayat Dispatch</TabsTrigger>
            </TabsList>

            {/* QUEUE */}
            <TabsContent value="queue" className="mt-4">
              {queueLoading ? (
                <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
              ) : queue.length === 0 ? (
                <Card><CardContent className="py-16 text-center">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3 opacity-60" />
                  <p className="font-medium">Semua task sudah diassign!</p>
                  <p className="text-sm text-muted-foreground mt-1">Tidak ada task yang menunggu penugasan.</p>
                </CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {queue.map((task) => {
                    const sla = SLA_CONFIG[task.slaStatus ?? "on_track"] ?? SLA_CONFIG.on_track;
                    const SlaIcon = sla.icon;
                    const isUrgent = task.slaStatus === "overdue" || task.priority === "critical";
                    return (
                      <Card key={task.id} className={`hover:shadow-md transition-shadow ${isUrgent ? "border-red-200 bg-red-50/30" : ""}`}>
                        <CardContent className="p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-xs font-mono text-muted-foreground">{task.taskNumber}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium}`}>{task.priority}</span>
                                {task.category && <span className="text-xs text-muted-foreground">{task.category}</span>}
                                <span className={`text-xs flex items-center gap-1 ${sla.color}`}><SlaIcon className="h-3 w-3" />{sla.label}</span>
                              </div>
                              <p className="font-medium text-sm">{task.title}</p>
                              {task.customerName && <p className="text-xs text-muted-foreground mt-0.5">{task.customerName}</p>}
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true, locale: id })}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              className="shrink-0 h-8 text-xs"
                              onClick={() => setSelectedTask(task)}
                            >
                              <Sparkles className="h-3.5 w-3.5 mr-1" />
                              AI Assign
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* LOGS */}
            <TabsContent value="logs" className="mt-4">
              {logsLoading ? (
                <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
              ) : logs.length === 0 ? (
                <Card><CardContent className="py-16 text-center text-muted-foreground"><History className="h-10 w-10 mx-auto mb-3 opacity-30" /><p>Belum ada riwayat dispatch</p></CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <Card key={log.id}>
                      <CardContent className="p-3.5">
                        <div className="flex items-start gap-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${log.wasOverridden ? "bg-amber-100" : "bg-primary/10"}`}>
                            {log.wasOverridden ? <UserCheck className="h-4 w-4 text-amber-700" /> : <Brain className="h-4 w-4 text-primary" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground">{log.taskNumber}</span>
                              {log.wasOverridden && <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">Override</span>}
                            </div>
                            <p className="text-sm font-medium mt-0.5">{log.taskTitle}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              {log.wasOverridden && log.suggestedMemberName && (
                                <span className="line-through opacity-60">{log.suggestedMemberName}</span>
                              )}
                              <span className="flex items-center gap-1">
                                <ChevronRight className="h-3 w-3" />
                                <span className="font-medium text-foreground">{log.assignedMemberName}</span>
                              </span>
                              {log.totalScore && <span className="bg-muted rounded px-1">Skor: {log.totalScore.toFixed(0)}/100</span>}
                            </div>
                            {log.explanation && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">"{log.explanation}"</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              {log.dispatchedBy ? `oleh ${log.dispatchedBy} · ` : ""}
                              {format(new Date(log.dispatchedAt), "dd MMM HH:mm", { locale: id })}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Suggestion Dialog */}
      <SuggestionDialog
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onAssigned={() => { queryClient.invalidateQueries({ queryKey: ["dispatcher-queue"] }); }}
      />
    </div>
  );
}
