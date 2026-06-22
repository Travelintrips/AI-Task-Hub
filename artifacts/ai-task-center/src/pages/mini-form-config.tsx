/**
 * Mini Form Config Admin Page — Sprint 9B
 * Route: /mini-form-config
 * RBAC: company_admin / super_admin can edit; supervisor can view only
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Settings, Eye, RefreshCw, CheckCircle2, MessageSquare, Layers } from "lucide-react";
import { getStoredToken } from "@/lib/auth-api";
import { useAuth } from "@/contexts/auth-context";

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
    const b = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((b as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

interface IntentConfig {
  intentCode: string;
  intentName: string;
  category: string;
  isActive: boolean;
  template: {
    id: number;
    name: string;
    intakeMode: string;
    useMiniForm: boolean;
    miniFormType: string | null;
    miniFormRoute: string | null;
  } | null;
}

interface FormType {
  type: string;
  title: string;
  description: string;
}

interface ConfigData {
  data: IntentConfig[];
  formTypes: FormType[];
}

const INTAKE_MODE_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  conversation: { label: "Percakapan AI",  color: "bg-blue-100 text-blue-800",   icon: MessageSquare },
  mini_form:    { label: "Mini Form",      color: "bg-green-100 text-green-800", icon: Layers },
  hybrid:       { label: "Hybrid",         color: "bg-purple-100 text-purple-800", icon: CheckCircle2 },
};

function IntakeModeBadge({ mode }: { mode: string }) {
  const cfg = INTAKE_MODE_LABELS[mode] ?? { label: mode, color: "bg-gray-100 text-gray-700", icon: Settings };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function ConfigRow({
  intent,
  formTypes,
  canEdit,
  onSave,
  isSaving,
}: {
  intent: IntentConfig;
  formTypes: FormType[];
  canEdit: boolean;
  onSave: (intentCode: string, patch: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [intakeMode, setIntakeMode] = useState(intent.template?.intakeMode ?? "conversation");
  const [miniFormType, setMiniFormType] = useState(intent.template?.miniFormType ?? "");
  const [isDirty, setIsDirty] = useState(false);

  const tpl = intent.template;
  const appBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  const previewUrl = tpl ? `${appBase}/mini-form/preview/${tpl.id}` : null;

  function handleModeChange(val: string) {
    setIntakeMode(val);
    setIsDirty(true);
  }

  function handleFormTypeChange(val: string) {
    setMiniFormType(val);
    setIsDirty(true);
  }

  function handleSave() {
    onSave(intent.intentCode, {
      intakeMode,
      useMiniForm: intakeMode !== "conversation",
      miniFormType: intakeMode !== "conversation" ? miniFormType || null : null,
    });
    setIsDirty(false);
  }

  return (
    <tr className="border-b last:border-0 hover:bg-muted/20">
      <td className="px-4 py-3">
        <div className="font-medium text-sm">{intent.intentName ?? intent.intentCode}</div>
        <div className="text-xs text-muted-foreground font-mono">{intent.intentCode}</div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{intent.category}</td>
      <td className="px-4 py-3">
        {tpl ? (
          <span className="text-xs text-green-700 font-medium">✓ {tpl.name}</span>
        ) : (
          <span className="text-xs text-orange-500 italic">Belum ada template</span>
        )}
      </td>
      <td className="px-4 py-3">
        {tpl && canEdit ? (
          <Select value={intakeMode} onValueChange={handleModeChange}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conversation">Percakapan AI</SelectItem>
              <SelectItem value="mini_form">Mini Form</SelectItem>
              <SelectItem value="hybrid">Hybrid</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <IntakeModeBadge mode={tpl?.intakeMode ?? "conversation"} />
        )}
      </td>
      <td className="px-4 py-3">
        {tpl && intakeMode !== "conversation" && canEdit ? (
          <Select value={miniFormType || ""} onValueChange={handleFormTypeChange}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue placeholder="Pilih form" />
            </SelectTrigger>
            <SelectContent>
              {formTypes.map((ft) => (
                <SelectItem key={ft.type} value={ft.type}>{ft.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">
            {tpl?.miniFormType ? (
              <span className="font-medium text-gray-700">{tpl.miniFormType}</span>
            ) : (
              "—"
            )}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1.5">
          {canEdit && tpl && isDirty && (
            <Button
              size="sm" variant="default"
              className="h-7 text-xs px-3"
              disabled={isSaving}
              onClick={handleSave}
            >
              Simpan
            </Button>
          )}
          {previewUrl && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs px-2"
              asChild
            >
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                <Eye className="w-3 h-3" />
              </a>
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function MiniFormConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = ["company_admin", "super_admin", "admin"].includes(user?.role ?? "");
  const [categoryFilter, setCategoryFilter] = useState("");

  const { data, isLoading, refetch } = useQuery<ConfigData>({
    queryKey: ["mini-form-config"],
    queryFn: () => apiFetch("/mini-form-config"),
  });

  const mutation = useMutation({
    mutationFn: ({ intentCode, patch }: { intentCode: string; patch: Record<string, unknown> }) =>
      apiFetch(`/mini-form-config/${intentCode}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (_, { intentCode }) => {
      toast({ title: `Konfigurasi ${intentCode} disimpan` });
      queryClient.invalidateQueries({ queryKey: ["mini-form-config"] });
    },
    onError: (err: Error) => {
      toast({ title: "Gagal menyimpan", description: err.message, variant: "destructive" });
    },
  });

  const intents = data?.data ?? [];
  const formTypes = data?.formTypes ?? [];
  const categories = Array.from(new Set(intents.map((i) => i.category).filter(Boolean)));
  const filtered = categoryFilter
    ? intents.filter((i) => i.category === categoryFilter)
    : intents;

  const miniFormCount = intents.filter((i) => i.template?.intakeMode !== "conversation" && i.template).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="w-6 h-6 text-blue-600" />
            Mini Form Config
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Atur mode pengumpulan data tiap intent (Percakapan AI / Mini Form / Hybrid)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Intent",       value: intents.length,           color: "text-gray-600" },
          { label: "Pakai Mini Form",    value: miniFormCount,            color: "text-green-600" },
          { label: "Percakapan AI",      value: intents.filter(i => i.template?.intakeMode === "conversation" || !i.template).length, color: "text-blue-600" },
          { label: "Belum Ada Template", value: intents.filter(i => !i.template).length, color: "text-orange-600" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Form Types Reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Tipe Mini Form Tersedia</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {formTypes.map((ft) => (
              <div key={ft.type} className="bg-blue-50 rounded-lg p-2.5 text-center">
                <p className="text-xs font-semibold text-blue-800">{ft.type}</p>
                <p className="text-xs text-blue-600 mt-0.5 truncate">{ft.title}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex gap-3">
        <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Semua Kategori" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Kategori</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!canEdit && (
          <Badge variant="outline" className="text-orange-600 border-orange-300 self-center">
            View Only — Hanya admin yang dapat mengubah konfigurasi
          </Badge>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Memuat...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Settings className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Tidak ada intent ditemukan</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Intent</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Kategori</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Template Data</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mode Intake</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipe Form</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((intent) => (
                <ConfigRow
                  key={intent.intentCode}
                  intent={intent}
                  formTypes={formTypes}
                  canEdit={canEdit}
                  onSave={(code, patch) => mutation.mutate({ intentCode: code, patch })}
                  isSaving={mutation.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
