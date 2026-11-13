import { useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TaskAuditPanel } from "@/components/task-audit-panel";
import { SlaBadge } from "@/components/sla-badge";
import { OperationalChecklist } from "@/components/operational-checklist";
import { ShipmentTrackingPanel } from "@/components/shipment-tracking";
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
  PhoneOff,
  FlaskConical,
  Brain,
  Shield,
  ChevronRight,
  FileCheck,
  XCircle,
  RefreshCw,
  Eye,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CorrectionDrawer } from "@/components/correction-drawer";
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
import { useAuth } from "@/contexts/auth-context";
import { evaluateGpt02ApprovalReadiness } from "@/lib/gpt02-approval-readiness";

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
  assignedToId?: number | null;
  aiSummary: string | null;
  missingData: string | null;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  comments: Comment[];
  // SLA fields
  slaStatus: string | null;
  slaHours: number | null;
  overdueAt: string | null;
  completedAt: string | null;
  // AI training fields
  aiIntent: string | null;
  aiConfidenceScore: string | null;
  customerId: number | null;
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

interface ExecutionJob {
  id: string;
  taskId: number | null;
  externalId: string;
  correlationId: string;
  commandId: string | null;
  assignedClientId: string | null;
  workerId: string | null;
  status: string;
  progress: number;
  resultSummary: string | null;
  errorMessage: string | null;
  callbackVerified: boolean;
  attestationVerified: boolean;
  finalAckVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ExecutionEvent {
  id: string;
  eventType: string;
  phase: string | null;
  status: string | null;
  message: string | null;
  workerId: string | null;
  signatureVerified: boolean;
  createdAt: string;
}

interface ExecutionPayload {
  execution: ExecutionJob | null;
  events: ExecutionEvent[];
  bridgeConfigured: boolean;
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

// ─── Document Validation Panel (Sprint 9C) ────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  bl_awb: "B/L - AWB",
  hs_code: "HS Code",
  coa: "COA",
  msds: "MSDS",
  damage_photo: "Foto Kerusakan",
  stnk_kir_insurance: "STNK / KIR / Asuransi",
  fuel_receipt: "Struk BBM",
  maintenance_invoice: "Invoice Bengkel",
  cash_advance_receipt: "Kwitansi Kasbon",
};

interface DocAudit {
  id: number;
  documentType: string;
  fileName: string;
  fileUrl: string;
  validationStatus: "valid" | "incomplete" | "invalid" | "needs_review";
  confidenceScore: string;
  missingFields: string[];
  issueSummary: string | null;
  createdAt: string;
}

function DocumentValidationPanel({ taskId }: { taskId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [docType, setDocType] = useState("commercial_invoice");
  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");

  const { data, isLoading, refetch } = useQuery<{ data: DocAudit[] }>({
    queryKey: ["task-doc-audits", taskId],
    queryFn: () =>
      apiFetch(`/documents/audits?taskId=${taskId}&limit=20`),
  });

  const validateMutation = useMutation({
    mutationFn: (payload: { documentType: string; fileName: string; fileUrl: string }) =>
      apiFetch(`/tasks/${taskId}/documents/validate`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast({ title: "Validasi dokumen selesai" });
      void queryClient.invalidateQueries({ queryKey: ["task-doc-audits", taskId] });
      setShowForm(false);
      setFileName("");
      setFileUrl("");
    },
    onError: (e: Error) =>
      toast({ title: "Gagal validasi", description: e.message, variant: "destructive" }),
  });

  const audits = data?.data ?? [];
  const statusIcon = (s: DocAudit["validationStatus"]) => {
    if (s === "valid") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
    if (s === "incomplete") return <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />;
    if (s === "invalid") return <XCircle className="h-3.5 w-3.5 text-red-600" />;
    return <Clock className="h-3.5 w-3.5 text-blue-600" />;
  };
  const statusColor = (s: DocAudit["validationStatus"]) =>
    s === "valid" ? "text-green-700" : s === "incomplete" ? "text-yellow-700" : s === "invalid" ? "text-red-700" : "text-blue-700";

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <FileCheck className="h-4 w-4 text-primary" />
          Validasi Dokumen AI
        </h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => setShowForm(!showForm)}>
            <FileCheck className="h-3 w-3 mr-1" />
            Validasi
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="mb-3 p-3 bg-muted/40 rounded-md space-y-2">
          <div>
            <Label className="text-xs">Tipe Dokumen</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Nama File</Label>
            <Input
              className="h-8 text-xs mt-1"
              placeholder="contoh: invoice_001.pdf"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">URL Dokumen</Label>
            <Input
              className="h-8 text-xs mt-1"
              placeholder="https://..."
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="h-7 text-xs flex-1"
              disabled={validateMutation.isPending || !fileName || !fileUrl}
              onClick={() => validateMutation.mutate({ documentType: docType, fileName, fileUrl })}
            >
              {validateMutation.isPending
                ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Memvalidasi...</>
                : <><FileCheck className="h-3 w-3 mr-1" />Jalankan Validasi</>}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowForm(false)}>Batal</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground text-center py-3">Memuat...</p>
      ) : audits.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3 italic">
          Belum ada dokumen yang divalidasi untuk task ini
        </p>
      ) : (
        <div className="space-y-2">
          {audits.map((a) => (
            <div key={a.id} className="flex items-start gap-2 text-xs p-2 rounded bg-muted/30 border">
              {statusIcon(a.validationStatus)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium ${statusColor(a.validationStatus)}`}>{a.fileName}</span>
                  <span className="text-muted-foreground">{DOC_TYPE_LABELS[a.documentType] ?? a.documentType}</span>
                  <span className="text-muted-foreground">{Math.round(parseFloat(a.confidenceScore) * 100)}% confidence</span>
                </div>
                {a.missingFields.length > 0 && (
                  <p className="text-red-600 mt-0.5">Missing: {a.missingFields.map(f => f.replace(/_/g, " ")).join(", ")}</p>
                )}
                {a.issueSummary && <p className="text-muted-foreground mt-0.5">{a.issueSummary}</p>}
              </div>
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => window.open(a.fileUrl, "_blank")}>
                <Eye className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Customer Memory Panel (Sprint 5A) ────────────────────────────────────────

function CustomerMemoryPanel({ customerId, companyId }: { customerId: number; companyId: string }) {
  const { data: memory } = useQuery<{
    customer: { companyName: string; riskTier: string | null; riskScore: number | null; memoryUpdatedAt: string | null };
    activeRisk: { tier: string; riskScore: number } | null;
    latestSnapshot: { freshnessScore: number; aiContextBlock: string; isStale: boolean; lastNIntents: string[] | null } | null;
    preferences: { category: string; key: string; value: string }[];
  } | null>({
    queryKey: ["customer-memory-panel", customerId],
    queryFn: () => apiFetch(`/crm/customers/${customerId}/memory`).catch(() => null),
  });

  if (!memory) return null;
  const { customer, activeRisk, latestSnapshot } = memory;

  const tierColor: Record<string, string> = { low: "text-green-600", medium: "text-yellow-600", high: "text-orange-600", blocked: "text-red-600" };

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5" /> Memori Customer
        </p>
        <Link href={`/crm/customers/${customerId}/memory`}>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-purple-600 text-xs hover:bg-purple-100">
            Detail <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        </Link>
      </div>

      {activeRisk && (
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <span className={`text-xs font-medium ${tierColor[activeRisk.tier] ?? "text-gray-600"}`}>
            Risk: {activeRisk.tier.toUpperCase()} ({activeRisk.riskScore}/100)
          </span>
        </div>
      )}

      {latestSnapshot && !latestSnapshot.isStale && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-purple-200 rounded-full h-1"><div className="bg-purple-500 h-1 rounded-full" style={{ width: `${latestSnapshot.freshnessScore}%` }} /></div>
            <span className="text-[10px] text-purple-600">{latestSnapshot.freshnessScore}% fresh</span>
          </div>
          {latestSnapshot.lastNIntents && latestSnapshot.lastNIntents.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {latestSnapshot.lastNIntents.slice(0, 3).map((intent, i) => (
                <span key={i} className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded-full">{intent}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {(!latestSnapshot || latestSnapshot.isStale) && (
        <p className="text-[11px] text-purple-500 italic">Snapshot AI belum dibuat. Klik Detail untuk membuat.</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AiTaskDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [comment, setComment] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showWaMessages, setShowWaMessages] = useState(false);
  const [showLinkGen, setShowLinkGen] = useState(false);
  const [generatedLinks, setGeneratedLinks] = useState<{ mini?: string; customer?: string }>({});

  // ── Kirim WA dialog ────────────────────────────────────────────────────────
  const [waOpen, setWaOpen]               = useState(false);
  const [waTemplateId, setWaTemplateId]   = useState<string>("konfirmasi_penerimaan");
  const [waMessage, setWaMessage]         = useState("");

  // ── Kirim ke Grup WA dialog ────────────────────────────────────────────────
  const [waGroupOpen, setWaGroupOpen]     = useState(false);
  const [waGroupJid, setWaGroupJid]       = useState("");
  const [waGroupMessage, setWaGroupMessage] = useState("");

  // ── Koreksi AI drawer ───────────────────────────────────────────────────────
  const [correctionOpen, setCorrectionOpen] = useState(false);

  // ── Task query ─────────────────────────────────────────────────────────────

  const { data: task, isLoading: taskLoading } = useQuery<AiTask>({
    queryKey: ["ai-task", id],
    queryFn: () => apiFetch(`/ai-tasks/${id}`),
    refetchInterval: 30000,
  });

  const { data: executionData, isFetching: executionFetching } = useQuery<ExecutionPayload>({
    queryKey: ["ai-task-execution", id],
    queryFn: () => apiFetch(`/ai-tasks/${id}/execution`),
    refetchInterval: (query) => {
      const status = query.state.data?.execution?.status;
      return status && !["completed", "failed", "cancelled"].includes(status) ? 5_000 : 15_000;
    },
  });

  // DEV-only assignment view for Super Admin. A team-member record is not
  // approval to dispatch GPT02 or proof of native worker completion.
  const gpt02PicPath = `/ai-tasks/${id}/gpt02-pic-options?companyId=${encodeURIComponent(task?.companyId ?? "")}`;
  const { data: gpt02PicOptions, error: gpt02PicError, isFetching: gpt02PicFetching } = useQuery<{
    taskId: number; taskStatus: string; taskAssignmentPresent: boolean;
    assignmentReady: boolean; selectedMemberId: number | null;
    members: {id: number; name: string}[];
    choicesTruncated: boolean; operatorApprovalGranted: false;
    commandDispatched: false;
  }>({
    queryKey: ["gpt02-pic-options", id, task?.companyId],
    queryFn: () => apiFetch(gpt02PicPath),
    enabled: currentUser?.role === "super_admin" && Boolean(task?.companyId),
    retry: false,
    // A verified PIC may be assigned from a separate administrator session.
    refetchInterval: 30_000,
  });
  const { data: gpt02PicAudit, error: gpt02PicAuditError,
    isFetching: gpt02PicAuditFetching } = useQuery<{
      taskId:number; assignedMemberId:number|null; assignedTo:string|null;
      auditPresent:boolean; auditMatchesCurrent:boolean; assignmentAudited:boolean;
      auditId:number|null; actorId:string|null; actorName:string|null;
      assignedAt:string|null; operatorApprovalGranted:false;
      commandDispatched:false; nativeAckVerified:false;
    }>({
    queryKey:["gpt02-pic-audit",id,task?.companyId],
    queryFn:()=>apiFetch(`/ai-tasks/${id}/gpt02-pic-audit?companyId=${encodeURIComponent(task?.companyId ?? "")}`),
    enabled:currentUser?.role==="super_admin" && Boolean(task?.companyId),
    retry:false,
    refetchInterval:30_000,
  });
  const {data:gpt02Lineage,error:gpt02LineageError,isFetching:gpt02LineageFetching,
    refetch:refreshGpt02Lineage} = useQuery<{
      taskId:number; executionId:string|null; commandId:string|null;
      executionStatus:string|null; coreStatus:string|null;
      coreCommandMatched:boolean; coreTaskIdPresent:boolean;
      attestationVerified:boolean; finalAckVerified:boolean;
      bindingSchemaReady:boolean; diagnosticReasons:string[];
      executionOutcome?: { verified:boolean; status:string; route:string; responseId:string|null; acknowledgedAt:string|null; grantsAuthority:false; readOnly:true };
      nativeLineageAttested:false; dispatchPermitted:false; resumePermitted:false;
      completionPermitted:false; readOnly:true;
    }>({
    queryKey:["gpt02-lineage",id,task?.companyId],
    queryFn:()=>apiFetch(`/ai-tasks/${id}/gpt02-lineage?companyId=${encodeURIComponent(task?.companyId ?? "")}`),
    enabled:currentUser?.role==="super_admin" && Boolean(task?.companyId),
    retry:false,
  });
  const gpt02AssignPicMutation = useMutation({
    mutationFn: (memberId: number) => apiFetch(
      `/ai-tasks/${id}/gpt02-assign-pic?companyId=${encodeURIComponent(task?.companyId ?? "")}`,
      { method: "POST", body: JSON.stringify({ memberId }) }),
    onSuccess: () => {
      toast({title:"PIC GPT02 dicatat",description:"Identitas anggota tim aktif cocok; otorisasi runtime masih perlu diverifikasi."});
      void queryClient.invalidateQueries({queryKey:["ai-task",id]});
      void queryClient.invalidateQueries({queryKey:["ai-tasks"]});
      void queryClient.invalidateQueries({queryKey:["gpt02-pic-options",id]});
      void queryClient.invalidateQueries({queryKey:["gpt02-pic-audit",id]});
    },
    onError: (err: Error) => toast({title:"Gagal menetapkan PIC GPT02",description:err.message,variant:"destructive"}),
  });

  const [reconciliationRequested, setReconciliationRequested] = useState(false);
  const { data: reconciliation, isFetching: reconciliationFetching, error: reconciliationError, refetch: checkReconciliation } = useQuery<{
    status: string; matchCount: number; uniqueCommandMatch: boolean; commandId: string | null;
    callbackVerified: boolean; attestationVerified: boolean; finalAckVerified: boolean;
    archiveAvailable: boolean; automaticDispatch: boolean; statusChanged: boolean;
  }>({
    queryKey: ["gpt02-reconciliation", id],
    queryFn: () => apiFetch(`/ai-tasks/${id}/gpt02-reconciliation?companyId=${encodeURIComponent(task?.companyId ?? "")}`),
    enabled: reconciliationRequested && Boolean(task?.companyId),
    retry: false,
    staleTime: 0,
  });

  const { data: recoveryReview, isFetching: recoveryReviewFetching } = useQuery<{
    executionId: string | null; executionStatus: string | null;
    eligibleForHumanReview: boolean; verifiedContinuationCheckpoint: boolean;
    resumeAuthorized: false; originalError: string | null;
    picName: string | null; picAccountVerified: false;
    humanTask: { id: number; task_code: string; status: string; assigned_user: string | null;
      failure_code?: string | null; send_attempt_recorded?: string | null;
      assistant_ack_verified?: string | null; openclaw_attempt_verified?: string | null;
      signed_checkpoint_count?: string | null; } | null;
    nextAction: string;
  }>({
    queryKey: ["ai-task-recovery-review", id],
    queryFn: () => apiFetch(`/ai-tasks/${id}/recovery-review`),
    enabled: executionData?.execution?.status?.toLowerCase() === "failed",
    retry: false,
    refetchInterval: 30_000,
  });

  // A failed historical execution may confirm its existing PIC only through
  // the accepted human review. No new attempt, grant, or worker dispatch.
  const gpt02RecoveryPicMutation = useMutation({
    mutationFn: ({memberId,reviewId}:{memberId:number;reviewId:number}) =>
      apiFetch(`/ai-tasks/${id}/gpt02-confirm-recovery-pic?companyId=${encodeURIComponent(task?.companyId ?? "")}`,
        {method:"POST",body:JSON.stringify({memberId,reviewId})}),
    onSuccess: () => {
      toast({title:"PIC recovery dikonfirmasi",
        description:"Identitas PIC dicatat bersama audit. Job gagal tetap gagal; persetujuan dan pengiriman ulang tidak diberikan."});
      void queryClient.invalidateQueries({queryKey:["ai-task",id]});
      void queryClient.invalidateQueries({queryKey:["ai-tasks"]});
      void queryClient.invalidateQueries({queryKey:["gpt02-pic-options",id]});
      void queryClient.invalidateQueries({queryKey:["gpt02-pic-audit",id]});
      void queryClient.invalidateQueries({queryKey:["gpt02-lineage",id]});
    },
    onError: (err:Error) => toast({title:"Konfirmasi PIC recovery ditolak",
      description:err.message,variant:"destructive"}),
  });
  const humanReviewMutation = useMutation({
    mutationFn: () => apiFetch(`/ai-tasks/${id}/human-review`, {method:"POST",body:JSON.stringify({})}),
    onSuccess: () => {
      toast({title:"Review Human dicatat",description:"Menunggu administrator menetapkan Human yang memiliki akun terverifikasi. Resume GPT02 masih dikunci."});
      void queryClient.invalidateQueries({queryKey:["ai-task-recovery-review",id]});
    },
    onError: (err:Error) => toast({title:"Gagal membuat review Human",description:err.message,variant:"destructive"}),
  });

  const startExecutionMutation = useMutation({
    mutationFn: (mode: "worker" | "chatgpt") =>
      apiFetch(`/ai-tasks/${id}/execution`, {
        method: "POST",
        body: JSON.stringify(mode === "chatgpt"
          ? { mode: "chatgpt", accountAlias: "GPT02", lifecycleStart: true }
          : { mode: "worker" }),
      }),
    onSuccess: (_data, mode) => {
      toast({ title: mode === "chatgpt" ? "Permintaan lifecycle GPT02 dicatat di AI Core DEV" : "Execution dikirim ke worker AI Core DEV", description: "Pantau ACK dan checkpoint; status bisnis tidak otomatis menjadi RUNNING." });
      void queryClient.invalidateQueries({ queryKey: ["ai-task-execution", id] });
    },
    onError: (err: Error) => {
      toast({ title: "Execution gagal dimulai", description: err.message, variant: "destructive" });
    },
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

  // ── Team members query ─────────────────────────────────────────────────────

  const { data: teamMembers = [] } = useQuery<{ id: number; name: string; role: string | null; phone: string | null }[]>({
    queryKey: ["team-members"],
    queryFn: () => apiFetch("/team"),
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

  // ── Update assignee ────────────────────────────────────────────────────────

  const assigneeMutation = useMutation({
    mutationFn: (assignedTo: string | null) =>
      apiFetch(`/ai-tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedTo: assignedTo ?? "" }),
      }),
    onSuccess: (_data, assignedTo) => {
      queryClient.invalidateQueries({ queryKey: ["ai-task", id] });
      queryClient.invalidateQueries({ queryKey: ["ai-tasks"] });
      const member = teamMembers.find((m) => m.name === assignedTo);
      if (assignedTo && member && !member.phone) {
        toast({
          title: "Assignee diubah — WA tidak dikirim",
          description: `${assignedTo} belum memiliki nomor HP. Tambahkan di halaman Tim agar notifikasi WA bisa dikirim.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Assignee berhasil diubah", description: assignedTo ? `Notifikasi WA dikirim ke ${assignedTo}` : undefined });
      }
    },
    onError: () => toast({ title: "Gagal mengubah assignee", variant: "destructive" }),
  });

  // ── Timeline query ─────────────────────────────────────────────────────────

  // ── WA messages linked to this task ───────────────────────────────────────
  const { data: waMessages = [], isLoading: waMessagesLoading } = useQuery<{
    id: number; from: string; senderName: string | null; senderPhone: string | null;
    body: string; messageText: string | null; messageType: string; direction: string;
    detectedIntent: string | null; attachmentUrl: string | null; createdAt: string;
  }[]>({
    queryKey: ["ai-task-wa-messages", id],
    queryFn: () => apiFetch(`/ai-tasks/${id}/messages`),
    enabled: showWaMessages,
  });

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

  // ── Kirim ke Grup WA mutation ──────────────────────────────────────────────

  const sendWaGroupMutation = useMutation({
    mutationFn: ({ groupJid, message }: { groupJid: string; message: string }) =>
      apiFetch("/whatsapp/send-group", {
        method: "POST",
        body: JSON.stringify({
          groupJid,
          message,
          taskId: task?.id,
          companyId: task?.companyId ?? "default",
        }),
      }),
    onSuccess: () => {
      toast({ title: "✅ Pesan berhasil dikirim ke Grup WA" });
      setWaGroupOpen(false);
      setWaGroupJid("");
      setWaGroupMessage("");
    },
    onError: (err) => {
      toast({
        title: "❌ Gagal kirim ke Grup WA",
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
        <p className="text-gray-600 mb-4">Task tidak ditemukan. Task mungkin sudah dihapus atau belum tersedia untuk akun ini.</p>
        <div className="flex gap-2 justify-center">
          <Link href="/ai-tasks">
            <Button variant="outline">Kembali ke Board</Button>
          </Link>
          <Link href="/messages">
            <Button variant="outline">Kembali ke Pesan</Button>
          </Link>
        </div>
      </div>
    );
  }

  const missingDataKeys: string[] = (() => {
    try { return JSON.parse(task.missingData ?? "[]"); } catch { return []; }
  })();
  const operatorReadiness = evaluateGpt02ApprovalReadiness({
    assignmentReady: gpt02PicOptions?.assignmentReady,
    auditMatchesCurrent: gpt02PicAudit?.auditMatchesCurrent,
    executionId: gpt02Lineage?.executionId,
    coreTaskIdPresent: gpt02Lineage?.coreTaskIdPresent,
    coreCommandMatched: gpt02Lineage?.coreCommandMatched,
    bindingSchemaReady: gpt02Lineage?.bindingSchemaReady,
    diagnosticReasons: gpt02Lineage?.diagnosticReasons,
  });

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
            {task.slaStatus && (
              <SlaBadge
                slaStatus={task.slaStatus}
                overdueAt={task.overdueAt}
                completedAt={task.completedAt}
                slaHours={task.slaHours}
              />
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

        <div className="flex items-center gap-2 shrink-0">
          {/* Koreksi AI button */}
          <Button
            variant="outline"
            size="sm"
            className="text-orange-600 border-orange-200 hover:bg-orange-50 text-xs"
            onClick={() => setCorrectionOpen(true)}
          >
            <FlaskConical className="h-3.5 w-3.5 mr-1" />
            Koreksi AI
          </Button>

          {/* Status picker */}
          <Select value={task.status} onValueChange={(v) => statusMutation.mutate(v)}>
            <SelectTrigger className="w-48">
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
      </div>

      <div id="penugasan-lifecycle" className="border border-blue-200 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Intake → Penugasan → Lifecycle</p>
            <h2 className="mt-1 text-base font-semibold text-gray-900">Penugasan & Lifecycle AI Core</h2>
            <p className="mt-1 text-xs text-gray-500">
              Progress ini berasal dari execution ledger dan event AI Core, bukan hanya status bisnis task.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={executionFetching || gpt02PicFetching || gpt02PicAuditFetching || gpt02LineageFetching}
              onClick={() => {
                // Sync all related readbacks, not execution alone.
                void Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["ai-task", id] }),
                  queryClient.invalidateQueries({ queryKey: ["ai-task-execution", id] }),
                  queryClient.invalidateQueries({ queryKey: ["gpt02-pic-options", id] }),
                  queryClient.invalidateQueries({ queryKey: ["gpt02-pic-audit", id] }),
                  queryClient.invalidateQueries({ queryKey: ["gpt02-lineage", id] }),
                ]);
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${executionFetching ? "animate-spin" : ""}`} />
              Sync
            </Button>
            {!executionData?.execution && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!executionData?.bridgeConfigured || startExecutionMutation.isPending ||
                    (currentUser?.role === "super_admin" &&
                      (gpt02PicAuditFetching || !gpt02PicAudit || gpt02PicAudit.auditPresent))}
                  onClick={() => startExecutionMutation.mutate("worker")}
                  aria-label={gpt02PicAudit?.auditPresent
                    ? "Run Worker dinonaktifkan: task memiliki audit PIC GPT02; jalur GPT01 fallback tidak diizinkan"
                    : "Run Worker"}
                >
                  {startExecutionMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  Run Worker
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="opacity-60 cursor-not-allowed"
                  disabled={true}
                  aria-label="Lifecycle GPT02 DEV belum aktif karena bukti sebelum pengiriman belum lengkap"
                >
                  {startExecutionMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Brain className="h-3.5 w-3.5 mr-1" />}
                  Mulai Lifecycle GPT02 (belum diaktifkan)
                </Button>
              </>
            )}
          </div>
        </div>
        {!executionData?.execution && gpt02PicAudit?.auditPresent && (
          <p role="status" className="mt-2 text-xs text-amber-700">
            Run Worker dikunci untuk task dengan audit PIC GPT02. Jalur GPT01 tidak boleh menggantikan lifecycle GPT02 yang memerlukan otorisasi dan bukti sebelum dispatch.
          </p>
        )}
        {!executionData?.execution && (
          <p role="status" className="mt-2 text-xs text-amber-700">
            Mode lifecycle GPT02 DEV belum dapat dijalankan: Core Task, persetujuan bertanda tangan, pengikatan percobaan, nonce dan pengaman lease harus terbukti sebelum pengiriman. Hasil uji teks lama tidak diulang.
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
          <div>
            <Label className="text-xs text-slate-600">Penanggung jawab (PIC Human)</Label>
            {currentUser?.role === "super_admin" ? (
              <>
                <Select
                  value={gpt02PicOptions?.selectedMemberId ? String(gpt02PicOptions.selectedMemberId) : "__none__"}
                  onValueChange={(value) => {
                    const memberId = Number(value);
                    if (Number.isSafeInteger(memberId) && memberId > 0) {
                      const reviewId=recoveryReview?.humanTask?.id;
                      if (executionData?.execution?.status?.toLowerCase()==="failed" &&
                          recoveryReview?.humanTask?.status==="accepted" &&
                          typeof reviewId==="number" && Number.isSafeInteger(reviewId)) {
                        if (window.confirm("Konfirmasi anggota tim ID " + memberId +
                            " sebagai PIC pada review gagal ini? Hanya pencatatan dan audit PIC. Tidak ada persetujuan operator, restart, atau pengiriman command.")) {
                          gpt02RecoveryPicMutation.mutate({memberId,reviewId});
                        }
                      } else gpt02AssignPicMutation.mutate(memberId);
                    }
                  }}
                  disabled={gpt02PicFetching || !!gpt02PicError || gpt02AssignPicMutation.isPending ||
                    gpt02RecoveryPicMutation.isPending ||
                    (Boolean(executionData?.execution) &&
                      !(executionData?.execution?.status?.toLowerCase()==="failed" &&
                        recoveryReview?.humanTask?.status==="accepted" &&
                        !gpt02PicOptions?.assignmentReady)) ||
                    ["completed","cancelled"].includes(task.status)}>
                  <SelectTrigger className="mt-1 bg-white"><SelectValue placeholder="Pilih PIC aktif" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" disabled>Belum terverifikasi</SelectItem>
                    {(gpt02PicOptions?.members ?? []).map(member =>
                      <SelectItem key={member.id} value={String(member.id)}>{member.name} (ID {member.id})</SelectItem>)}
                  </SelectContent>
                </Select>
                {executionData?.execution?.status?.toLowerCase()==="failed" &&
                  recoveryReview?.humanTask?.status==="accepted" &&
                  !gpt02PicOptions?.assignmentReady && (
                  <p role="status" className="mt-1 text-xs text-amber-700">
                    Konfirmasi PIC untuk Human Review yang diterima. Ini hanya menautkan ID anggota dan audit;
                    Job lama tetap FAILED dan penerbitan attempt baru tetap terkunci.
                  </p>
                )}
                {gpt02PicError && <p role="alert" className="mt-1 text-xs text-red-700">Daftar PIC tidak tersedia. Periksa akses Super Admin DEV.</p>}
                {gpt02PicOptions?.choicesTruncated && <p className="mt-1 text-xs text-amber-700">Daftar dibatasi 100 anggota; pilihan lain memerlukan pemeriksaan admin.</p>}
                <p className="mt-1 text-xs text-slate-600">
                  {gpt02PicOptions?.assignmentReady ? "PIC aktif terhubung berdasarkan ID." :
                    "PIC belum diverifikasi berdasarkan ID dan perusahaan."}
                </p>
                <p role="status" className="mt-1 text-xs text-slate-600">
                  {gpt02PicAuditFetching ? "Memeriksa catatan audit PIC..." :
                    gpt02PicAuditError ? "Audit PIC tidak tersedia; lifecycle GPT02 ditahan." :
                    gpt02PicAudit?.auditMatchesCurrent ?
                      `Audit PIC cocok — ${gpt02PicAudit.actorName ?? "Super Admin"} (${gpt02PicAudit.assignedAt ? new Date(gpt02PicAudit.assignedAt).toLocaleString("id-ID") : "waktu tidak tersedia"}).` :
                      "Belum ada audit PIC yang cocok dengan penugasan saat ini."}
                </p>
              </>
            ) : (
              <div className="mt-1 rounded-md border bg-white p-2 text-sm">
                {task.assignedTo ?? "Belum ditetapkan"} — penugasan GPT02 oleh Super Admin
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs text-slate-600">Pelaksana utama</Label>
            <div className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900">GPT02 — AI Core DEV</div>
            <p className="mt-1 text-xs text-slate-500">Ketersediaan/ACK harus dibuktikan melalui execution ledger.</p>
          </div>
          <div>
            <Label className="text-xs text-slate-600">Tahapan lifecycle</Label>
            <div className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
              {executionData?.execution ? `Execution: ${executionData.execution.status}` : gpt02PicOptions?.assignmentReady ? "PIC terhubung; izin runtime belum terverifikasi" : "Menunggu verifikasi PIC"}
            </div>
            <p className="mt-1 text-xs text-slate-500">Tidak mengubah status bisnis sebelum bukti worker tersedia.</p>
          </div>
        </div>
        {!gpt02PicOptions?.assignmentReady && <p role="status" className="mt-2 text-xs text-amber-700">Tentukan PIC aktif berdasarkan ID melalui Super Admin DEV. Nama saja tidak mengizinkan lifecycle GPT02.</p>}
        {gpt02PicOptions?.assignmentReady && !gpt02PicAudit?.auditMatchesCurrent && <p role="status" className="mt-2 text-xs text-amber-700">Audit PIC belum cocok. Tidak mengizinkan lifecycle GPT02 sampai bukti penugasan dapat dibaca kembali.</p>}
        {currentUser?.role === "super_admin" && (
          <section data-testid="gpt02-operator-readiness" aria-label="Kesiapan persetujuan operator GPT02"
            className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">Kesiapan persetujuan operator GPT02 — baca-saja</h3>
              <span className="font-semibold text-amber-800">NO-GO · belum ada izin dispatch</span>
            </div>
            <p className="text-slate-600">
              Status di bawah berasal dari bukti PIC dan lineage dalam API AI Task.
              Service signer aktif bukan bukti persetujuan per-command. Pemeriksaan ini tidak menerbitkan approval.
            </p>
            <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-live="polite">
              {operatorReadiness.steps.map((step) => (
                <li key={step.id} className="rounded-md border border-slate-200 p-2">
                  <p className="font-medium text-slate-800">{step.label}</p>
                  <p className={step.state === "verified" ? "text-emerald-700" : "text-amber-800"}>
                    {step.state === "verified" ? "Bukti tersedia" :
                     step.state === "missing" ? "Belum lengkap" : "Belum dapat diverifikasi di UI"}
                  </p>
                  <p className="text-slate-600">{step.detail}</p>
                </li>
              ))}
            </ol>
            <Button type="button" variant="outline" size="sm" disabled={true}
              aria-label="Persetujuan operator GPT02 belum diaktifkan; perlu otorisasi bertanda tangan dan issuer independen">
              Persetujuan operator (belum diaktifkan)
            </Button>
            <p role="status" className="text-amber-800">
              Penyiapan permintaan resmi memerlukan sumber bukti Hub/Core yang terikat pada attempt,
              otentikasi Super Admin dan issuer yang sah. Jangan memasukkan private key atau token ke halaman ini.
              Tidak ada command, nonce, atau lease yang diterbitkan dari panel ini.
            </p>
          </section>
        )}
        {currentUser?.role==="super_admin" && (
          <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">Diagnostik lineage GPT02 — baca-saja</span>
              <Button variant="outline" size="sm" onClick={()=>{void refreshGpt02Lineage();}}
                disabled={gpt02LineageFetching}>Periksa ulang bukti</Button>
            </div>
            {gpt02LineageError && <p role="alert" className="text-red-700">
              Diagnostik tidak tersedia. Status NO-GO tetap berlaku.
            </p>}
            {gpt02Lineage && (
              <div role="status" className="space-y-1 text-slate-700">
                <p>Task #{gpt02Lineage.taskId} · Eksekusi: {gpt02Lineage.executionStatus ?? "Belum ada"} · AI Core: {gpt02Lineage.coreStatus ?? "Belum terhubung"}</p>
                <p className="break-all">Attempt: {gpt02Lineage.executionId ?? "Belum ada"}</p>
                <p className="break-all">Command: {gpt02Lineage.commandId ?? "Belum ada"}</p>
                <p>Core command cocok: {gpt02Lineage.coreCommandMatched ? "Ya" : "Tidak"} · Core Task ID: {gpt02Lineage.coreTaskIdPresent ? "Ada" : "Belum ada"}</p>
                <p>Binding schema: {gpt02Lineage.bindingSchemaReady ? "Ada" : "Belum tersedia"} · Attestation: {gpt02Lineage.attestationVerified ? "Tercatat" : "Belum"} · Final ACK: {gpt02Lineage.finalAckVerified ? "Tercatat" : "Belum"}</p>
                <p className="font-medium">Hasil eksekusi: {gpt02Lineage.executionOutcome?.verified === true ? "Selesai — respons native dan ACK akhir cocok dengan command ini." : "Bukti lengkap hasil eksekusi belum terverifikasi."}</p>
                {gpt02Lineage.executionOutcome?.route === "direct_chatgpt_command" && !gpt02Lineage.coreTaskIdPresent && <p>Jalur uji ini membuat command ChatGPT langsung, bukan Core coding task. Pencatatan lifecycle tetap belum lengkap.</p>}
                <p className="font-medium text-amber-800">Pencatatan lifecycle — NO-GO: {gpt02Lineage.diagnosticReasons.length ? gpt02Lineage.diagnosticReasons.join(", ") : "Verifikasi native independen tetap diperlukan"}</p>
                {gpt02PicOptions?.assignmentReady && gpt02PicAudit?.auditMatchesCurrent &&
                  gpt02Lineage.diagnosticReasons.includes("PIC_ID_NOT_BOUND") && (
                    <p className="text-amber-800">PIC Human telah diverifikasi pada task, namun belum ada binding PIC ke percobaan eksekusi/Core yang dapat dibuktikan. PIC_ID_NOT_BOUND pada diagnostik lifecycle tidak membatalkan penugasan PIC yang sudah diaudit.</p>
                  )}
                <p>Hasil eksekusi dan kelengkapan lifecycle dinilai terpisah. Pemeriksaan ini bukan persetujuan operator, izin resume, atau penutupan bisnis; tidak memberi izin menjalankan ulang.</p>
              </div>
            )}
          </div>
        )}
        {!executionData?.bridgeConfigured && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            AI Core DEV bridge belum dikonfigurasi pada runtime AI Task.
          </div>
        )}

        {executionData?.execution && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3 text-xs">
            <Button variant="default" size="sm" disabled={reconciliationFetching}
              className="bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-300 disabled:text-white font-semibold shadow-sm"
              onClick={() => { setReconciliationRequested(true); if (reconciliationRequested) void checkReconciliation(); }}>
              {reconciliationFetching ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Shield className="mr-2 h-3.5 w-3.5" />}
              Periksa Rekonsiliasi GPT02 (baca-saja)
            </Button>
            {reconciliationError && <p role="alert" className="mt-2 text-red-700">Tidak dapat membaca rekonsiliasi: {String(reconciliationError)}</p>}
            {reconciliation && <div className="mt-3 space-y-2 rounded-lg border border-slate-300 bg-white p-3 text-sm font-medium text-slate-900" aria-live="polite">
              <p>Status job: {reconciliation.status}; kecocokan unik: {reconciliation.uniqueCommandMatch ? "Ya" : "Tidak"}; jumlah padanan: {reconciliation.matchCount}</p>
              <p className="break-all font-mono text-slate-900">Command ID: {reconciliation.commandId ?? "Belum terkonfirmasi"}</p>
              <p>Callback: {reconciliation.callbackVerified ? "Verified" : "Belum"} · Attestation: {reconciliation.attestationVerified ? "Verified" : "Belum"} · Final ACK: {reconciliation.finalAckVerified ? "Verified" : "Belum"}</p>
              <p>Arsip tersedia: {reconciliation.archiveAvailable ? "Ya" : "Tidak"} · Dispatch otomatis: Tidak · Perubahan status: Tidak</p>
            </div>}
          </div>
        )}

        {executionData?.execution ? (
          <div className="mt-4 space-y-4">
            {executionData.execution.status.toLowerCase() === "failed" && (
              <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                <strong>Lifecycle GPT02 gagal — pekerjaan belum selesai.</strong>
                <p className="mt-1">{executionData.execution.errorMessage || "Tidak ada respons worker yang terverifikasi."}</p>
                <p className="mt-1 text-xs">Jangan mengirim ulang command secara manual. Gunakan Periksa Rekonsiliasi GPT02 (baca-saja) sebelum pemulihan terotorisasi.</p>
                {recoveryReviewFetching && !recoveryReview && <p className="mt-2 text-xs">Memeriksa kesiapan review pemulihan…</p>}
                {recoveryReview?.humanTask ? (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-white p-3 text-xs">
                    <p className="font-semibold">Human Review: {recoveryReview.humanTask.task_code}</p>
                    <p>Status: {recoveryReview.humanTask.status} · Penugas: {recoveryReview.humanTask.assigned_user || "Belum ditetapkan (Administrator)"}</p>
                    <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 space-y-1">
                      <p className="font-semibold">Bukti diagnosis untuk reviewer</p>
                      <p>Kode kegagalan: {recoveryReview.humanTask.failure_code || "Belum dilampirkan"}</p>
                      <p>Pengiriman native: {recoveryReview.humanTask.send_attempt_recorded === "true" ? "Ada catatan percobaan" : "Belum terbukti"}</p>
                      <p>ACK asisten: {recoveryReview.humanTask.assistant_ack_verified === "true" ? "Terverifikasi" : "Belum terverifikasi"}</p>
                      <p>OpenClaw membantu: {recoveryReview.humanTask.openclaw_attempt_verified === "true" ? "Ada bukti" : "Belum ada bukti"}</p>
                      <p>Checkpoint bertanda tangan: {recoveryReview.humanTask.signed_checkpoint_count || "0"}</p>
                    </div>
                    <p className="mt-2">GPT02 tidak boleh di-resume sampai bukti checkpoint, ACK, lease, dan otorisasi diperiksa.</p>
                    <a className="mt-2 inline-block font-semibold text-blue-700 underline" href="https://dev.cstlogistic.co.id/human-tasks" target="_blank" rel="noopener noreferrer">Buka Human Tasks (reviewer)</a>
                  </div>
                ) : recoveryReview?.eligibleForHumanReview ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-white p-3 text-xs">
                    <p>Checkpoint terverifikasi: Tidak · Resume otomatis: Ditolak · PIC {recoveryReview.picName || "belum ditetapkan"} belum terhubung ke akun Human terverifikasi.</p>
                    <p>OpenClaw belum terbukti menangani hambatan ini. Permintaan berikut adalah peninjauan, bukan klaim bahwa OpenClaw gagal.</p>
                    <Button variant="outline" size="sm" disabled={humanReviewMutation.isPending} onClick={() => {
                      if (window.confirm("Buat Human Review untuk kegagalan GPT02? Tugas menunggu penetapan Administrator. Tidak ada dispatch ulang atau resume.")) humanReviewMutation.mutate();
                    }}>{humanReviewMutation.isPending ? "Mencatat…" : "Ajukan Review Human (tanpa resume)"}</Button>
                  </div>
                ) : recoveryReview?.verifiedContinuationCheckpoint ? (
                  <p className="mt-2 text-xs">Checkpoint tersedia, tetapi resume hanya boleh dipertimbangkan melalui otorisasi resmi.</p>
                ) : null}
              </div>
            )}
            {executionData.execution.status.toLowerCase() === "completed" &&
              !(executionData.execution.callbackVerified && executionData.execution.attestationVerified && executionData.execution.finalAckVerified) && (
              <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Status COMPLETED belum berarti PASS. Callback, attestation, dan final ACK harus terverifikasi.</p>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-[10px] uppercase text-gray-400">Status</p>
                <p className="mt-1 text-sm font-semibold capitalize text-gray-800">{executionData.execution.status}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-[10px] uppercase text-gray-400">Tahap execution (bukan progres proyek)</p>
                <p className="mt-1 text-sm font-semibold text-gray-800">{executionData.execution.status.toLowerCase() === "failed" ? "GAGAL — bukan 100% selesai" : `${executionData.execution.progress}% ledger`}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-[10px] uppercase text-gray-400">Worker</p>
                <p className="mt-1 truncate text-sm font-semibold text-gray-800">{executionData.execution.workerId ?? executionData.execution.assignedClientId ?? "Routing AI Core"}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-[10px] uppercase text-gray-400">Command</p>
                <p className="mt-1 truncate font-mono text-[11px] text-gray-700">{executionData.execution.commandId ?? "menunggu ACK"}</p>
              </div>
            </div>

            <div>
              <div className="mb-1 flex justify-between text-[11px] text-gray-500">
                <span>{executionData.execution.externalId}</span>
                <span>{executionData.execution.status.toLowerCase() === "failed" ? "Execution gagal" : `${executionData.execution.progress}% tahap ledger`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                {executionData.execution.status.toLowerCase() !== "failed" && <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${executionData.execution.progress}%` }} />}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                ["Callback", executionData.execution.callbackVerified],
                ["Attestation", executionData.execution.attestationVerified],
                ["Final ACK", executionData.execution.finalAckVerified],
              ].map(([label, verified]) => (
                <div key={String(label)} className={`rounded-lg border px-3 py-2 text-center ${verified ? "border-green-200 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
                  <p className={`text-xs font-semibold ${verified ? "text-green-700" : "text-gray-500"}`}>
                    {verified ? "✓ " : "○ "}{label}
                  </p>
                </div>
              ))}
            </div>

            {executionData.execution.errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {executionData.execution.errorMessage}
              </div>
            )}
            {executionData.execution.resultSummary && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                {executionData.execution.resultSummary}
              </div>
            )}

            <div className="max-h-48 space-y-2 overflow-y-auto">
              {executionData.events.slice().reverse().map((event) => (
                <div key={event.id} className="flex items-start gap-2 rounded-lg border border-gray-100 px-3 py-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-700">{event.eventType}</span>
                      <span className="text-[10px] text-gray-400">{formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}</span>
                    </div>
                    {event.message && <p className="mt-0.5 text-xs text-gray-500">{event.message}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-gray-200 p-5 text-center text-xs text-gray-500">
            {gpt02PicAudit?.auditMatchesCurrent
              ? "Belum ada execution. Penugasan PIC sudah diaudit, tetapi Run Worker via GPT01 tidak diizinkan. Lifecycle GPT02 masih NO-GO sampai seluruh bukti resmi lengkap."
              : "Belum ada execution. Run Worker hanya untuk alur non-GPT02 yang terotorisasi; jalur GPT02 harus memenuhi gate otorisasi dan bukti E2E sebelum dispatch."}
          </div>
        )}
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

          {/* Memori Customer (Sprint 5A) */}
          {task.customerId && (
            <CustomerMemoryPanel customerId={task.customerId} companyId={task.companyId ?? "default"} />
          )}

          {/* Kirim WA */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
            </p>
            {task.customerPhone ? (
              <>
                <p className="text-xs text-green-700 font-mono">{task.customerPhone}</p>
                <Button
                  size="sm"
                  className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
                  onClick={openWaDialog}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Kirim ke Customer
                </Button>
              </>
            ) : (
              <p className="text-xs text-gray-400 italic">Belum ada nomor WA customer</p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full border-green-300 text-green-700 hover:bg-green-100 gap-2"
              onClick={() => setWaGroupOpen(true)}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Kirim ke Grup WA
            </Button>
          </div>

          {/* Document Validation Panel */}
          <DocumentValidationPanel taskId={Number(id)} />

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
            <div className="flex justify-between items-start gap-2">
              <span className="text-gray-500 pt-1">Assignee</span>
              <div className="flex flex-col items-end gap-1">
                <Select
                  value={task.assignedTo ?? "__none__"}
                  onValueChange={(v) => assigneeMutation.mutate(v === "__none__" ? null : v)}
                  disabled={assigneeMutation.isPending}
                >
                  <SelectTrigger className="w-36 h-7 text-xs">
                    <SelectValue placeholder="Belum ditugaskan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-gray-400 italic">Belum ditugaskan</span>
                    </SelectItem>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.name}>
                        <span className="flex items-center gap-1.5">
                          {m.name}
                          {!m.phone && (
                            <PhoneOff className="h-3 w-3 text-amber-500" />
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {task.assignedTo && !teamMembers.find((m) => m.name === task.assignedTo)?.phone && teamMembers.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                    <PhoneOff className="h-3 w-3" />
                    WA tidak akan dikirim — no HP kosong
                  </span>
                )}
              </div>
            </div>
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
              ⚠️ Pesan dikirim via <strong>Fonnte</strong>. Pastikan <code>FONNTE_TOKEN</code> sudah disetel di environment server.
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

      {/* ── Dialog Kirim ke Grup WA ──────────────────────────────────────────── */}
      <Dialog open={waGroupOpen} onOpenChange={setWaGroupOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <MessageSquare className="h-5 w-5" />
              Kirim ke Grup WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Info task */}
            {task && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
                <MessageSquare className="h-4 w-4 text-green-600 shrink-0" />
                <div>
                  <span className="text-green-800 font-medium">{task.taskNumber ?? "Task"}</span>
                  <span className="text-green-600 ml-2 text-xs">{task.title}</span>
                </div>
              </div>
            )}

            {/* Group JID input */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">
                Group JID (contoh: 6281234567890-1234567890@g.us)
              </Label>
              <Input
                value={waGroupJid}
                onChange={(e) => setWaGroupJid(e.target.value)}
                placeholder="628xxxxxxxxxx-xxxxxxxxxx@g.us"
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-gray-400">
                Dapatkan Group JID dari log Fonnte webhook saat ada pesan masuk dari grup tersebut.
              </p>
            </div>

            {/* Editor pesan */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Isi Pesan</Label>
              <Textarea
                value={waGroupMessage}
                onChange={(e) => setWaGroupMessage(e.target.value)}
                placeholder="Ketik pesan untuk grup WhatsApp di sini…"
                className="min-h-[160px] text-sm font-mono resize-none leading-relaxed"
              />
              <p className="text-xs text-gray-400 text-right">{waGroupMessage.length} karakter</p>
            </div>

            {/* Preview */}
            {waGroupMessage.trim() && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-600">Preview</p>
                <div className="bg-[#DCF8C6] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-gray-800 whitespace-pre-wrap max-h-[120px] overflow-y-auto shadow-sm border border-green-200">
                  {waGroupMessage}
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
              💡 Sistem akan otomatis mencoba semua device Fonnte yang terdaftar sampai satu berhasil mengirim ke grup.
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWaGroupOpen(false)}>
              Batal
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
              disabled={
                !waGroupJid.trim().endsWith("@g.us") ||
                !waGroupMessage.trim() ||
                sendWaGroupMutation.isPending
              }
              onClick={() =>
                sendWaGroupMutation.mutate({
                  groupJid: waGroupJid.trim(),
                  message: waGroupMessage.trim(),
                })
              }
            >
              {sendWaGroupMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengirim…</>
                : <><Send className="h-4 w-4" /> Kirim ke Grup</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Checklist & Shipment ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OperationalChecklist taskId={task.id} taskType="ai_task" category={task.category} />
        <ShipmentTrackingPanel taskId={task.id} />
      </div>

      {/* ── Koreksi AI Drawer ────────────────────────────────────────────────── */}
      <CorrectionDrawer
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        task={{
          id: task.id,
          taskNumber: task.taskNumber ?? undefined,
          aiIntent: task.aiIntent ?? undefined,
          priority: task.priority,
          assignedRole: task.assignedTo ?? undefined,
          slaStatus: task.slaStatus ?? undefined,
          confidenceScore: task.aiConfidenceScore ?? undefined,
        }}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ["ai-task", id] });
        }}
      />

      {/* ── Percakapan WA ────────────────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowWaMessages((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
        >
          <span className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Percakapan WA
            {waMessages.length > 0 && (
              <span className="ml-1 bg-blue-100 text-blue-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                {waMessages.length}
              </span>
            )}
          </span>
          <span className="text-gray-400">{showWaMessages ? "▲" : "▼"}</span>
        </button>
        {showWaMessages && (
          <div className="p-4">
            {waMessagesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : waMessages.length === 0 ? (
              <p className="text-sm text-gray-400 italic text-center py-4">Belum ada pesan WA terhubung ke task ini.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {waMessages.map((msg) => {
                  const isInbound = msg.direction === "inbound";
                  return (
                    <div key={msg.id} className={`flex gap-2 ${isInbound ? "" : "flex-row-reverse"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                        isInbound ? "bg-gray-100 text-gray-800" : "bg-blue-600 text-white ml-auto"
                      }`}>
                        {msg.senderName && (
                          <p className={`text-[10px] font-semibold mb-1 ${isInbound ? "text-gray-500" : "text-blue-100"}`}>
                            {msg.senderName}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{msg.messageText ?? msg.body}</p>
                        {msg.attachmentUrl && (
                          <a href={msg.attachmentUrl} target="_blank" rel="noreferrer"
                            className={`text-[11px] underline mt-1 block ${isInbound ? "text-blue-600" : "text-blue-100"}`}>
                            📎 Lampiran
                          </a>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-1">
                          {msg.detectedIntent && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${isInbound ? "bg-white text-gray-500" : "bg-blue-500 text-blue-100"}`}>
                              {msg.detectedIntent}
                            </span>
                          )}
                          <p className={`text-[10px] opacity-60 ml-auto`}>
                            {format(new Date(msg.createdAt), "dd MMM HH:mm")}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

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
