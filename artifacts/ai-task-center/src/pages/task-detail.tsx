import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  useGetTask, getGetTaskQueryKey,
  useUpdateTask,
  useDeleteTask,
  useListTeamMembers,
  getListTeamMembersQueryKey,
  getListTasksQueryKey,
  useGenerateTaskAiSummary,
} from "@workspace/api-client-react";
import { TaskUpdateStatus, TaskUpdatePriority } from "@workspace/api-zod";
import { format, formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Clock, User, Tag, AlertCircle, Trash2, Activity, MessageSquare, Sparkles, TriangleAlert, Lightbulb, RefreshCw, FileCheck, CheckCircle2, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { getStoredToken } from "@/lib/auth-api";

// ─── Document Validation Panel ────────────────────────────────────────────────

interface DocumentAudit {
  id: number;
  documentType: string;
  fileName: string;
  fileUrl: string;
  validationStatus: "valid" | "incomplete" | "invalid" | "needs_review";
  confidenceScore: string;
  missingFields: string[];
  issueSummary: string | null;
  aiNotes: string | null;
  extractedFields: Record<string, unknown>;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

const VAL_STATUS_CONFIG = {
  valid:        { label: "Valid",         icon: CheckCircle2, cls: "bg-green-100 text-green-800" },
  incomplete:   { label: "Tidak Lengkap", icon: AlertCircle,  cls: "bg-yellow-100 text-yellow-800" },
  invalid:      { label: "Tidak Valid",   icon: XCircle,      cls: "bg-red-100 text-red-800" },
  needs_review: { label: "Perlu Review",  icon: Clock,        cls: "bg-blue-100 text-blue-800" },
};

async function apiFetchWithAuth(path: string, init?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

function AuditRow({ audit, onReview }: { audit: DocumentAudit; onReview: (a: DocumentAudit) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = VAL_STATUS_CONFIG[audit.validationStatus] ?? VAL_STATUS_CONFIG.needs_review;
  const Icon = cfg.icon;
  const docLabel = audit.documentType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const confidence = Math.round(parseFloat(audit.confidenceScore) * 100);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls} shrink-0 mt-0.5`}>
          <Icon className="h-3 w-3" />
          {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{docLabel}</p>
          <p className="text-xs text-muted-foreground truncate">{audit.fileName}</p>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">{confidence}%</div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t bg-muted/20">
          {audit.missingFields.length > 0 && (
            <div className="pt-3">
              <p className="text-xs font-semibold text-amber-700 mb-1">Field Tidak Lengkap</p>
              <div className="flex flex-wrap gap-1">
                {audit.missingFields.map((f) => (
                  <span key={f} className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-xs">{f.replace(/_/g, " ")}</span>
                ))}
              </div>
            </div>
          )}
          {audit.issueSummary && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-0.5">Ringkasan Masalah</p>
              <p className="text-xs">{audit.issueSummary}</p>
            </div>
          )}
          {audit.aiNotes && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-0.5">Catatan AI</p>
              <p className="text-xs text-muted-foreground">{audit.aiNotes}</p>
            </div>
          )}
          {Object.keys(audit.extractedFields).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Field Terekstrak</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {Object.entries(audit.extractedFields).map(([k, v]) => (
                  v != null && (
                    <div key={k} className="flex gap-1 text-xs">
                      <span className="text-muted-foreground truncate">{k.replace(/_/g, " ")}:</span>
                      <span className="font-medium truncate">{String(v)}</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}
          {audit.reviewedBy && (
            <p className="text-xs text-muted-foreground">
              Direview oleh <strong>{audit.reviewedBy}</strong>
              {audit.reviewedAt && ` · ${formatDistanceToNow(new Date(audit.reviewedAt), { addSuffix: true, locale: localeId })}`}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
              <a href={audit.fileUrl} target="_blank" rel="noreferrer">Lihat File</a>
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onReview(audit)}>
              Review / Override
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewOverrideDialog({
  audit,
  onClose,
  onSaved,
}: {
  audit: DocumentAudit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<DocumentAudit["validationStatus"]>(audit.validationStatus);
  const [note, setNote] = useState(audit.issueSummary ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetchWithAuth(`/documents/audits/${audit.id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ validationStatus: status, issueSummary: note }),
      });
      toast({ title: "Review disimpan" });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Gagal menyimpan review", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review Dokumen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Override Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as DocumentAudit["validationStatus"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="valid">Valid</SelectItem>
                <SelectItem value="incomplete">Tidak Lengkap</SelectItem>
                <SelectItem value="invalid">Tidak Valid</SelectItem>
                <SelectItem value="needs_review">Perlu Review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Catatan Review</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tulis catatan review..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentValidationPanel({ taskId }: { taskId: number }) {
  const queryClient = useQueryClient();
  const [reviewAudit, setReviewAudit] = useState<DocumentAudit | null>(null);

  const { data, isLoading } = useQuery<{ data: DocumentAudit[] }>({
    queryKey: ["task-doc-audits", taskId],
    queryFn: () => apiFetchWithAuth(`/documents/audits?taskId=${taskId}`),
    enabled: !!taskId,
  });

  const audits = data?.data ?? [];

  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-violet-700 text-base">
          <FileCheck className="h-4 w-4" />
          Validasi Dokumen
          {audits.length > 0 && (
            <span className="ml-auto text-xs font-normal bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
              {audits.length} dokumen
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : audits.length === 0 ? (
          <p className="text-sm text-violet-600/70 italic">
            Belum ada dokumen yang divalidasi untuk task ini.
          </p>
        ) : (
          <div className="space-y-2">
            {audits.map((a) => (
              <AuditRow key={a.id} audit={a} onReview={setReviewAudit} />
            ))}
          </div>
        )}
      </CardContent>
      {reviewAudit && (
        <ReviewOverrideDialog
          audit={reviewAudit}
          onClose={() => setReviewAudit(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["task-doc-audits", taskId] })}
        />
      )}
    </Card>
  );
}

