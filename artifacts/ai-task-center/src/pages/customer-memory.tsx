import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  ArrowLeft, Brain, RefreshCw, Shield, Star, Clock, FileText,
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2,
  User, Building2, ChevronRight, Plus, Trash2, Loader2,
  BarChart3, MessageSquare, Layers, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getStoredToken } from "@/lib/auth-api";

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

// ── Types ─────────────────────────────────────────────────────────────────────

interface Customer {
  id: number; companyId: string; companyName: string; picName: string | null;
  whatsapp: string | null; email: string | null; industry: string | null; tier: string | null;
  riskScore: number | null; riskTier: string | null; preferredChannel: string | null;
  preferredLanguage: string | null; typicalCargoTypes: string[] | null; typicalRoutes: string[] | null;
  memoryUpdatedAt: string | null; totalTasks: number; aiSummary: string | null; createdAt: string;
}

interface MemoryData {
  customer: Customer;
  activeRisk: RiskAssessment | null;
  latestSnapshot: Snapshot | null;
  aggregates: Aggregates | null;
  preferences: Preference[];
}

interface Aggregates {
  total_tasks: number; open_tasks: number; completed_tasks: number; overdue_tasks: number;
  total_quotations: number; accepted_quotations: number;
  lifetime_value: string; avg_order_value: string;
  total_messages: number; messages_last_30d: number; avg_sentiment_score: string | null;
  last_task_at: string | null;
}

interface RiskAssessment {
  id: number; riskScore: number; tier: string; previousTier: string | null;
  creditLimit: string | null; recommendations: string | null; notes: string | null;
  expiresAt: string | null; assessedAt: string; isActive: boolean;
  factors: { code: string; weight: number; detail: string }[] | null;
}

interface Snapshot {
  id: number; version: number; aiContextBlock: string; freshnessScore: number;
  isStale: boolean; openTasksCount: number | null;
  lastNIntents: string[] | null; frequentServices: string[] | null;
  sentimentTrend: string | null; createdAt: string;
}

interface Preference {
  id: number; category: string; key: string; value: string;
  status: string; source: string; confidence: string | null;
  createdAt: string; updatedAt: string;
}

interface TimelineEvent {
  eventId: string; source: string; happenedAt: string; title: string;
  body: string | null; metadata: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function RiskBadge({ tier }: { tier: string }) {
  const map: Record<string, string> = { low: "bg-green-100 text-green-700", medium: "bg-yellow-100 text-yellow-700", high: "bg-orange-100 text-orange-700", blocked: "bg-red-100 text-red-700" };
  const label: Record<string, string> = { low: "Rendah", medium: "Sedang", high: "Tinggi", blocked: "Diblokir" };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[tier] ?? "bg-gray-100 text-gray-700"}`}>{label[tier] ?? tier}</span>;
}

function FreshnessBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-green-500" : score >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-1.5"><div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${score}%` }} /></div>
      <span className="text-xs text-gray-500 w-8">{score}%</span>
    </div>
  );
}

function SentimentIcon({ trend }: { trend: string | null }) {
  if (trend === "improving") return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (trend === "declining") return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-gray-400" />;
}

