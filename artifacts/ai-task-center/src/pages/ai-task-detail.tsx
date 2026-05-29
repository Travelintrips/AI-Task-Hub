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
  Link2,
  Copy,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { getStoredToken } from "@/lib/auth-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return null;
  return res.json();
}

// ─── Template WA ──────────────────────────────────────────────────────────────

const WA_TEMPLATES = [
  {
    id: "konfirmasi_penerimaan",
    label: "✅ Konfirmasi Penerimaan Pesanan",
    build: (task: { taskNumber?: string | null; title: string; customerName?: string | null }) =>
      `Halo${task.customerName ? ` *${task.customerName}*` : ""},\n\nKami telah menerima permintaan Anda.\n\n📋 No. Task: *${task.taskNumber ?? "-"}*\n📝 ${task.title}\n\nTim kami sedang memprosesnya. Kami akan segera menghubungi Anda kembali.\n\n_AI Task Center_`,
  },
  {
    id: "minta_dokumen",
    label: "📄 Permintaan Dokumen",
    build: (task: { taskNumber?: string | null; customerName?: string | null }) =>
      `Halo${task.customerName ? ` *${task.customerName}*` : ""},\n\nUntuk melanjutkan proses task *${task.taskNumber ?? "-"}*, kami memerlukan kelengkapan dokumen berikut:\n\n• [ Sebutkan dokumen yang dibutuhkan ]\n\nMohon kirimkan dokumen tersebut sesegera mungkin.\n\nTerima kasih 🙏\n_AI Task Center_`,
  },
  {
    id: "update_progress",
    label: "⚙️ Update Progress",
    build: (task: { taskNumber?: string | null; status: string; customerName?: string | null }) =>
      `Halo${task.customerName ? ` *${task.customerName}*` : ""},\n\nBerikut update terbaru untuk task Anda:\n\n📋 No: *${task.taskNumber ?? "-"}*\n🔄 Status: *${task.status}*\n\nJika ada pertanyaan, jangan ragu untuk menghubungi kami.\n\nTerima kasih 🙏\n_AI Task Center_`,
  },
  {
    id: "selesai",
    label: "🎉 Task Selesai",
    build: (task: { taskNumber?: string | null; title: string; customerName?: string | null }) =>
      `Halo${task.customerName ? ` *${task.customerName}*` : ""},\n\nKami senang memberitahu bahwa task Anda telah *selesai* ✅\n\n📋 No: *${task.taskNumber ?? "-"}*\n📝 ${task.title}\n\nTerima kasih telah mempercayakan kepada kami. Sampai jumpa di kesempatan berikutnya! 🙏\n_AI Task Center_`,
  },
  {
    id: "custom",
    label: "✏️ Pesan Kustom",
    build: () => "",
  },
] as const;

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

const AI_TASK_STATUSES: Record<string, string> = {
  new_inquiry: "Inquiry Baru",
  waiting_documents: "Menunggu Dokumen",
  documents_received: "Dokumen Diterima",
  audit_in_progress: "Audit Berjalan",
  missing_data: "Data Kurang",
  ready_for_review: "Siap Direview",
  assigned: "Ditugaskan",
  in_progress: "Sedang Dikerjakan",
  waiting_customer: "Menunggu Customer",
  waiting_vendor: "Menunggu Vendor",
  quotation_ready: "Quotation Siap",
  approved_by_customer: "Disetujui Customer",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  new_inquiry: "bg-blue-100 text-blue-800",
  waiting_documents: "bg-yellow-100 text-yellow-800",
  documents_received: "bg-teal-100 text-teal-800",
  audit_in_progress: "bg-purple-100 text-purple-800",
  missing_data: "bg-orange-100 text-orange-800",
  ready_for_review: "bg-indigo-100 text-indigo-800",
  assigned: "bg-cyan-100 text-cyan-800",
  in_progress: "bg-blue-100 text-blue-800",
  waiting_customer: "bg-amber-100 text-amber-800",
  waiting_vendor: "bg-orange-100 text-orange-800",
  quotation_ready: "bg-green-100 text-green-800",
  approved_by_customer: "bg-emerald-100 text-emerald-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
};

