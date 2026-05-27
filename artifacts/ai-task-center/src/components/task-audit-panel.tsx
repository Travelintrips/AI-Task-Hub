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
  createdAt: string;
  updatedAt: string;
}

const STATUS_CONFIG = {
  complete: {
    label: "Complete",
    icon: CheckCircle2,
    badgeClass: "bg-green-100 text-green-800 border-green-200",
    rowClass: "border-green-100",
  },
  missing: {
    label: "Missing",
    icon: XCircle,
    badgeClass: "bg-red-100 text-red-800 border-red-200",
    rowClass: "border-red-100",
  },
  mismatch: {
    label: "Mismatch",
    icon: AlertTriangle,
    badgeClass: "bg-orange-100 text-orange-800 border-orange-200",
    rowClass: "border-orange-100",
  },
  unclear: {
    label: "Unclear",
    icon: HelpCircle,
    badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200",
    rowClass: "border-yellow-100",
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

export function TaskAuditPanel({ taskId }: { taskId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);

  const { data: audit, isLoading } = useQuery<AuditRecord | null>({
    queryKey: ["ai-task-audit", taskId],
    queryFn: () => apiFetch(`/ai-tasks/${taskId}/audit`),
    retry: false,
  });

  const runAuditMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/ai-tasks/${taskId}/audit`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(["ai-task-audit", taskId], data);
      toast({ title: "Audit complete", description: `Status: ${data?.auditStatus ?? "—"}` });
    },
    onError: (err) => {
      toast({ title: "Audit failed", description: String(err), variant: "destructive" });
    },
  });

  const checks = audit ? buildChecklistFromAudit(audit) : null;
  const completeCount = checks?.filter((c) => c.status === "complete").length ?? 0;
  const totalCount = checks?.length ?? ALL_CHECKS.length;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-700">Document Audit</span>
          {audit && (
            <Badge
              variant="outline"
              className={`text-xs ml-1 ${AUDIT_STATUS_CONFIG[audit.auditStatus]?.class ?? ""}`}
            >
              {AUDIT_STATUS_CONFIG[audit.auditStatus]?.label ?? audit.auditStatus}
            </Badge>
          )}
          {audit && (
            <span className="text-xs text-slate-500">
              {completeCount}/{totalCount} complete
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {audit && (
            <span className="text-[10px] text-slate-400">
              {formatDistanceToNow(new Date(audit.updatedAt), { addSuffix: true })}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading audit…
            </div>
          )}

          {!isLoading && !audit && (
            <div className="text-center py-6 space-y-3">
              <ClipboardCheck className="h-10 w-10 text-slate-300 mx-auto" />
              <p className="text-sm text-slate-500">No audit has been run yet for this task.</p>
              <Button
                size="sm"
                onClick={() => runAuditMutation.mutate()}
                disabled={runAuditMutation.isPending}
              >
                {runAuditMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running…</>
                ) : (
                  <><ClipboardCheck className="h-3.5 w-3.5 mr-1.5" /> Run Audit</>
                )}
              </Button>
            </div>
          )}

          {!isLoading && audit && checks && (
            <>
              <div className="grid gap-1.5">
                {checks.map((item) => {
                  const cfg = STATUS_CONFIG[item.status];
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={item.key}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md border bg-white ${cfg.rowClass}`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          item.status === "complete"
                            ? "text-green-500"
                            : item.status === "missing"
                            ? "text-red-400"
                            : item.status === "mismatch"
                            ? "text-orange-500"
                            : "text-yellow-500"
                        }`}
                      />
                      <span className="flex-1 text-sm text-slate-700">{item.label}</span>
                      {item.values.length > 0 && item.values[0] !== "✓" && (
                        <span className="text-xs text-slate-500 truncate max-w-[120px]">
                          {item.values[0]}
                        </span>
                      )}
                      {item.note && (
                        <span className="text-[10px] text-orange-600 hidden sm:inline">{item.note}</span>
                      )}
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${cfg.badgeClass}`}>
                        {cfg.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>

              {(audit.recommendation || audit.nextAction) && (
                <div className="space-y-2 pt-1">
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
