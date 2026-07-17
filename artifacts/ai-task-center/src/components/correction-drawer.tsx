import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface TaskSnapshot {
  id: number;
  taskNumber?: string;
  aiIntent?: string;
  priority?: string;
  assignedRole?: string;
  slaStatus?: string;
  confidenceScore?: string;
  [key: string]: unknown;
}

interface CorrectionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskSnapshot;
  onSuccess?: () => void;
}

const FIELD_OPTIONS = [
  { value: "intent", label: "Intent (Tujuan Pesan)" },
  { value: "routing_role", label: "Routing (Tim yang Ditugaskan)" },
  { value: "priority", label: "Prioritas" },
  { value: "sla_hours", label: "SLA (Jam)" },
  { value: "approval_required", label: "Perlu Approval" },
  { value: "approval_type", label: "Tipe Approval" },
];

const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"];
const APPROVAL_OPTIONS = ["true", "false"];
const APPROVAL_TYPE_OPTIONS = ["admin_approval", "supervisor_approval", "director_approval"];

export function CorrectionDrawer({ open, onOpenChange, task, onSuccess }: CorrectionDrawerProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [fieldCorrected, setFieldCorrected] = useState("");
  const [correctedValue, setCorrectedValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const originalValue = (() => {
    switch (fieldCorrected) {
      case "intent": return task.aiIntent ?? "-";
      case "routing_role": return (task as { assignedRole?: string }).assignedRole ?? "-";
      case "priority": return task.priority ?? "-";
      case "sla_hours": return "-";
      case "approval_required": return "-";
      case "approval_type": return "-";
      default: return "-";
    }
  })();

  const handleSubmit = async () => {
    if (!fieldCorrected || !correctedValue) {
      toast({ title: "Lengkapi field yang diperlukan", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem("ai_task_center_token") ?? "";
      const res = await fetch("/api/training/corrections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          taskId: task.id,
          fieldCorrected,
          originalValue,
          correctedValue,
          correctionReason: correctionReason || null,
          originalConfidence: task.confidenceScore === "high" ? "90" : task.confidenceScore === "low" ? "35" : "65",
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Gagal menyimpan");
      }
      toast({ title: "Koreksi disimpan", description: `Field '${fieldCorrected}' dikoreksi.` });
      setFieldCorrected("");
      setCorrectedValue("");
      setCorrectionReason("");
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({ title: "Gagal", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const confidenceColor = task.confidenceScore === "high"
    ? "bg-green-100 text-green-800"
    : task.confidenceScore === "low"
    ? "bg-red-100 text-red-800"
    : "bg-yellow-100 text-yellow-800";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            Koreksi Prediksi AI
          </SheetTitle>
          <SheetDescription>
            Task #{task.taskNumber ?? task.id}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Current AI Prediction */}
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prediksi AI Saat Ini</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Intent</p>
                <p className="font-medium">{task.aiIntent ?? "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Prioritas</p>
                <p className="font-medium capitalize">{task.priority ?? "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Confidence</p>
                <Badge className={`text-xs ${confidenceColor}`}>{task.confidenceScore ?? "-"}</Badge>
              </div>
            </div>
          </div>

          {/* Field to correct */}
          <div className="space-y-2">
            <Label htmlFor="field">Field yang Dikoreksi *</Label>
            <Select value={fieldCorrected} onValueChange={(v) => { setFieldCorrected(v); setCorrectedValue(""); }}>
              <SelectTrigger id="field">
                <SelectValue placeholder="Pilih field..." />
              </SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Original value (read-only) */}
          {fieldCorrected && (
            <div className="space-y-2">
              <Label>Nilai AI (Original)</Label>
              <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                {originalValue}
              </div>
            </div>
          )}

          {/* Corrected value */}
          {fieldCorrected && (
            <div className="space-y-2">
              <Label htmlFor="corrected">Nilai yang Benar *</Label>
              {fieldCorrected === "priority" ? (
                <Select value={correctedValue} onValueChange={setCorrectedValue}>
                  <SelectTrigger><SelectValue placeholder="Pilih prioritas..." /></SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : fieldCorrected === "approval_required" ? (
                <Select value={correctedValue} onValueChange={setCorrectedValue}>
                  <SelectTrigger><SelectValue placeholder="Pilih..." /></SelectTrigger>
                  <SelectContent>
                    {APPROVAL_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>{p === "true" ? "Ya, perlu approval" : "Tidak perlu approval"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : fieldCorrected === "approval_type" ? (
                <Select value={correctedValue} onValueChange={setCorrectedValue}>
                  <SelectTrigger><SelectValue placeholder="Pilih tipe..." /></SelectTrigger>
                  <SelectContent>
                    {APPROVAL_TYPE_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : fieldCorrected === "sla_hours" ? (
                <Input
                  id="corrected"
                  type="number"
                  min={1}
                  placeholder="Contoh: 24"
                  value={correctedValue}
                  onChange={(e) => setCorrectedValue(e.target.value)}
                />
              ) : (
                <Input
                  id="corrected"
                  placeholder={fieldCorrected === "intent" ? "Contoh: pengajuan_kredit" : "Nilai yang benar..."}
                  value={correctedValue}
                  onChange={(e) => setCorrectedValue(e.target.value)}
                />
              )}
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Catatan (opsional)</Label>
            <Textarea
              id="reason"
              placeholder="Alasan koreksi atau konteks tambahan..."
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
              Batal
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting || !fieldCorrected || !correctedValue}>
              {submitting ? "Menyimpan..." : (
                <><CheckCircle2 className="h-4 w-4 mr-2" />Simpan Koreksi</>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