const TIMELINE_ICONS: Record<string, string> = {
  whatsapp_received: "💬",
  ai_intent_detected: "🤖",
  task_created: "✨",
  document_uploaded: "📎",
  ocr_completed: "🔍",
  audit_completed: "✅",
  missing_data_requested: "❓",
  customer_submitted_data: "📤",
  task_assigned: "👤",
  progress_updated: "📝",
  whatsapp_sent: "📱",
  admin_approved: "✔️",
  task_completed: "🎉",
  status_changed: "🔄",
  quotation_submitted: "💰",
  trucking_info_added: "🚛",
  token_created: "🔗",
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
  const [showTimeline, setShowTimeline] = useState(false);
  const [showLinkGen, setShowLinkGen] = useState(false);
  const [generatedLinks, setGeneratedLinks] = useState<{ mini?: string; customer?: string }>({});

  // ── Kirim WA dialog ────────────────────────────────────────────────────────
  const [waOpen, setWaOpen]               = useState(false);
  const [waTemplateId, setWaTemplateId]   = useState<string>("konfirmasi_penerimaan");
  const [waMessage, setWaMessage]         = useState("");

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
        return await apiFetch(`/customers/${encodeURIComponent(task.customerPhone)}`);
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

  // ── Timeline query ─────────────────────────────────────────────────────────

  const { data: timeline = [] } = useQuery<{ id: number; eventType: string; title: string; description: string | null; actor: string | null; actorType: string; createdAt: string }[]>({
    queryKey: ["ai-task-timeline", id],
    queryFn: () => apiFetch(`/ai-tasks/${id}/timeline`),
    enabled: showTimeline,
  });

  // ── Generate public link ───────────────────────────────────────────────────

  const generateLinkMutation = useMutation({
    mutationFn: (tokenType: "mini_task" | "customer_data") =>
      apiFetch(`/ai-tasks/${id}/generate-token`, {
        method: "POST",
        body: JSON.stringify({ tokenType, createdBy: "Admin" }),
      }),
    onSuccess: (data: { url: string }, tokenType) => {
      setGeneratedLinks((prev) => ({
        ...prev,
        [tokenType === "mini_task" ? "mini" : "customer"]: data.url,
      }));
      queryClient.invalidateQueries({ queryKey: ["ai-task-timeline", id] });
    },
    onError: () => toast({ title: "Gagal membuat link", variant: "destructive" }),
  });

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Link disalin!" });
  }

  // ── Kirim WA mutation ─────────────────────────────────────────────────────

  const sendWaMutation = useMutation({
    mutationFn: ({ message, templateName }: { message: string; templateName: string }) =>
      apiFetch(`/ai-tasks/${id}/send-wa`, {
        method: "POST",
        body: JSON.stringify({ message, templateName }),
      }),
    onSuccess: () => {
      toast({ title: "✅ Pesan WhatsApp berhasil dikirim" });
      setWaOpen(false);
      setWaMessage("");
      setWaTemplateId("konfirmasi_penerimaan");
    },
    onError: (err) => {
      toast({
        title: "❌ Gagal mengirim WA",
        description: err instanceof Error ? err.message : "Terjadi kesalahan",
        variant: "destructive",
      });
    },
  });

  function openWaDialog() {
    if (!task) return;
    const tpl = WA_TEMPLATES.find((t) => t.id === waTemplateId) ?? WA_TEMPLATES[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setWaMessage(tpl.build(task as any));
    setWaOpen(true);
  }

  function handleTemplateChange(newId: string) {
    setWaTemplateId(newId);
    if (!task) return;
    const tpl = WA_TEMPLATES.find((t) => t.id === newId);
    if (tpl && newId !== "custom") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setWaMessage(tpl.build(task as any));
    } else if (newId === "custom") {
      setWaMessage("");
    }
  }

  // ── Delete attachment ──────────────────────────────────────────────────────

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: number) =>
      apiFetch(`/ai-tasks/${id}/attachments/${attachmentId}`, { method: "DELETE" }),
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
          <SelectTrigger className="w-52 shrink-0">
            <SelectValue>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[task.status] ?? "bg-gray-100 text-gray-700"}`}>
                {AI_TASK_STATUSES[task.status] ?? task.status}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(AI_TASK_STATUSES).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
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

          {/* Kirim WA */}
          {task.customerPhone ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
              </p>
              <p className="text-xs text-green-700 font-mono">{task.customerPhone}</p>
              <Button
                size="sm"
                className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
                onClick={openWaDialog}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Kirim Pesan WA
              </Button>
            </div>
          ) : (
            <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-4 text-center">
              <MessageSquare className="h-6 w-6 text-gray-300 mx-auto mb-1" />
              <p className="text-xs text-gray-400">Belum ada nomor WA customer</p>
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

      {/* ── Generate Public Links ─────────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowLinkGen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
        >
          <span className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Generate Link Publik</span>
          <span className="text-gray-400">{showLinkGen ? "▲" : "▼"}</span>
        </button>
        {showLinkGen && (
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-500">Buat link aman untuk dikirim ke tim (Mini Task) atau customer (Customer Data).</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Mini Task Link */}
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-600">🚛 Mini Task Form (Tim/Vendor)</p>
                <p className="text-xs text-gray-400">Tim/vendor bisa update progress, upload foto, isi info trucking & quotation.</p>
                <Button size="sm" variant="outline" className="w-full text-xs"
                  onClick={() => generateLinkMutation.mutate("mini_task")}
                  disabled={generateLinkMutation.isPending}>
                  {generateLinkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Generate Link
                </Button>
                {generatedLinks.mini && (
                  <div className="bg-blue-50 rounded p-2 flex items-center gap-1">
                    <span className="text-xs text-blue-700 truncate flex-1">{generatedLinks.mini}</span>
                    <button onClick={() => copyToClipboard(generatedLinks.mini!)} className="shrink-0 text-blue-500 hover:text-blue-700">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              {/* Customer Data Link */}
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-600">📋 Customer Data Form</p>
                <p className="text-xs text-gray-400">Customer bisa lihat checklist data yang kurang & upload dokumen.</p>
                <Button size="sm" variant="outline" className="w-full text-xs"
                  onClick={() => generateLinkMutation.mutate("customer_data")}
                  disabled={generateLinkMutation.isPending}>
                  {generateLinkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Generate Link
                </Button>
                {generatedLinks.customer && (
                  <div className="bg-blue-50 rounded p-2 flex items-center gap-1">
                    <span className="text-xs text-blue-700 truncate flex-1">{generatedLinks.customer}</span>
                    <button onClick={() => copyToClipboard(generatedLinks.customer!)} className="shrink-0 text-blue-500 hover:text-blue-700">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-xs text-yellow-800">⚠️ <strong>AI tidak boleh:</strong> approve customs declaration, beri quotation final, konfirmasi izin impor, submit dokumen customs, janji jadwal pengiriman, atau tutup komplain. Semua keputusan final harus ditandai <em>Need Admin Review</em>.</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Dialog Kirim WA ─────────────────────────────────────────────────────── */}
      <Dialog open={waOpen} onOpenChange={(open) => { setWaOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <MessageSquare className="h-5 w-5" />
              Kirim Pesan WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Info penerima */}
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
              <MessageSquare className="h-4 w-4 text-green-600 shrink-0" />
              <div>
                <span className="text-green-800 font-medium">{task?.customerName ?? "Customer"}</span>
                <span className="text-green-600 ml-2 font-mono text-xs">{task?.customerPhone}</span>
              </div>
            </div>

            {/* Pilih template */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Template Pesan</label>
              <Select value={waTemplateId} onValueChange={handleTemplateChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WA_TEMPLATES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Editor pesan */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Isi Pesan</label>
              <Textarea
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                placeholder="Ketik pesan WhatsApp di sini…"
                className="min-h-[180px] text-sm font-mono resize-none leading-relaxed"
              />
              <p className="text-xs text-gray-400 text-right">{waMessage.length} karakter</p>
            </div>

            {/* Preview */}
            {waMessage.trim() && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-600">Preview</p>
                <div className="bg-[#DCF8C6] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-gray-800 whitespace-pre-wrap max-h-[140px] overflow-y-auto shadow-sm border border-green-200">
                  {waMessage}
                </div>
              </div>
            )}

            {/* Warning jika FONNTE belum dikonfigurasi */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              ⚠️ Pesan dikirim via <strong>Fonnte</strong>. Pastikan <code>FONNTE_TOKEN</code> sudah disetel di secrets Replit.
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWaOpen(false)}>
              Batal
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
              disabled={!waMessage.trim() || sendWaMutation.isPending}
              onClick={() => sendWaMutation.mutate({ message: waMessage, templateName: waTemplateId })}
            >
              {sendWaMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</>
                : <><Send className="h-4 w-4" /> Kirim WA</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Task Timeline ─────────────────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowTimeline((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
        >
          <span className="flex items-center gap-2"><History className="h-4 w-4" /> Timeline Aktivitas</span>
          <span className="text-gray-400">{showTimeline ? "▲" : "▼"}</span>
        </button>
        {showTimeline && (
          <div className="p-4">
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-400 italic text-center py-4">Belum ada aktivitas tercatat.</p>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
                <div className="space-y-4 pl-10">
                  {timeline.map((event) => (
                    <div key={event.id} className="relative">
                      <div className="absolute -left-10 w-7 h-7 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center text-sm">
                        {TIMELINE_ICONS[event.eventType] ?? "•"}
                      </div>
                      <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-800">{event.title}</p>
                          <span className="text-xs text-gray-400 shrink-0">
                            {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        {event.description && (
                          <p className="text-xs text-gray-500 mt-1">{event.description}</p>
                        )}
                        {event.actor && (
                          <p className="text-xs text-gray-400 mt-1">
                            oleh <span className="font-medium">{event.actor}</span>
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{event.actorType}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