// ─── AI Summary Card ──────────────────────────────────────────────────────────

interface AiSummaryResult {
  summary: string;
  missingData: string[];
  recommendation: string;
}

function AiSummaryCard({ taskId }: { taskId: number }) {
  const [result, setResult] = useState<AiSummaryResult | null>(null);
  const generateSummary = useGenerateTaskAiSummary();

  const handleGenerate = () => {
    generateSummary.mutate(
      { id: taskId },
      {
        onSuccess: (data) => setResult(data as AiSummaryResult),
        onError: () => {},
      }
    );
  };

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-blue-700 text-base">
            <Sparkles className="h-4 w-4" />
            Ringkasan AI Admin
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generateSummary.isPending}
            className="border-blue-300 text-blue-700 hover:bg-blue-100 hover:text-blue-800 gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generateSummary.isPending ? "animate-spin" : ""}`} />
            {generateSummary.isPending ? "Menganalisis..." : result ? "Perbarui" : "Generate Ringkasan"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {generateSummary.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full bg-blue-200/60" />
            <Skeleton className="h-4 w-5/6 bg-blue-200/60" />
            <Skeleton className="h-4 w-4/6 bg-blue-200/60" />
          </div>
        )}

        {!generateSummary.isPending && !result && (
          <p className="text-sm text-blue-600/70 italic">
            Klik "Generate Ringkasan" untuk membuat analisis operasional AI dari task ini.
          </p>
        )}

        {!generateSummary.isPending && result && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700 leading-relaxed">{result.summary}</p>

            {result.missingData.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Data / Dokumen yang Kurang
                </div>
                <ul className="space-y-1">
                  {result.missingData.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-amber-800">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.missingData.length === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Semua data tampaknya sudah lengkap
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                <Lightbulb className="h-3.5 w-3.5" />
                Rekomendasi
              </div>
              <p className="text-sm text-blue-800 leading-relaxed">{result.recommendation}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TaskDetail() {
  const [match, params] = useRoute("/tasks/:id");
  const [, setLocation] = useLocation();
  const id = match && params?.id ? parseInt(params.id, 10) : 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: task, isLoading } = useGetTask(id, { 
    query: { enabled: !!id, queryKey: getGetTaskQueryKey(id) } 
  });
  
  const { data: teamMembers } = useListTeamMembers({ 
    query: { queryKey: getListTeamMembersQueryKey() } 
  });

  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  if (!match || (!isLoading && !task)) {
    return <div className="p-8">Task not found</div>;
  }

  const handleStatusChange = (newStatus: string) => {
    updateTask.mutate(
      { id, data: { status: newStatus as TaskUpdateStatus } },
      {
        onSuccess: () => {
          toast({ title: "Status diperbarui" });
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Gagal memperbarui status", variant: "destructive" })
      }
    );
  };

  const handleAssigneeChange = (newAssigneeId: string) => {
    const assigneeId = newAssigneeId === "unassigned" ? null : parseInt(newAssigneeId, 10);
    updateTask.mutate(
      { id, data: { assigneeId: assigneeId as number | undefined } },
      {
        onSuccess: () => {
          toast({ title: "Penugasan diperbarui" });
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Gagal memperbarui penugasan", variant: "destructive" })
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Apakah Anda yakin ingin menghapus task ini?")) {
      deleteTask.mutate(
        { id },
        {
          onSuccess: () => {
            toast({ title: "Task dihapus" });
            queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
            setLocation("/tasks");
          },
          onError: () => toast({ title: "Gagal menghapus task", variant: "destructive" })
        }
      );
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto w-full space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/tasks"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          {isLoading ? (
            <Skeleton className="h-8 w-64" />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">{task?.title}</h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && task && (
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteTask.isPending} data-testid="button-delete-task">
              <Trash2 className="h-4 w-4 mr-2" /> Hapus
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-6">
              <Skeleton className="h-48 w-full" />
            </div>
            <div className="space-y-6">
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        </div>
      ) : task ? (
        <div className="space-y-6">
          <AiSummaryCard taskId={id} />

          <DocumentValidationPanel taskId={id} />

          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Deskripsi</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{task.description || "Tidak ada deskripsi."}</p>
                </CardContent>
              </Card>

              {task.sourceMessageId && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" /> Pesan Sumber
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/messages`}>Lihat pesan terkait #{task.sourceMessageId}</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Detail</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <Activity className="h-4 w-4" /> Status
                    </div>
                    <Select value={task.status} onValueChange={handleStatusChange} disabled={updateTask.isPending}>
                      <SelectTrigger data-testid="select-update-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <AlertCircle className="h-4 w-4" /> Prioritas
                    </div>
                    <Badge variant={task.priority === "urgent" ? "destructive" : "outline"} className="capitalize">
                      {task.priority}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <User className="h-4 w-4" /> Ditugaskan ke
                    </div>
                    <Select value={task.assigneeId?.toString() || "unassigned"} onValueChange={handleAssigneeChange} disabled={updateTask.isPending}>
                      <SelectTrigger data-testid="select-update-assignee">
                        <SelectValue placeholder="Belum ditugaskan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Belum ditugaskan</SelectItem>
                        {teamMembers?.map((member) => (
                          <SelectItem key={member.id} value={member.id.toString()}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" /> Dibuat
                    </div>
                    <div className="text-sm">
                      {format(new Date(task.createdAt), "PPp")}
                    </div>
                  </div>

                  {task.tags && task.tags.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <Tag className="h-4 w-4" /> Tag
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {task.tags.map(tag => (
                          <Badge key={tag} variant="secondary">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
