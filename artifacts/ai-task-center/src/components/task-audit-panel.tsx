import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  ArrowRight,
  MessageCircle,
  Copy,
  Check,
  GitCompare,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditCheckItem {
  key: string;
  label: string;
  status: "complete" | "missing" | "unclear" | "mismatch";
  values: string[];
  note?: string;
}

interface AuditRecord {
  id: number;
  taskId: number;
  auditStatus: "passed" | "incomplete" | "failed";
  completeFields: string[];
  missingFields: string[];
  mismatchFields: string[];
  unclearFields: string[];
  recommendation: string | null;
  nextAction: string | null;
  auditDetail: AuditCheckItem[] | null;
  crossDocDetail: AuditCheckItem[] | null;
  crossDocWarnings: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  complete: {
    label: "Complete",
    icon: CheckCircle2,
    iconClass: "text-green-500",
    badgeClass: "bg-green-100 text-green-800 border-green-200",
    rowClass: "border-green-100 bg-green-50/30",
  },
  missing: {
    label: "Missing",
    icon: XCircle,
    iconClass: "text-red-400",
    badgeClass: "bg-red-100 text-red-800 border-red-200",
    rowClass: "border-red-100 bg-red-50/30",
  },
  mismatch: {
    label: "Mismatch",
    icon: AlertTriangle,
    iconClass: "text-orange-500",
    badgeClass: "bg-orange-100 text-orange-800 border-orange-200",
    rowClass: "border-orange-100 bg-orange-50/30",
  },
  unclear: {
    label: "Unclear",
    icon: HelpCircle,
    iconClass: "text-yellow-500",
    badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200",
    rowClass: "border-yellow-100 bg-yellow-50/30",
  },
} as const;