function SourceBadge({ source }: { source: string }) {
  return source === "ai_inferred"
    ? <Badge variant="outline" className="text-purple-600 border-purple-300 text-xs">AI</Badge>
    : <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs">Manual</Badge>;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomerMemoryPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [prefDialog, setPrefDialog] = useState(false);
  const [riskDialog, setRiskDialog] = useState(false);
  const [prefForm, setPrefForm] = useState({ category: "communication", key: "", value: "" });
  const [riskForm, setRiskForm] = useState({ riskScore: "", tier: "medium", creditLimit: "", recommendations: "", notes: "", expiresAt: "" });

  const { data: memData, isLoading } = useQuery<MemoryData>({
    queryKey: ["customer-memory", id],
    queryFn: () => apiFetch(`/crm/customers/${id}/memory`),
  });

  const { data: timeline = [], isLoading: timelineLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["customer-timeline", id],
    queryFn: async () => {
      const r = await apiFetch(`/crm/customers/${id}/timeline?days=90&limit=100`);
      return r?.events ?? [];
    },
  });

  const { data: allPrefs = [] } = useQuery<Preference[]>({
    queryKey: ["customer-prefs", id],
    queryFn: () => apiFetch(`/crm/customers/${id}/preferences`),
  });

  const { data: riskData } = useQuery<{ active: RiskAssessment | null; history: RiskAssessment[] }>({
    queryKey: ["customer-risk", id],
    queryFn: () => apiFetch(`/crm/customers/${id}/risk`),
  });

  const { data: snapshot } = useQuery<Snapshot | null>({
    queryKey: ["customer-ai-context", id],
    queryFn: () => apiFetch(`/crm/customers/${id}/ai-context`),
  });

  const refreshMut = useMutation({
    mutationFn: () => apiFetch(`/crm/customers/${id}/ai-context/refresh`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-memory", id] });
      queryClient.invalidateQueries({ queryKey: ["customer-ai-context", id] });
      toast({ title: "Snapshot AI berhasil dibuat" });
    },
    onError: () => toast({ title: "Gagal membuat snapshot AI", variant: "destructive" }),
  });

  const prefMut = useMutation({
    mutationFn: ({ cat, key, value }: { cat: string; key: string; value: string }) =>
      apiFetch(`/crm/customers/${id}/preferences/${encodeURIComponent(cat)}/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-prefs", id] });
      queryClient.invalidateQueries({ queryKey: ["customer-memory", id] });
      setPrefDialog(false);
      toast({ title: "Preferensi disimpan" });
    },
    onError: () => toast({ title: "Gagal menyimpan preferensi", variant: "destructive" }),
  });

  const delPrefMut = useMutation({
    mutationFn: ({ cat, key }: { cat: string; key: string }) =>
      apiFetch(`/crm/customers/${id}/preferences/${encodeURIComponent(cat)}/${encodeURIComponent(key)}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customer-prefs", id] }); toast({ title: "Preferensi dihapus" }); },
  });

  const riskMut = useMutation({
    mutationFn: (data: typeof riskForm) =>
      apiFetch(`/crm/customers/${id}/risk`, { method: "POST", body: JSON.stringify({ ...data, riskScore: Number(data.riskScore) }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-risk", id] });
      queryClient.invalidateQueries({ queryKey: ["customer-memory", id] });
      setRiskDialog(false);
      toast({ title: "Penilaian risiko disimpan" });
    },
    onError: () => toast({ title: "Gagal menyimpan risk", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { customer, activeRisk, latestSnapshot, aggregates } = memData ?? {};
  if (!customer) return <div className="p-6 text-center text-muted-foreground">Customer tidak ditemukan.</div>;

  const agg = aggregates as Aggregates | null;

  // ── Summary Cards ─────────────────────────────────────────────────────────

  const SummaryCards = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[
        { label: "Total Task", value: agg?.total_tasks ?? customer.totalTasks, sub: `${agg?.open_tasks ?? 0} aktif`, icon: <Layers className="h-4 w-4 text-blue-500" /> },
        { label: "Lifetime Value", value: agg?.lifetime_value ? `Rp ${Number(agg.lifetime_value).toLocaleString("id")}` : "-", sub: `${agg?.accepted_quotations ?? 0} quotation diterima`, icon: <BarChart3 className="h-4 w-4 text-green-500" /> },
        { label: "Pesan WA", value: agg?.total_messages ?? 0, sub: `${agg?.messages_last_30d ?? 0} bulan ini`, icon: <MessageSquare className="h-4 w-4 text-purple-500" /> },
        { label: "Risk Tier", value: customer.riskTier ? <RiskBadge tier={customer.riskTier} /> : "-", sub: `Score: ${customer.riskScore ?? "-"}`, icon: <Shield className="h-4 w-4 text-orange-500" /> },
      ].map((c, i) => (
        <Card key={i} className="shadow-none border">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">{c.icon}<span className="text-xs text-muted-foreground">{c.label}</span></div>
            <div className="text-lg font-semibold">{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.sub}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  // ── Tab: Profil ────────────────────────────────────────────────────────────

  const TabProfil = () => (
    <div className="space-y-4">
      <Card className="shadow-none border">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Informasi Dasar</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {[
            ["Nama Perusahaan", customer.companyName],
            ["Industri", customer.industry ?? "-"],
            ["Tier", customer.tier ?? "-"],
            ["Saluran Foredan", customer.preferredChannel ?? "-"],
            ["Bahasa Preferensi", customer.preferredLanguage ?? "-"],
            ["Tipe Kargo Umum", (customer.typicalCargoTypes ?? []).join(", ") || "-"],
            ["Rute Umum", (customer.typicalRoutes ?? []).join(", ") || "-"],
            ["Memory Diperbarui", customer.memoryUpdatedAt ? format(new Date(customer.memoryUpdatedAt), "dd MMM yyyy HH:mm", { locale: idLocale }) : "-"],
          ].map(([label, val]) => (
            <div key={label}>
              <span className="text-muted-foreground text-xs">{label}</span>
              <div className="font-medium mt-0.5">{val}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      {customer.aiSummary && (
        <Card className="shadow-none border">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Brain className="h-3.5 w-3.5 text-purple-500" />Ringkasan AI</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{customer.aiSummary}</p></CardContent>
        </Card>
      )}
    </div>
  );

  // ── Tab: Timeline ──────────────────────────────────────────────────────────

  const sourceIcon: Record<string, React.ReactNode> = {
    task: <Layers className="h-3.5 w-3.5 text-blue-500" />,
    message: <MessageSquare className="h-3.5 w-3.5 text-green-500" />,
    quotation: <FileText className="h-3.5 w-3.5 text-orange-500" />,
  };
  const sourceLabel: Record<string, string> = { task: "Task", message: "WA", quotation: "Quotation" };

  const TabTimeline = () => (
    <div className="space-y-2">
      {timelineLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
      {!timelineLoading && timeline.length === 0 && <p className="text-center text-muted-foreground py-8 text-sm">Belum ada riwayat interaksi.</p>}
      {timeline.map((e) => (
        <div key={e.eventId} className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
          <div className="mt-0.5 shrink-0">{sourceIcon[e.source] ?? <Clock className="h-3.5 w-3.5 text-gray-400" />}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{e.title}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="outline" className="text-xs">{sourceLabel[e.source] ?? e.source}</Badge>
                <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(e.happenedAt), { addSuffix: true, locale: idLocale })}</span>
              </div>
            </div>
            {e.body && <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.body}</p>}
          </div>
        </div>
      ))}
    </div>
  );

  // ── Tab: Preferensi ────────────────────────────────────────────────────────

  const groupedPrefs = allPrefs.reduce<Record<string, Preference[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  const categoryLabel: Record<string, string> = {
    communication: "Komunikasi", service: "Layanan", document: "Dokumen", notification: "Notifikasi",
  };

  const TabPreferensi = () => (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setPrefForm({ category: "communication", key: "", value: "" }); setPrefDialog(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />Tambah Preferensi
        </Button>
      </div>
      {allPrefs.length === 0 && <p className="text-center text-muted-foreground py-8 text-sm">Belum ada preferensi yang tercatat.</p>}
      {Object.entries(groupedPrefs).map(([cat, prefs]) => (
        <Card key={cat} className="shadow-none border">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{categoryLabel[cat] ?? cat}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {prefs.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div>
                  <span className="text-xs text-muted-foreground">{p.key}</span>
                  <div className="text-sm font-medium">{p.value}</div>
                  {p.confidence && <span className="text-xs text-purple-500">Konfiden: {(Number(p.confidence) * 100).toFixed(0)}%</span>}
                </div>
                <div className="flex items-center gap-2">
                  <SourceBadge source={p.source} />
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-500"
                    onClick={() => delPrefMut.mutate({ cat: p.category, key: p.key })}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );

  // ── Tab: Risk ──────────────────────────────────────────────────────────────

  const active = riskData?.active;
  const riskHistory = riskData?.history ?? [];

  const tierColor: Record<string, string> = {
    low: "text-green-600 bg-green-50", medium: "text-yellow-700 bg-yellow-50",
    high: "text-orange-600 bg-orange-50", blocked: "text-red-600 bg-red-50",
  };

  const TabRisk = () => (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setRiskDialog(true)}>
          <Shield className="h-3.5 w-3.5 mr-1" />Buat Penilaian Baru
        </Button>
      </div>
      {active ? (
        <Card className={`shadow-none border-2 ${active.tier === "blocked" ? "border-red-300" : active.tier === "high" ? "border-orange-200" : "border-green-200"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Shield className="h-4 w-4" />Penilaian Aktif</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tierColor[active.tier] ?? "bg-gray-100"}`}>{active.tier.toUpperCase()}</span>
                <span className="text-2xl font-bold">{active.riskScore}</span>
                <span className="text-xs text-muted-foreground">/100</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {active.creditLimit && <div><span className="text-xs text-muted-foreground">Batas Kredit</span><div className="font-medium text-sm">Rp {Number(active.creditLimit).toLocaleString("id")}</div></div>}
            {active.recommendations && <div><span className="text-xs text-muted-foreground">Rekomendasi</span><p className="text-sm mt-0.5">{active.recommendations}</p></div>}
            {active.expiresAt && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3 w-3" />Berlaku hingga {format(new Date(active.expiresAt), "dd MMM yyyy")}</div>}
            <div className="text-xs text-muted-foreground">Dinilai {formatDistanceToNow(new Date(active.assessedAt), { addSuffix: true, locale: idLocale })}</div>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-8 text-muted-foreground text-sm">Belum ada penilaian risiko aktif.</div>
      )}
      {riskHistory.length > 0 && (
        <Card className="shadow-none border">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Riwayat Penilaian</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {riskHistory.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                <div className="flex items-center gap-2"><RiskBadge tier={r.tier} /><span className="font-medium">{r.riskScore}/100</span></div>
                <span className="text-xs text-muted-foreground">{format(new Date(r.assessedAt), "dd MMM yyyy", { locale: idLocale })}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );

  // ── Tab: Dokumen ───────────────────────────────────────────────────────────

  const [docDialog, setDocDialog] = useState(false);
  const [docForm, setDocForm] = useState({ documentType: "npwp", fileName: "", fileUrl: "", expiryDate: "", notes: "" });

  const { data: docs = [], refetch: refetchDocs } = useQuery<{
    id: number; documentType: string; fileName: string; fileUrl: string | null;
    expiryDate: string | null; isCurrent: boolean; isVerified: boolean;
    uploadedAt: string; notes: string | null; tags: string[] | null;
  }[]>({
    queryKey: ["customer-docs", id],
    queryFn: () => apiFetch(`/crm/customers/${id}/documents`),
  });

  const addDocMut = useMutation({
    mutationFn: (data: typeof docForm) => apiFetch(`/crm/customers/${id}/documents`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customer-docs", id] }); setDocDialog(false); toast({ title: "Dokumen berhasil didaftarkan" }); },
    onError: () => toast({ title: "Gagal mendaftarkan dokumen", variant: "destructive" }),
  });

  const verifyDocMut = useMutation({
    mutationFn: (docId: number) => apiFetch(`/crm/customers/${id}/documents/${docId}`, { method: "PATCH", body: JSON.stringify({ isVerified: true }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customer-docs", id] }); toast({ title: "Dokumen diverifikasi" }); },
  });

  const deleteDocMut = useMutation({
    mutationFn: (docId: number) => apiFetch(`/crm/customers/${id}/documents/${docId}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customer-docs", id] }); toast({ title: "Dokumen dihapus" }); },
  });

  const DOC_TYPE_LABELS: Record<string, string> = {
    npwp: "NPWP", bl: "Bill of Lading", coa: "CoA", surat_kuasa: "Surat Kuasa",
    invoice: "Invoice", packing_list: "Packing List", manifest: "Manifest",
    pib: "PIB/BC 2.0", spb: "SPB/BC 2.3", other: "Lainnya",
  };

  const TabDokumen = () => (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setDocForm({ documentType: "npwp", fileName: "", fileUrl: "", expiryDate: "", notes: "" }); setDocDialog(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />Daftarkan Dokumen
        </Button>
      </div>
      {docs.length === 0 && (
        <div className="py-8 text-center text-muted-foreground text-sm">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />Belum ada dokumen terdaftar.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {docs.map((d) => (
          <Card key={d.id} className={`shadow-none border ${d.isVerified ? "border-green-200" : ""}`}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[d.documentType] ?? d.documentType}</Badge>
                    {d.isVerified && <Badge variant="outline" className="text-green-600 border-green-300 text-xs"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Terverifikasi</Badge>}
                    {!d.isCurrent && <Badge variant="outline" className="text-gray-400 text-xs">Usang</Badge>}
                  </div>
                  <p className="text-sm font-medium truncate">{d.fileName}</p>
                  {d.expiryDate && (
                    <p className={`text-xs ${new Date(d.expiryDate) < new Date() ? "text-red-500" : "text-muted-foreground"}`}>
                      <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                      {new Date(d.expiryDate) < new Date() ? "Kedaluwarsa" : "Berlaku s/d"} {format(new Date(d.expiryDate), "dd MMM yyyy")}
                    </p>
                  )}
                  {d.notes && <p className="text-xs text-muted-foreground mt-0.5">{d.notes}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {d.fileUrl && <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="icon" className="h-6 w-6"><FileText className="h-3 w-3" /></Button></a>}
                  {!d.isVerified && <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600 hover:bg-green-50" onClick={() => verifyDocMut.mutate(d.id)}><CheckCircle2 className="h-3 w-3" /></Button>}
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:bg-red-50" onClick={() => { if (confirm("Hapus dokumen ini?")) deleteDocMut.mutate(d.id); }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{formatDistanceToNow(new Date(d.uploadedAt), { addSuffix: true, locale: idLocale })}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add Doc Dialog */}
      <Dialog open={docDialog} onOpenChange={setDocDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Daftarkan Dokumen</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Jenis Dokumen</Label>
              <Select value={docForm.documentType} onValueChange={(v) => setDocForm((p) => ({ ...p, documentType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Nama File</Label>
              <Input placeholder="cth. NPWP-PT-ABC.pdf" value={docForm.fileName} onChange={(e) => setDocForm((p) => ({ ...p, fileName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">URL File (opsional)</Label>
              <Input placeholder="https://..." value={docForm.fileUrl} onChange={(e) => setDocForm((p) => ({ ...p, fileUrl: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Tanggal Kedaluwarsa (opsional)</Label>
              <Input type="date" value={docForm.expiryDate} onChange={(e) => setDocForm((p) => ({ ...p, expiryDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Catatan</Label>
              <Textarea rows={2} value={docForm.notes} onChange={(e) => setDocForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialog(false)}>Batal</Button>
            <Button onClick={() => addDocMut.mutate(docForm)} disabled={addDocMut.isPending || !docForm.fileName}>
              {addDocMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // ── Tab: AI Context ────────────────────────────────────────────────────────

  const TabAiContext = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Snapshot Konteks AI</p>
          <p className="text-xs text-muted-foreground">Blok teks yang diinjeksikan ke prompt AI saat pelanggan mengirim pesan WA.</p>
        </div>
        <Button size="sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
          {refreshMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          Buat Snapshot
        </Button>
      </div>

      {snapshot ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">Versi {snapshot.version}</span>
            <FreshnessBar score={snapshot.freshnessScore} />
            {snapshot.isStale && <Badge variant="destructive" className="text-xs">Stale</Badge>}
            {snapshot.sentimentTrend && (
              <div className="flex items-center gap-1 text-xs">
                <SentimentIcon trend={snapshot.sentimentTrend} />
                <span className="capitalize">{snapshot.sentimentTrend}</span>
              </div>
            )}
            <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(snapshot.createdAt), { addSuffix: true, locale: idLocale })}</span>
          </div>

          {snapshot.lastNIntents && snapshot.lastNIntents.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Intent Terakhir</p>
              <div className="flex flex-wrap gap-1">
                {snapshot.lastNIntents.map((i, idx) => <Badge key={idx} variant="outline" className="text-xs">{i}</Badge>)}
              </div>
            </div>
          )}

          <Card className="shadow-none border bg-muted/20">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Brain className="h-3 w-3" />AI Context Block (diinjeksikan ke prompt)</CardTitle></CardHeader>
            <CardContent><pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">{snapshot.aiContextBlock}</pre></CardContent>
          </Card>
        </div>
      ) : (
        <Card className="shadow-none border">
          <CardContent className="py-10 text-center">
            <Brain className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Belum ada snapshot AI.</p>
            <p className="text-xs text-muted-foreground">Klik "Buat Snapshot" untuk menghasilkan konteks AI pertama.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/crm"><Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-500" />{customer.companyName}
          </h1>
          <p className="text-xs text-muted-foreground">Memory Center · ID #{customer.id} · {customer.whatsapp ?? customer.email ?? "—"}</p>
        </div>
        {customer.riskTier && <RiskBadge tier={customer.riskTier} />}
      </div>

      {/* Summary Cards */}
      <SummaryCards />

      {/* Tabs */}
      <Tabs defaultValue="profil">
        <TabsList className="mb-4">
          <TabsTrigger value="profil"><User className="h-3.5 w-3.5 mr-1" />Profil</TabsTrigger>
          <TabsTrigger value="timeline"><Clock className="h-3.5 w-3.5 mr-1" />Timeline</TabsTrigger>
          <TabsTrigger value="preferensi"><Star className="h-3.5 w-3.5 mr-1" />Preferensi</TabsTrigger>
          <TabsTrigger value="risk"><Shield className="h-3.5 w-3.5 mr-1" />Risk</TabsTrigger>
          <TabsTrigger value="dokumen"><FileText className="h-3.5 w-3.5 mr-1" />Dokumen</TabsTrigger>
          <TabsTrigger value="ai-context"><Brain className="h-3.5 w-3.5 mr-1" />AI Context</TabsTrigger>
        </TabsList>

        <TabsContent value="profil"><TabProfil /></TabsContent>
        <TabsContent value="timeline"><TabTimeline /></TabsContent>
        <TabsContent value="preferensi"><TabPreferensi /></TabsContent>
        <TabsContent value="risk"><TabRisk /></TabsContent>
        <TabsContent value="dokumen"><TabDokumen /></TabsContent>
        <TabsContent value="ai-context"><TabAiContext /></TabsContent>
      </Tabs>

      {/* Preferensi Dialog */}
      <Dialog open={prefDialog} onOpenChange={setPrefDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Tambah Preferensi</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Kategori</Label>
              <Select value={prefForm.category} onValueChange={(v) => setPrefForm((p) => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="communication">Komunikasi</SelectItem>
                  <SelectItem value="service">Layanan</SelectItem>
                  <SelectItem value="document">Dokumen</SelectItem>
                  <SelectItem value="notification">Notifikasi</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Key</Label>
              <Input placeholder="cth. preferred_contact_time" value={prefForm.key} onChange={(e) => setPrefForm((p) => ({ ...p, key: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Nilai</Label>
              <Input placeholder="cth. pagi (08-10)" value={prefForm.value} onChange={(e) => setPrefForm((p) => ({ ...p, value: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrefDialog(false)}>Batal</Button>
            <Button onClick={() => prefMut.mutate({ cat: prefForm.category, key: prefForm.key, value: prefForm.value })} disabled={prefMut.isPending || !prefForm.key || !prefForm.value}>
              {prefMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Risk Dialog */}
      <Dialog open={riskDialog} onOpenChange={setRiskDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Penilaian Risiko Baru</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Skor Risiko (0-100)</Label>
                <Input type="number" min={0} max={100} value={riskForm.riskScore} onChange={(e) => setRiskForm((p) => ({ ...p, riskScore: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Tier</Label>
                <Select value={riskForm.tier} onValueChange={(v) => setRiskForm((p) => ({ ...p, tier: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Rendah</SelectItem>
                    <SelectItem value="medium">Sedang</SelectItem>
                    <SelectItem value="high">Tinggi</SelectItem>
                    <SelectItem value="blocked">Diblokir</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Batas Kredit (Rp)</Label>
              <Input placeholder="cth. 50000000" value={riskForm.creditLimit} onChange={(e) => setRiskForm((p) => ({ ...p, creditLimit: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Berlaku Hingga</Label>
              <Input type="date" value={riskForm.expiresAt} onChange={(e) => setRiskForm((p) => ({ ...p, expiresAt: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Rekomendasi</Label>
              <Textarea rows={2} value={riskForm.recommendations} onChange={(e) => setRiskForm((p) => ({ ...p, recommendations: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Catatan Internal</Label>
              <Textarea rows={2} value={riskForm.notes} onChange={(e) => setRiskForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRiskDialog(false)}>Batal</Button>
            <Button onClick={() => riskMut.mutate(riskForm)} disabled={riskMut.isPending || !riskForm.riskScore || !riskForm.tier}>
              {riskMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
