import { useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TaskAuditPanel } from "@/components/task-audit-panel";
import { formatDistanceToNow, format } from "date-fns";
import {
  ArrowLeft,
  Upload,
  FileText,
  File,
  Image,
  Trash2,
  Send,
  Clock,
  Paperclip,
  AlertCircle,
  CheckCircle2,
  Loader2,
  User,
  Building2,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiTask {
  id: number;
  taskNumber: string | null;
  title: string;
  status: string;
  priority: string;
  category: string | null;
  customerName: string | null;
  customerPhone: string | null;
  companyId: string | null;
  assignedTo: string | null;
  aiSummary: string | null;
  missingData: string | null;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  comments: Comment[];
}

interface Comment {
  id: number;
  taskId: number;
  comment: string;
  senderName: string | null;
  senderType: string | null;
  createdAt: string;
}

interface Attachment {
  id: number;
  taskId: number;
  fileName: string;
  fileUrl: string | null;
  objectPath: string | null;
  mimeType: string | null;
  fileSize: number | null;
  fileType: string | null;
  documentType: string | null;
  ocrStatus: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  "New": "bg-blue-100 text-blue-800",
  "Waiting Info": "bg-yellow-100 text-yellow-800",
  "Waiting Documents": "bg-orange-100 text-orange-800",
  "Ready for Review": "bg-purple-100 text-purple-800",
  "In Progress": "bg-indigo-100 text-indigo-800",
  "Pending Approval": "bg-pink-100 text-pink-800",
  "Completed": "bg-green-100 text-green-800",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  if (!mimeType) return <File className="h-5 w-5 text-gray-400" />;
  if (mimeType.startsWith("image/")) return <Image className="h-5 w-5 text-blue-400" />;
  if (mimeType === "application/pdf") return <FileText className="h-5 w-5 text-red-400" />;
  return <FileText className="h-5 w-5 text-gray-400" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AiTaskDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [comment, setComment] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // ── Task query ─────────────────────────────────────────────────────────────

  const { data: task, isLoading: taskLoading } = useQuery<AiTask>({
    queryKey: ["ai-task", id],
    queryFn: () => apiFetch(`/ai-tasks/${id}`),
    refetchInterval: 30000,
  });

  // ── Attachments query ──────────────────────────────────────────────────────

  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery<Attachment[]>({
    queryKey: ["ai-task-attachments", id],
    queryFn: () => apiFetch(`/ai-tasks/${id}/attachments`),
  });

  // ── Customer context query ─────────────────────────────────────────────────

  const { data: customerCtx } = useQuery<{
    id: number; phone: string; name: string | null; companyName: string | null;
    frequentService: string | null; specialNotes: string | null;
    previousIntents: string | null; totalTasks: number; lastSeenAt: string | null;
  } | null>({
    queryKey: ["customer-ctx", task?.customerPhone],
    queryFn: async () => {
      if (!task?.customerPhone) return null;
      try {
        const res = await fetch(`${BASE}/api/customers/${encodeURIComponent(task.customerPhone)}`);
        if (res.status === 404) return null;
        return res.json();
      } catch { return null; }
    },
    enabled: !!task?.customerPhone,
  });

  // ── Post comment ───────────────────────────────────────────────────────────

  const commentMutation = useMutation({
    mutationFn: (text: string) =>
      apiFetch(`/ai-tasks/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment: text, senderName: "Agent", senderType: "agent" }),
      }),
    onSuccess: () => {
      setComment("");
      queryClient.invalidateQueries({ queryKey: ["ai-task", id] });
    },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

  // ── Update status ──────────────────────────────────────────────────────────

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/ai-tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ai-task", id] }),
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  // ── Delete attachment ──────────────────────────────────────────────────────

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: number) =>
      fetch(`${BASE}/api/ai-tasks/${id}/attachments/${attachmentId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ai-task-attachments", id] }),
    onError: () => toast({ title: "Failed to delete attachment", variant: "destructive" }),
  });

  // ── File upload ────────────────────────────────────────────────────────────

  async function handleFileUpload(file: File) {
    setIsUploading(true);
    try {
      const { uploadURL, objectPath } = await apiFetch("/storage/uploads/request-url", {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });

      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      await apiFetch(`/ai-tasks/${id}/attachments`, {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          objectPath,
          mimeType: file.type,
          fileSize: file.size,
        }),
      });

      queryClient.invalidateQueries({ queryKey: ["ai-task-attachments", id] });
      toast({ title: "File uploaded successfully" });
    } catch (err) {
      toast({ title: "Upload failed", description: String(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  if (taskLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
        <p className="text-gray-600">Task not found.</p>
        <Link href="/ai-tasks">
          <Button variant="outline" className="mt-4">Back to Board</Button>
        </Link>
      </div>
    );
  }

  const missingDataKeys: string[] = (() => {
    try { return JSON.parse(task.missingData ?? "[]"); } catch { return []; }
  })();

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <Link href="/ai-tasks">
          <Button variant="outline" size="sm" className="shrink-0">
            <ArrowLeft className="h-4 w-4 mr-1" /> Board
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {task.taskNumber && (
              <span className="text-xs font-mono text-gray-400">{task.taskNumber}</span>
            )}
            <Badge className={PRIORITY_COLORS[task.priority] ?? "bg-gray-100"}>
              {task.priority}
            </Badge>
            {task.category && (
              <Badge variant="outline" className="text-xs">{task.category}</Badge>
            )}
          </div>
          <h1 className="text-xl font-semibold text-gray-900 leading-tight">{task.title}</h1>
          {task.customerName && (
            <p className="text-sm text-gray-500 mt-0.5">
              {task.customerName}
              {task.customerPhone && ` · ${task.customerPhone}`}
            </p>
          )}
        </div>

        {/* Status picker */}
        <Select value={task.status} onValueChange={(v) => statusMutation.mutate(v)}>
          <SelectTrigger className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(STATUS_COLORS).map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* ── Left / Main ──────────────────────────────────────────────────── */}
        <div className="md:col-span-2 space-y-5">

          {/* AI Summary */}
          {task.aiSummary && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-blue-600 mb-1 uppercase tracking-wide">AI Summary</p>
              <p className="text-sm text-blue-900 whitespace-pre-wrap">{task.aiSummary}</p>
            </div>
          )}

          {/* Missing data */}
          {missingDataKeys.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-orange-600 mb-2 uppercase tracking-wide flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> Outstanding information
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missingDataKeys.map((k) => (
                  <span key={k} className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full">
                    {k.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Conversation thread */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Conversation thread</h2>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {task.comments.length === 0 && (
                <p className="text-sm text-gray-400 italic">No notes yet.</p>
              )}
              {task.comments.map((c) => (
                <div key={c.id} className={`flex gap-2 ${c.senderType === "customer" ? "" : "flex-row-reverse"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    c.senderType === "customer"
                      ? "bg-gray-100 text-gray-800"
                      : "bg-blue-600 text-white ml-auto"
                  }`}>
                    <p className="whitespace-pre-wrap">{c.comment}</p>
                    <p className={`text-[10px] mt-1 opacity-60`}>
                      {c.senderName ?? "Agent"} · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Add note */}
            <div className="flex gap-2 mt-3">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add an internal note…"
                className="resize-none h-16 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && comment.trim()) {
                    e.preventDefault();
                    commentMutation.mutate(comment.trim());
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!comment.trim() || commentMutation.isPending}
                onClick={() => commentMutation.mutate(comment.trim())}
                className="self-end"
              >
                {commentMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Right / Sidebar ───────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Customer Context */}
          {task.customerPhone && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-2.5 text-sm border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Konteks Pelanggan
              </p>
              {customerCtx ? (
                <>
                  <div className="flex items-start gap-2">
                    <User className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-gray-800">{customerCtx.name ?? task.customerName ?? "—"}</p>
                      <p className="text-[11px] text-gray-400">{task.customerPhone}</p>
                    </div>
                  </div>
                  {customerCtx.companyName && (
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <span className="text-gray-700">{customerCtx.companyName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="text-gray-700">{customerCtx.totalTasks} total task</span>
                  </div>
                  {customerCtx.frequentService && (
                    <div>
                      <p className="text-[11px] text-gray-400">Layanan sering dipakai</p>
                      <p className="text-gray-700">{customerCtx.frequentService}</p>
                    </div>
                  )}
                  {customerCtx.previousIntents && (() => {
                    try {
                      const intents: string[] = JSON.parse(customerCtx.previousIntents ?? "[]");
                      if (intents.length === 0) return null;
                      return (
                        <div>
                          <p className="text-[11px] text-gray-400 mb-1">Intent sebelumnya</p>
                          <div className="flex flex-wrap gap-1">
                            {intents.slice(0, 5).map((i) => (
                              <span key={i} className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.5 rounded-full">{i}</span>
                            ))}
                          </div>
                        </div>
                      );
                    } catch { return null; }
                  })()}
                  {customerCtx.specialNotes && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-2 mt-1">
                      <p className="text-[11px] text-amber-600 font-semibold mb-0.5">Catatan Khusus</p>
                      <p className="text-xs text-amber-800">{customerCtx.specialNotes}</p>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <p className="text-[12px] text-gray-600">{task.customerName ?? "—"}</p>
                  <p className="text-[11px] text-gray-400">{task.customerPhone}</p>
                  <p className="text-[11px] text-gray-400 mt-1 italic">Belum ada riwayat tersimpan</p>
                </div>
              )}
            </div>
          )}

          {/* Audit Panel */}
          <TaskAuditPanel taskId={Number(id)} />

          {/* Meta */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              <Badge className={STATUS_COLORS[task.status] ?? "bg-gray-100 text-gray-700"}>
                {task.status}
              </Badge>
            </div>
            {task.assignedTo && (
              <div className="flex justify-between">
                <span className="text-gray-500">Assigned to</span>
                <span className="text-gray-800 font-medium">{task.assignedTo}</span>
              </div>
            )}
            {task.dueDate && (
              <div className="flex justify-between">
                <span className="text-gray-500">Due date</span>
                <span className="text-gray-800">{format(new Date(task.dueDate), "dd MMM yyyy")}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Created</span>
              <span className="text-gray-800">{formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}</span>
            </div>
          </div>

          {/* Attachments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                <Paperclip className="h-4 w-4" /> Documents
              </h2>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Upload className="h-3.5 w-3.5" />}
                  <span className="ml-1">{isUploading ? "Uploading…" : "Upload"}</span>
                </Button>
              </div>
            </div>

            {attachmentsLoading && (
              <p className="text-xs text-gray-400">Loading attachments…</p>
            )}
            {!attachmentsLoading && attachments.length === 0 && (
              <p className="text-xs text-gray-400 italic">No documents uploaded yet.</p>
            )}

            <div className="space-y-2">
              {attachments.map((att) => (
                <div key={att.id} className="flex items-center gap-2 bg-white border rounded-lg p-2 group">
                  <FileIcon mimeType={att.mimeType} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{att.fileName}</p>
                    <p className="text-[10px] text-gray-400">
                      {att.fileSize ? formatBytes(att.fileSize) : ""}
                      {att.documentType ? ` · ${att.documentType}` : ""}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {att.ocrStatus === "completed" && (
                        <span className="flex items-center gap-0.5 text-[10px] text-green-600">
                          <CheckCircle2 className="h-3 w-3" /> OCR done
                        </span>
                      )}
                      {att.ocrStatus === "pending" && (
                        <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                          <Clock className="h-3 w-3" /> Pending OCR
                        </span>
                      )}
                    </div>
                  </div>
                  {att.fileUrl && (
                    <a
                      href={`${BASE}${att.fileUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:text-blue-700 text-[10px] underline shrink-0"
                    >
                      View
                    </a>
                  )}
                  <button
                    onClick={() => deleteAttachmentMutation.mutate(att.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600 shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