const AUDIT_STATUS_CONFIG = {
  passed: { label: "Passed", class: "bg-green-100 text-green-800 border-green-200" },
  incomplete: { label: "Incomplete", class: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  failed: { label: "Failed", class: "bg-red-100 text-red-800 border-red-200" },
};

const ALL_CHECKS: { key: string; label: string }[] = [
  { key: "invoice", label: "Commercial Invoice" },
  { key: "packing_list", label: "Packing List" },
  { key: "hs_code", label: "HS Code" },
  { key: "product_catalog_photo", label: "Product Catalog / Photo" },
  { key: "gross_weight", label: "Gross Weight" },
  { key: "dimensions", label: "Dimensions" },
  { key: "incoterm", label: "Incoterm" },
  { key: "port_of_loading", label: "Port of Loading" },
  { key: "port_of_discharge", label: "Port of Discharge" },
  { key: "importer_name", label: "Importer Name" },
  { key: "nib_api", label: "NIB / API (Import License)" },
  { key: "machine_condition", label: "Machine Condition (New / Used)" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildChecklistFromAudit(audit: AuditRecord): AuditCheckItem[] {
  if (audit.auditDetail && Array.isArray(audit.auditDetail) && audit.auditDetail.length > 0) {
    return audit.auditDetail as AuditCheckItem[];
  }
  return ALL_CHECKS.map((c) => {
    if (audit.completeFields.includes(c.label)) return { ...c, status: "complete" as const, values: ["✓"] };
    if (audit.mismatchFields.includes(c.label)) return { ...c, status: "mismatch" as const, values: [], note: "Conflicting values" };
    if (audit.unclearFields.includes(c.label)) return { ...c, status: "unclear" as const, values: [] };
    return { ...c, status: "missing" as const, values: [] };
  });
}

function hasIncompleteItems(audit: AuditRecord): boolean {
  return (
    (audit.missingFields?.length ?? 0) > 0 ||
    (audit.mismatchFields?.length ?? 0) > 0 ||
    (audit.unclearFields?.length ?? 0) > 0
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CheckRow({ item }: { item: AuditCheckItem }) {
  const cfg = STATUS_CONFIG[item.status];
  const Icon = cfg.icon;
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 rounded-md border ${cfg.rowClass}`}>
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${cfg.iconClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-700 font-medium">{item.label}</span>
          {item.values.length > 0 && item.values[0] !== "✓" && (
            <span className="text-xs text-slate-500 truncate max-w-[150px]">
              {item.values.length === 2
                ? <span className="text-orange-600">{item.values[0]} <span className="text-slate-400">vs</span> {item.values[1]}</span>
                : item.values[0]}
            </span>
          )}
        </div>
        {item.note && (
          <p className={`text-[11px] mt-0.5 ${item.status === "mismatch" ? "text-orange-700" : "text-slate-500"}`}>
            {item.note}
          </p>
        )}
      </div>
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 self-start mt-0.5 ${cfg.badgeClass}`}>
        {cfg.label}
      </Badge>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TaskAuditPanel({ taskId }: { taskId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [whatsappReply, setWhatsappReply] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [crossExpanded, setCrossExpanded] = useState(true);

  const { data: audit, isLoading } = useQuery<AuditRecord | null>({
    queryKey: ["ai-task-audit", taskId],
    queryFn: () => apiFetch(`/ai-tasks/${taskId}/audit`),
    retry: false,
  });

  const runAuditMutation = useMutation({
    mutationFn: () => apiFetch(`/ai-tasks/${taskId}/audit`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(["ai-task-audit", taskId], data);
      setWhatsappReply(null);
      toast({ title: "Audit complete", description: `Status: ${data?.auditStatus ?? "—"}` });
      const warnings = data?.crossDocWarnings?.length ?? 0;
      toast({
        title: "Audit complete",
        description: warnings > 0
          ? `Status: ${data?.auditStatus} · ${warnings} cross-document warning(s)`
          : `Status: ${data?.auditStatus ?? "—"}`,
        variant: warnings > 0 ? "destructive" : "default",
      });
    },
    onError: (err) => {
      toast({ title: "Audit failed", description: String(err), variant: "destructive" });
    },
  });

  const generateReplyMutation = useMutation({
    mutationFn: async () => {
      if (!audit?.id) throw new Error("No audit ID");
      const result = await apiFetch(`/audits/${audit.id}/whatsapp-reply`, { method: "POST" });
      return result as { message: string };
    },
    onSuccess: (data) => {
      setWhatsappReply(data.message);
    },
    onError: (err) => {
      toast({ title: "Gagal membuat pesan", description: String(err), variant: "destructive" });
    },
  });

  async function handleCopy() {
    if (!whatsappReply) return;
    await navigator.clipboard.writeText(whatsappReply);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const checks = audit ? buildChecklistFromAudit(audit) : null;
  const crossChecks: AuditCheckItem[] = (audit?.crossDocDetail as AuditCheckItem[] | null) ?? [];
  const crossMismatches = crossChecks.filter((c) => c.status === "mismatch");
  const warnings: string[] = audit?.crossDocWarnings ?? [];

  const completeCount = checks?.filter((c) => c.status === "complete").length ?? 0;
  const totalCount = checks?.length ?? ALL_CHECKS.length;
  const showReplySection = audit && hasIncompleteItems(audit);
  const hasCrossIssues = crossMismatches.length > 0;

  return (
    <div className="border rounded-lg overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <ClipboardCheck className="h-4 w-4 text-slate-600 shrink-0" />
          <span className="text-sm font-semibold text-slate-700">Document Audit</span>
          {audit && (
            <Badge
              variant="outline"
              className={`text-xs ${AUDIT_STATUS_CONFIG[audit.auditStatus]?.class ?? ""}`}
            >
              {AUDIT_STATUS_CONFIG[audit.auditStatus]?.label ?? audit.auditStatus}
            </Badge>
          )}
          {hasCrossIssues && (
            <Badge variant="outline" className="text-xs bg-orange-100 text-orange-800 border-orange-200 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" /> {crossMismatches.length} cross-doc
            </Badge>
          )}
          {audit && (
            <span className="text-xs text-slate-400">{completeCount}/{totalCount}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {audit && (
            <span className="text-[10px] text-slate-400">
              {formatDistanceToNow(new Date(audit.updatedAt), { addSuffix: true })}
            </span>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-5">

          {/* ── Loading ───────────────────────────────────────────────────────── */}
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading audit…
            </div>
          )}

          {/* ── No audit yet ──────────────────────────────────────────────────── */}
          {!isLoading && !audit && (
            <div className="text-center py-6 space-y-3">
              <ClipboardCheck className="h-10 w-10 text-slate-300 mx-auto" />
              <p className="text-sm text-slate-500">No audit has been run yet for this task.</p>
              <Button
                size="sm"
                onClick={() => runAuditMutation.mutate()}
                disabled={runAuditMutation.isPending}
              >
                {runAuditMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running…</>
                  : <><ClipboardCheck className="h-3.5 w-3.5 mr-1.5" /> Run Audit</>}
              </Button>
            </div>
          )}

          {/* ── Audit results ─────────────────────────────────────────────────── */}
          {!isLoading && audit && checks && (
            <>
              {/* Admin warning banner */}
              {warnings.length > 0 && (
                <div className="bg-orange-50 border border-orange-300 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-orange-600 shrink-0" />
                    <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                      Admin Warning — Do Not Auto-Approve
                    </p>
                  </div>
                  <ul className="space-y-0.5 pl-5 list-disc">
                    {warnings.map((w, i) => (
                      <li key={i} className="text-xs text-orange-800">{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ── 12-item checklist ──────────────────────────────────────── */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Import Document Checklist
                </p>
                <div className="grid gap-1.5">
                  {checks.map((item) => <CheckRow key={item.key} item={item} />)}
                </div>
              </div>

              {/* ── Cross-document validation ─────────────────────────────── */}
              {crossChecks.length > 0 && (
                <div>
                  <button
                    className="w-full flex items-center justify-between mb-2 group"
                    onClick={() => setCrossExpanded((v) => !v)}
                  >
                    <div className="flex items-center gap-1.5">
                      <GitCompare className="h-3.5 w-3.5 text-slate-500" />
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Cross-Document Validation
                      </p>
                      {hasCrossIssues && (
                        <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">
                          {crossMismatches.length} mismatch{crossMismatches.length !== 1 ? "es" : ""}
                        </span>
                      )}
                    </div>
                    {crossExpanded
                      ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                      : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                  </button>

                  {crossExpanded && (
                    <div className="grid gap-1.5">
                      {crossChecks.map((item) => <CheckRow key={item.key} item={item} />)}
                    </div>
                  )}
                </div>
              )}

              {crossChecks.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2 border border-dashed border-slate-200">
                  <GitCompare className="h-3.5 w-3.5 shrink-0" />
                  Cross-document validation runs when both a Commercial Invoice and Packing List are uploaded.
                </div>
              )}

              {/* ── Recommendation & Next Action ──────────────────────────── */}
              {(audit.recommendation || audit.nextAction) && (
                <div className="space-y-2">
                  {audit.recommendation && (
                    <div className="flex gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3">
                      <Lightbulb className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-0.5">Recommendation</p>
                        <p className="text-sm text-blue-900">{audit.recommendation}</p>
                      </div>
                    </div>
                  )}
                  {audit.nextAction && (
                    <div className="flex gap-2 bg-amber-50 border border-amber-100 rounded-lg p-3">
                      <ArrowRight className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide mb-0.5">Next Action</p>
                        <p className="text-sm text-amber-900">{audit.nextAction}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── WhatsApp Reply Generator ─────────────────────────────── */}
              {showReplySection && (
                <div className="border border-green-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5 bg-green-50">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-green-600" />
                      <span className="text-xs font-semibold text-green-800">Pesan Follow-up WhatsApp</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-100"
                      onClick={() => generateReplyMutation.mutate()}
                      disabled={generateReplyMutation.isPending}
                    >
                      {generateReplyMutation.isPending ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Membuat…</>
                      ) : (
                        <><MessageCircle className="h-3 w-3 mr-1" /> {whatsappReply ? "Buat Ulang" : "Buat Pesan"}</>
                      )}
                    </Button>
                  </div>

                  {whatsappReply ? (
                    <div className="p-3 space-y-2">
                      <div className="bg-white border border-green-100 rounded-md p-3 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
                        {whatsappReply}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-xs"
                        onClick={handleCopy}
                      >
                        {copied ? (
                          <><Check className="h-3.5 w-3.5 mr-1.5 text-green-600" /> Tersalin!</>
                        ) : (
                          <><Copy className="h-3.5 w-3.5 mr-1.5" /> Salin Pesan</>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="px-3 py-3 text-center text-xs text-slate-400">
                      Klik "Buat Pesan" untuk membuat pesan WhatsApp yang meminta data yang masih kurang.
                    </div>
                  )}
                </div>
              )}

              <div className="pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runAuditMutation.mutate()}
                  disabled={runAuditMutation.isPending}
                  className="w-full"
                >
                  {runAuditMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running audit…</>
                  ) : (
                    <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Re-run Audit</>
                  )}
                </Button>
              </div>
              {/* ── Re-run button ─────────────────────────────────────────── */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => runAuditMutation.mutate()}
                disabled={runAuditMutation.isPending}
                className="w-full"
              >
                {runAuditMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running audit…</>
                  : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Re-run Audit</>}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
