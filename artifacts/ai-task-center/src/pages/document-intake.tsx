import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, AlertCircle, Clock, Eye, Search, RefreshCw,
  FileCheck, FileText, Shield, ChevronDown, ChevronRight, Upload, Settings,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { getStoredToken } from "@/lib/auth-api";

// ─── API helper ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, init?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocumentAudit {
  id: number;
  companyId: string;
  taskId: number | null;
  intakeSessionId: number | null;
  customerId: number | null;
  documentType: string;
  fileName: string;
  fileUrl: string;
  extractedFields: Record<string, unknown>;
  requiredFields: string[];
  missingFields: string[];
  validationStatus: "valid" | "incomplete" | "invalid" | "needs_review";
  confidenceScore: string;
  issueSummary: string | null;
  aiNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface ValidationRule {
  id: number;
  companyId: string;
  documentType: string;
  intentCode: string | null;
  requiredFields: string[];
  optionalFields: string[];
  validationPrompt: string | null;
  isActive: string;
  createdAt: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  valid:        { label: "Valid",         icon: CheckCircle2, color: "bg-green-100 text-green-800",  border: "border-green-200" },
  incomplete:   { label: "Tidak Lengkap", icon: AlertCircle,  color: "bg-yellow-100 text-yellow-800", border: "border-yellow-200" },
  invalid:      { label: "Tidak Valid",   icon: XCircle,      color: "bg-red-100 text-red-800",       border: "border-red-200" },
  needs_review: { label: "Perlu Review",  icon: Clock,        color: "bg-blue-100 text-blue-800",     border: "border-blue-200" },
};

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DocumentAudit["validationStatus"] }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function ExtractedFieldsViewer({ fields, required, missing }: {
  fields: Record<string, unknown>;
  required: string[];
  missing: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const allKeys = Array.from(new Set([...required, ...Object.keys(fields)]));

  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? "Sembunyikan" : "Lihat"} field yang diekstrak ({allKeys.length})
      </button>
      {expanded && (
        <div className="mt-2 bg-muted/30 rounded-md p-2 grid grid-cols-2 gap-1 text-xs">
          {allKeys.map((key) => {
            const val = fields[key];
            const isMissing = missing.includes(key);
            return (
              <div key={key} className={`flex gap-1 ${isMissing ? "text-red-600" : "text-foreground"}`}>
                <span className="font-medium shrink-0">{key.replace(/_/g, " ")}:</span>
                <span className={`truncate ${val === null || val === undefined ? "text-muted-foreground italic" : ""}`}>
                  {val === null || val === undefined ? "—" : String(val)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AuditCard({ audit, onReview }: { audit: DocumentAudit; onReview: (a: DocumentAudit) => void }) {
  const confidence = Math.round(parseFloat(audit.confidenceScore) * 100);
  const typeLabel = DOC_TYPE_LABELS[audit.documentType] ?? audit.documentType;

  return (
    <Card className={`border ${STATUS_CONFIG[audit.validationStatus].border}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{audit.fileName}</span>
              <StatusBadge status={audit.validationStatus} />
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{typeLabel}</span>
            </div>

            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>Confidence: {confidence}%</span>
              {audit.taskId && <span>Task #{audit.taskId}</span>}
              {audit.intakeSessionId && <span>Sesi #{audit.intakeSessionId}</span>}
              <span>{formatDistanceToNow(new Date(audit.createdAt), { addSuffix: true, locale: localeId })}</span>
              {audit.reviewedBy && (
                <span className="text-green-600">✓ Reviewed by {audit.reviewedBy}</span>
              )}
            </div>

            {audit.issueSummary && (
              <p className="text-xs text-amber-700 mt-1 bg-amber-50 px-2 py-1 rounded">
                {audit.issueSummary}
              </p>
            )}

            {audit.missingFields.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {audit.missingFields.map((f) => (
                  <span key={f} className="text-xs bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-200">
                    {f.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}

            <ExtractedFieldsViewer
              fields={audit.extractedFields ?? {}}
              required={audit.requiredFields ?? []}
              missing={audit.missingFields}
            />
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.open(audit.fileUrl, "_blank")}>
              <Eye className="h-3 w-3 mr-1" />
              Buka
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onReview(audit)}>
              <Shield className="h-3 w-3 mr-1" />
              Review
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Review dialog ─────────────────────────────────────────────────────────────

function ReviewDialog({ audit, onClose, onSaved }: {
  audit: DocumentAudit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<DocumentAudit["validationStatus"]>("valid");
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: ({ id, s, n }: { id: number; s: string; n: string }) =>
      apiFetch(`/documents/audits/${id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ validationStatus: s, issueSummary: n || undefined }),
      }),
    onSuccess: () => {
      toast({ title: "Review disimpan" });
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  if (!audit) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review Dokumen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">{audit.fileName}</p>
            <p className="text-xs text-muted-foreground">{DOC_TYPE_LABELS[audit.documentType] ?? audit.documentType}</p>
          </div>
          <div>
            <Label>Status Validasi</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as DocumentAudit["validationStatus"])}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="valid">✅ Valid</SelectItem>
                <SelectItem value="incomplete">⚠️ Tidak Lengkap</SelectItem>
                <SelectItem value="invalid">❌ Tidak Valid</SelectItem>
                <SelectItem value="needs_review">🔍 Perlu Review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Catatan (opsional)</Label>
            <Textarea
              className="mt-1"
              rows={3}
              placeholder="Catatan review..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            onClick={() => mutation.mutate({ id: audit.id, s: status, n: note })}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            Simpan Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Validate Document Dialog ─────────────────────────────────────────────────

function ValidateDocumentDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [docType, setDocType] = useState("commercial_invoice");
  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");

  const mutation = useMutation({
    mutationFn: (data: { documentType: string; fileName: string; fileUrl: string }) =>
      apiFetch("/documents/validate", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Validasi selesai" });
      onDone();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Validasi Dokumen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Tipe Dokumen</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Nama File</Label>
            <Input className="mt-1" placeholder="contoh: invoice_001.pdf" value={fileName} onChange={(e) => setFileName(e.target.value)} />
          </div>
          <div>
            <Label>URL Dokumen (publik atau signed URL)</Label>
            <Input className="mt-1" placeholder="https://..." value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            onClick={() => mutation.mutate({ documentType: docType, fileName, fileUrl })}
            disabled={mutation.isPending || !fileName || !fileUrl}
          >
            {mutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <FileCheck className="h-4 w-4 mr-2" />}
            Validasi Sekarang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rules Tab ─────────────────────────────────────────────────────────────────

function RulesTab() {
  const { data, isLoading } = useQuery<{ data: ValidationRule[] }>({
    queryKey: ["document-validation-rules"],
    queryFn: () => apiFetch("/documents/rules"),
  });

  const rules = data?.data ?? [];

  if (isLoading) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Memuat aturan...</div>;
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => (
        <Card key={rule.id}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{DOC_TYPE_LABELS[rule.documentType] ?? rule.documentType}</span>
                  <Badge variant={rule.isActive === "true" ? "default" : "secondary"}>
                    {rule.isActive === "true" ? "Aktif" : "Nonaktif"}
                  </Badge>
                  {rule.intentCode && (
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Intent: {rule.intentCode}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Field wajib ({rule.requiredFields.length}):</p>
                  <div className="flex flex-wrap gap-1">
                    {rule.requiredFields.map((f) => (
                      <span key={f} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        {f.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
                {rule.optionalFields.length > 0 && (
                  <div className="mt-1">
                    <p className="text-xs text-muted-foreground mb-1">Field opsional ({rule.optionalFields.length}):</p>
                    <div className="flex flex-wrap gap-1">
                      {rule.optionalFields.map((f) => (
                        <span key={f} className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                          {f.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function DocumentIntakePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("queue");
  const [search, setSearch] = useState("");
  const [reviewAudit, setReviewAudit] = useState<DocumentAudit | null>(null);
  const [showValidateDialog, setShowValidateDialog] = useState(false);

  const statusFilter: Record<string, string> = {
    queue: "needs_review,incomplete",
    valid: "valid",
    issues: "incomplete,invalid",
    rules: "",
  };

  const { data, isLoading, refetch } = useQuery<{ data: DocumentAudit[]; total: number }>({
    queryKey: ["document-intake-audits", tab],
    queryFn: () => {
      const sf = statusFilter[tab] ?? "";
      const params = sf ? `?status=${sf}&limit=100` : "?limit=100";
      return apiFetch(`/documents/audits${params}`);
    },
    enabled: tab !== "rules",
  });

  const audits = (data?.data ?? []).filter((a) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      a.fileName.toLowerCase().includes(s) ||
      a.documentType.toLowerCase().includes(s) ||
      (a.issueSummary ?? "").toLowerCase().includes(s)
    );
  });

  const stats = {
    queue:    audits.filter(a => a.validationStatus === "needs_review" || a.validationStatus === "incomplete").length,
    valid:    audits.filter(a => a.validationStatus === "valid").length,
    issues:   audits.filter(a => a.validationStatus === "invalid").length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-primary" />
            Document Intake & Validation
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-powered document validation dengan OpenAI Vision
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowValidateDialog(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Validasi Dokumen
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="px-6 py-4 grid grid-cols-4 gap-3">
        {[
          { key: "queue",  label: "Antrian Review", icon: Clock,        color: "text-blue-600",   bg: "bg-blue-50",   val: data?.data?.filter(a => a.validationStatus === "needs_review" || a.validationStatus === "incomplete").length ?? 0 },
          { key: "valid",  label: "Valid",           icon: CheckCircle2, color: "text-green-600",  bg: "bg-green-50",  val: data?.data?.filter(a => a.validationStatus === "valid").length ?? 0 },
          { key: "issues", label: "Ada Masalah",     icon: AlertCircle,  color: "text-yellow-600", bg: "bg-yellow-50", val: data?.data?.filter(a => a.validationStatus === "incomplete" || a.validationStatus === "invalid").length ?? 0 },
          { key: "rules",  label: "Aturan Validasi", icon: Settings,     color: "text-purple-600", bg: "bg-purple-50", val: undefined },
        ].map(({ key, label, icon: Icon, color, bg }) => (
          <button
            key={key}
            className={`text-left rounded-lg border p-3 transition-colors ${tab === key ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
            onClick={() => setTab(key)}
          >
            <div className={`inline-flex items-center justify-center h-8 w-8 rounded-md ${bg} ${color} mb-2`}>
              <Icon className="h-4 w-4" />
            </div>
            <p className="text-sm text-muted-foreground">{label}</p>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 px-6 pb-6 overflow-auto">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center gap-3 mb-4">
            <TabsList>
              <TabsTrigger value="queue">
                Antrian
                {stats.queue > 0 && (
                  <span className="ml-1 bg-blue-600 text-white rounded-full px-1.5 py-0.5 text-xs leading-none">
                    {stats.queue}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="valid">Valid</TabsTrigger>
              <TabsTrigger value="issues">Ada Masalah</TabsTrigger>
              <TabsTrigger value="rules">Aturan Validasi</TabsTrigger>
            </TabsList>

            {tab !== "rules" && (
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari dokumen..."
                  className="pl-8 h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
          </div>

          <TabsContent value="queue" className="space-y-3 mt-0">
            {isLoading ? (
              <LoadingState />
            ) : audits.length === 0 ? (
              <EmptyState icon={Clock} title="Tidak ada dokumen dalam antrian" subtitle="Semua dokumen sudah diproses" />
            ) : (
              audits.map((a) => <AuditCard key={a.id} audit={a} onReview={setReviewAudit} />)
            )}
          </TabsContent>

          <TabsContent value="valid" className="space-y-3 mt-0">
            {isLoading ? (
              <LoadingState />
            ) : audits.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Belum ada dokumen valid" subtitle="Dokumen yang lolos validasi akan muncul di sini" />
            ) : (
              audits.map((a) => <AuditCard key={a.id} audit={a} onReview={setReviewAudit} />)
            )}
          </TabsContent>

          <TabsContent value="issues" className="space-y-3 mt-0">
            {isLoading ? (
              <LoadingState />
            ) : audits.length === 0 ? (
              <EmptyState icon={AlertCircle} title="Tidak ada masalah" subtitle="Dokumen bermasalah akan muncul di sini" />
            ) : (
              audits.map((a) => <AuditCard key={a.id} audit={a} onReview={setReviewAudit} />)
            )}
          </TabsContent>

          <TabsContent value="rules" className="mt-0">
            <RulesTab />
          </TabsContent>
        </Tabs>
      </div>

      {reviewAudit && (
        <ReviewDialog
          audit={reviewAudit}
          onClose={() => setReviewAudit(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["document-intake-audits"] })}
        />
      )}

      {showValidateDialog && (
        <ValidateDocumentDialog
          onClose={() => setShowValidateDialog(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["document-intake-audits"] })}
        />
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
      <RefreshCw className="h-4 w-4 animate-spin mr-2" />
      Memuat data...
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/30 mb-2" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/70 mt-0.5">{subtitle}</p>
    </div>
  );
}
