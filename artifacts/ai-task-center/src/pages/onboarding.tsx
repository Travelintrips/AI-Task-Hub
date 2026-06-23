/**
 * Sprint 10A-2 — Guided Onboarding Wizard
 * Route: /onboarding/:step?
 * Steps: company → whatsapp → team → customer → vendor → fleet → test → done
 */
import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Building2, Wifi, Users, Contact, Package, Truck, Brain, CheckCircle2,
  ChevronRight, ChevronLeft, ExternalLink, Copy, Check, AlertCircle,
  RefreshCw, Plus, Loader2, Lock,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

type StepId = "company" | "whatsapp" | "team" | "customer" | "vendor" | "fleet" | "test" | "done";

interface StepDef { id: StepId; label: string; icon: React.ReactNode; desc: string }

interface OnboardingStatus {
  overallPct: number;
  steps: {
    company_profile: { done: boolean; pct: number; fields: Record<string, boolean> };
    whatsapp: { done: boolean; pct: number; fonnteConfigured: boolean; metaConfigured: boolean };
    team: { done: boolean; count: number };
    customers: { done: boolean; total: number; withPhone: number };
    fleet: { done: boolean; count: number };
    knowledge_base: { done: boolean; intentCount: number };
    first_task: { done: boolean; taskCount: number };
  };
}

interface WhatsAppHealth {
  status: "healthy" | "partial" | "not_configured";
  gateway: { fonnte: { configured: boolean; tokenMasked: string | null }; meta: { configured: boolean; phoneNumberId: string | null } };
  webhook: { configured: boolean; fonnte_url: string; meta_url: string };
  activity: { lastMessageAt: string | null; lastMessageSource: string | null; messages24h: number };
  issues: string[];
}

interface TeamMember { id: number; name: string; role: string; division: string | null; phone: string | null }
interface Vendor { id: number; name: string; serviceType: string | null; documentCount?: number }
interface FleetUnit { id: number; licensePlate: string; vehicleType: string | null; make: string | null; isActive: boolean }

interface AiTestResult {
  simulation: boolean;
  message: string;
  detectedIntent: string | null;
  intentCode: string | null;
  category: string | null;
  confidence: number;
  intakeMode: string;
  dataTemplateName: string | null;
  missingFields: string[];
  wouldCreateTask: boolean;
  wouldSendMiniForm: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STEPS: StepDef[] = [
  { id: "company",   label: "Profil Perusahaan", icon: <Building2 className="h-4 w-4" />, desc: "Nama, telepon, email & industri" },
  { id: "whatsapp",  label: "WhatsApp",          icon: <Wifi className="h-4 w-4" />,      desc: "Koneksi gateway & webhook" },
  { id: "team",      label: "Tim",               icon: <Users className="h-4 w-4" />,     desc: "Tambah anggota & role" },
  { id: "customer",  label: "Customer",          icon: <Contact className="h-4 w-4" />,   desc: "Setup data pelanggan" },
  { id: "vendor",    label: "Vendor",            icon: <Package className="h-4 w-4" />,   desc: "Daftar mitra & supplier" },
  { id: "fleet",     label: "Armada",            icon: <Truck className="h-4 w-4" />,     desc: "Unit kendaraan & pengemudi" },
  { id: "test",      label: "Tes AI",            icon: <Brain className="h-4 w-4" />,     desc: "Simulasikan pesan WA" },
  { id: "done",      label: "Selesai",           icon: <CheckCircle2 className="h-4 w-4" />, desc: "Siap beroperasi!" },
];

const STEP_IDS = STEPS.map((s) => s.id);

const MGMT_ROLES = new Set(["super_admin", "owner", "company_admin"]);
const READ_ROLES = new Set(["supervisor"]);

const EXAMPLE_MESSAGES = [
  "Saya mau trucking Jakarta Surabaya",
  "Saya mau kasbon 2 juta",
  "Barang saya pecah waktu dikirim",
  "Minta penawaran air freight ke Singapore",
  "Konfirmasi pembayaran invoice INV-001",
];

// ─── API helper ─────────────────────────────────────────────────────────────

async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("ai_task_center_token");
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusDot({ done }: { done: boolean }) {
  return done
    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    : <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1"
    >
      {copied ? <><Check className="h-3 w-3" /> Tersalin</> : <><Copy className="h-3 w-3" /> Salin</>}
    </button>
  );
}

// ─── Step 1: Company Profile ─────────────────────────────────────────────────

function StepCompany({ canEdit, onComplete }: { canEdit: boolean; onComplete: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Record<string, unknown>>("/api/settings"),
  });

  const [form, setForm] = useState({ companyName: "", companyPhone: "", companyEmail: "", industryType: "" });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        companyName:  String(settings.companyName  ?? ""),
        companyPhone: String(settings.companyPhone ?? ""),
        companyEmail: String(settings.companyEmail ?? ""),
        industryType: String(settings.industryType ?? ""),
      });
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: () => apiFetch("/api/settings", { method: "PUT", body: JSON.stringify(form) }),
    onSuccess: () => { toast({ title: "Profil disimpan" }); setDirty(false); qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["onboarding-status-banner"] }); },
    onError: (e: Error) => toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" }),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setForm(p => ({ ...p, [k]: e.target.value })); setDirty(true); };

  const allFilled = form.companyName && form.companyPhone && form.companyEmail && form.industryType;

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat...</div>;

  const fieldClass = "w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-muted disabled:cursor-not-allowed";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Profil Perusahaan</h2>
        <p className="text-sm text-muted-foreground mt-1">Lengkapi informasi dasar perusahaan Anda.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Nama Perusahaan <span className="text-red-500">*</span></label>
          <input className={fieldClass} placeholder="PT. Contoh Abadi" value={form.companyName} onChange={set("companyName")} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">No. Telepon / WhatsApp <span className="text-red-500">*</span></label>
          <input className={fieldClass} placeholder="6281234567890" value={form.companyPhone} onChange={set("companyPhone")} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Email Perusahaan <span className="text-red-500">*</span></label>
          <input className={fieldClass} type="email" placeholder="info@perusahaan.com" value={form.companyEmail} onChange={set("companyEmail")} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Jenis Industri <span className="text-red-500">*</span></label>
          <select className={fieldClass} value={form.industryType} onChange={set("industryType")} disabled={!canEdit}>
            <option value="">-- Pilih industri --</option>
            <option value="logistics">Logistik & Pengiriman</option>
            <option value="freight_forwarding">Freight Forwarding</option>
            <option value="warehouse">Pergudangan</option>
            <option value="trading">Perdagangan</option>
            <option value="manufacturing">Manufaktur</option>
            <option value="sport_center">Sport Center</option>
            <option value="property">Properti & Tenant</option>
            <option value="other">Lainnya</option>
          </select>
        </div>
      </div>

      {!canEdit && (
        <p className="text-xs text-amber-600 flex items-center gap-1"><Lock className="h-3 w-3" /> Anda hanya dapat melihat — perlu role Admin untuk mengubah profil.</p>
      )}

      <div className="flex items-center gap-3 pt-2">
        {canEdit && (
          <Button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending} size="sm">
            {saveMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Menyimpan...</> : "Simpan Profil"}
          </Button>
        )}
        {allFilled && (
          <Button size="sm" onClick={onComplete} variant={canEdit ? "outline" : "default"}>
            Lanjutkan ke WhatsApp <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: WhatsApp Health ─────────────────────────────────────────────────

function StepWhatsApp({ onComplete }: { onComplete: () => void }) {
  const { data: health, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["wa-health"],
    queryFn: () => apiFetch<WhatsAppHealth>("/api/system/whatsapp-health"),
  });

  const host = typeof window !== "undefined" ? window.location.origin : "";

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memeriksa WhatsApp...</div>;

  const s = health;
  const isHealthy = s?.status === "healthy";
  const isPartial = s?.status === "partial";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Koneksi WhatsApp</h2>
        <p className="text-sm text-muted-foreground mt-1">Pastikan gateway WhatsApp terhubung sebelum menerima pesan.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Fonnte Gateway", ok: s?.gateway.fonnte.configured, val: s?.gateway.fonnte.tokenMasked ?? "Belum dikonfigurasi" },
          { label: "Meta WhatsApp API", ok: s?.gateway.meta.configured, val: s?.gateway.meta.phoneNumberId ?? "Belum dikonfigurasi" },
          { label: "Webhook Token", ok: s?.webhook.configured, val: s?.webhook.configured ? "Sudah diset" : "Belum diset" },
        ].map((item) => (
          <div key={item.label} className={`border rounded-lg p-3 ${item.ok ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              <StatusDot done={item.ok ?? false} />
              <span className="text-xs font-medium">{item.label}</span>
            </div>
            <p className="text-xs text-muted-foreground font-mono">{item.val}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">URL Webhook Fonnte:</p>
        <div className="flex items-center gap-2 bg-muted rounded px-3 py-2">
          <code className="text-xs flex-1 truncate">{host}/api/webhook/fonnte</code>
          <CopyButton text={`${host}/api/webhook/fonnte`} />
        </div>
        <p className="text-xs text-muted-foreground">Paste URL ini ke dashboard Fonnte → Webhook Settings.</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">URL Webhook Meta:</p>
        <div className="flex items-center gap-2 bg-muted rounded px-3 py-2">
          <code className="text-xs flex-1 truncate">{host}/api/webhook/whatsapp</code>
          <CopyButton text={`${host}/api/webhook/whatsapp`} />
        </div>
      </div>

      {s?.activity && (
        <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
          <p>Pesan masuk 24 jam terakhir: <strong>{s.activity.messages24h}</strong></p>
          {s.activity.lastMessageAt && <p>Terakhir: {new Date(s.activity.lastMessageAt).toLocaleString("id-ID")}</p>}
        </div>
      )}

      {(s?.issues ?? []).length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
          <p className="text-xs font-medium text-red-700">Masalah yang perlu diselesaikan:</p>
          {(s?.issues ?? []).map((issue) => <p key={issue} className="text-xs text-red-600">• {issue}</p>)}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />} Cek Ulang
        </Button>
        <a href="https://fonnte.com" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm"><ExternalLink className="h-4 w-4 mr-1" /> Buka Fonnte Dashboard</Button>
        </a>
        <Button size="sm" onClick={onComplete} disabled={!isHealthy && !isPartial}>
          {isHealthy ? "WhatsApp Sehat — Lanjutkan" : isPartial ? "Lanjutkan (sebagian)"  : "Perlu konfigurasi"} <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3: Team Setup ──────────────────────────────────────────────────────

function StepTeam({ canEdit, onComplete }: { canEdit: boolean; onComplete: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [newMember, setNewMember] = useState({ name: "", role: "staff", division: "", phone: "" });

  const { data: team = [], isLoading } = useQuery({
    queryKey: ["team"],
    queryFn: () => apiFetch<TeamMember[]>("/api/team"),
  });

  const addMut = useMutation({
    mutationFn: () => apiFetch("/api/team", { method: "POST", body: JSON.stringify(newMember) }),
    onSuccess: () => {
      toast({ title: "Anggota tim ditambahkan" });
      setNewMember({ name: "", role: "staff", division: "", phone: "" });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const hasSupervisor = team.some((m) => m.role === "supervisor" || m.role === "company_admin" || m.role === "owner");
  const hasStaff = team.some((m) => m.role === "staff");
  const ready = hasSupervisor || hasStaff;

  const roleLabel: Record<string, string> = {
    staff: "Staff", supervisor: "Supervisor", company_admin: "Admin",
    owner: "Owner", super_admin: "Super Admin",
  };

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat tim...</div>;

  const fieldClass = "w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-muted";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Setup Tim</h2>
        <p className="text-sm text-muted-foreground mt-1">Butuh minimal 1 supervisor atau 1 staff untuk mulai beroperasi.</p>
      </div>

      {team.length === 0 ? (
        <div className="border rounded-lg p-8 text-center">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Belum ada anggota tim.</p>
          <p className="text-xs text-muted-foreground mt-1">Tambahkan minimal 1 anggota agar AI bisa mengassign task.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {["Nama", "Role", "Divisi", "Telepon/WA"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{m.name}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{roleLabel[m.role] ?? m.role}</Badge></td>
                  <td className="px-3 py-2 text-muted-foreground">{m.division ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.phone ?? <span className="text-amber-500">Belum ada</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && showForm && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
          <p className="text-sm font-medium">Tambah Anggota Tim</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={fieldClass} placeholder="Nama lengkap *" value={newMember.name} onChange={e => setNewMember(p => ({ ...p, name: e.target.value }))} />
            <select className={fieldClass} value={newMember.role} onChange={e => setNewMember(p => ({ ...p, role: e.target.value }))}>
              <option value="staff">Staff</option>
              <option value="supervisor">Supervisor</option>
              <option value="company_admin">Admin</option>
            </select>
            <input className={fieldClass} placeholder="Divisi (opsional)" value={newMember.division} onChange={e => setNewMember(p => ({ ...p, division: e.target.value }))} />
            <input className={fieldClass} placeholder="No. WA (628xxxx)" value={newMember.phone} onChange={e => setNewMember(p => ({ ...p, phone: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => addMut.mutate()} disabled={!newMember.name || addMut.isPending}>
              {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />} Tambah
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {canEdit && !showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1" /> Tambah Anggota</Button>
        )}
        <Button size="sm" onClick={onComplete} disabled={!ready}>
          {ready ? "Tim Siap — Lanjutkan" : "Tambah anggota dulu"} <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 4: Customer Setup ──────────────────────────────────────────────────

function StepCustomer({ onComplete }: { onComplete: () => void }) {
  const [, navigate] = useLocation();

  const { data: status } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => apiFetch<OnboardingStatus>("/api/system/onboarding-status"),
  });

  const total = status?.steps.customers.total ?? 0;
  const withPhone = status?.steps.customers.withPhone ?? 0;
  const missing = total - withPhone;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Setup Customer</h2>
        <p className="text-sm text-muted-foreground mt-1">Customer dengan nomor WhatsApp bisa menerima notifikasi otomatis.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Customer", value: total, color: "text-foreground" },
          { label: "Punya WhatsApp", value: withPhone, color: "text-green-600" },
          { label: "Belum Ada WA", value: missing, color: missing > 0 ? "text-amber-600" : "text-muted-foreground" },
        ].map((item) => (
          <div key={item.label} className="border rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm font-medium text-blue-800">Kelola Customer di CRM</p>
        <p className="text-xs text-blue-700 mt-1">Gunakan halaman CRM untuk menambah atau mengimpor customer. Nomor WhatsApp wajib diisi agar notifikasi bisa terkirim.</p>
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={() => navigate("/crm")} className="text-blue-700 border-blue-300">
            <ExternalLink className="h-4 w-4 mr-1" /> Buka CRM
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={onComplete}>
          {total > 0 ? "Customer Ada — Lanjutkan" : "Lewati (isi nanti)"} <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 5: Vendor Setup ────────────────────────────────────────────────────

function StepVendor({ onComplete }: { onComplete: () => void }) {
  const [, navigate] = useLocation();

  const { data: vendorsData, isLoading } = useQuery({
    queryKey: ["vendors-onboarding"],
    queryFn: () => apiFetch<{ vendors: Vendor[]; total: number }>("/api/vendors?limit=5"),
  });

  const total = vendorsData?.total ?? 0;
  const withServiceType = (vendorsData?.vendors ?? []).filter(v => v.serviceType).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Setup Vendor / Mitra</h2>
        <p className="text-sm text-muted-foreground mt-1">Vendor yang terdaftar dapat direkomendasikan otomatis oleh AI saat ada permintaan.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Total Vendor", value: total, color: "text-foreground" },
          { label: "Ada Service Type", value: withServiceType, color: "text-green-600" },
        ].map((item) => (
          <div key={item.label} className="border rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{item.label}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat vendor...</div>
      ) : (vendorsData?.vendors ?? []).length > 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {["Nama Vendor", "Tipe Layanan"].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(vendorsData?.vendors ?? []).map(v => (
                <tr key={v.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{v.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v.serviceType ?? <span className="text-amber-500">Belum diisi</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > 5 && <p className="px-3 py-2 text-xs text-muted-foreground">+{total - 5} vendor lainnya</p>}
        </div>
      ) : (
        <div className="border rounded-lg p-8 text-center">
          <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Belum ada vendor terdaftar.</p>
          <p className="text-xs text-muted-foreground mt-1">Tambahkan vendor agar AI bisa merekomendasikan mitra yang tepat.</p>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => navigate("/vendors")}>
          <ExternalLink className="h-4 w-4 mr-1" /> Kelola Vendor
        </Button>
        <Button size="sm" onClick={onComplete}>
          {total > 0 ? "Vendor Ada — Lanjutkan" : "Lewati (isi nanti)"} <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 6: Fleet Setup ─────────────────────────────────────────────────────

function StepFleet({ onComplete }: { onComplete: () => void }) {
  const [, navigate] = useLocation();

  const { data: fleetData, isLoading } = useQuery({
    queryKey: ["fleet-units-onboarding"],
    queryFn: () => apiFetch<{ data: FleetUnit[]; total: number }>("/api/fleet/units?limit=5"),
  });

  const total = fleetData?.total ?? 0;
  const active = (fleetData?.data ?? []).filter(u => u.isActive).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Setup Armada Kendaraan</h2>
        <p className="text-sm text-muted-foreground mt-1">Fleet Intelligence menghitung biaya, risiko, dan utilisasi setiap unit secara otomatis.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Total Unit", value: total, color: "text-foreground" },
          { label: "Unit Aktif", value: active, color: "text-green-600" },
        ].map((item) => (
          <div key={item.label} className="border rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{item.label}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat armada...</div>
      ) : (fleetData?.data ?? []).length > 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {["Plat Nomor", "Jenis", "Merek", "Status"].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(fleetData?.data ?? []).map(u => (
                <tr key={u.id} className="border-t">
                  <td className="px-3 py-2 font-mono font-medium">{u.licensePlate}</td>
                  <td className="px-3 py-2 text-muted-foreground capitalize">{u.vehicleType ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{u.make ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-xs ${u.isActive ? "text-green-600 border-green-300" : "text-muted-foreground"}`}>
                      {u.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > 5 && <p className="px-3 py-2 text-xs text-muted-foreground">+{total - 5} unit lainnya</p>}
        </div>
      ) : (
        <div className="border rounded-lg p-8 text-center">
          <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Belum ada unit armada.</p>
          <p className="text-xs text-muted-foreground mt-1">Tambahkan kendaraan agar Fleet Intelligence bisa menghitung biaya dan risiko per unit.</p>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => navigate("/fleet/units")}>
          <ExternalLink className="h-4 w-4 mr-1" /> Kelola Armada
        </Button>
        <Button size="sm" onClick={onComplete}>
          {total > 0 ? "Armada Ada — Lanjutkan" : "Lewati (isi nanti)"} <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 7: AI Test ─────────────────────────────────────────────────────────

function StepAiTest({ onComplete }: { onComplete: () => void }) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);

  async function runTest(msg: string) {
    setMessage(msg);
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<AiTestResult>("/api/system/ai-test", {
        method: "POST",
        body: JSON.stringify({ message: msg }),
      });
      setResult(r);
      setTested(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Tes Simulasi AI</h2>
        <p className="text-sm text-muted-foreground mt-1">Kirim contoh pesan WA — lihat intent yang terdeteksi, mode intake, dan field yang dibutuhkan.</p>
        <div className="mt-2 inline-flex items-center gap-1 bg-green-50 border border-green-200 text-green-700 text-xs rounded px-2 py-1">
          <Check className="h-3 w-3" /> Mode simulasi — tidak ada task dibuat, tidak ada WA terkirim
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Contoh pesan:</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_MESSAGES.map((m) => (
            <button key={m} onClick={() => runTest(m)} className="text-xs border rounded-full px-3 py-1 hover:bg-muted transition-colors">
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Ketik pesan WA sendiri..."
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => e.key === "Enter" && message.trim() && runTest(message)}
        />
        <Button size="sm" onClick={() => runTest(message)} disabled={!message.trim() || loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
        </Button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>}

      {result && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/40 px-4 py-2 flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Hasil Simulasi</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: "Pesan Input", value: `"${result.message}"` },
                { label: "Intent Terdeteksi", value: result.detectedIntent ?? "Tidak terdeteksi" },
                { label: "Intent Code", value: result.intentCode ?? "—" },
                { label: "Kategori", value: result.category ?? "—" },
                { label: "Confidence", value: result.intentCode ? `${result.confidence}%` : "—" },
                { label: "Mode Intake", value: result.intakeMode === "mini_form" ? "Mini Form" : result.intakeMode === "conversation" ? "Conversation" : "—" },
                { label: "Template Data", value: result.dataTemplateName ?? "—" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium text-sm truncate" title={value}>{value}</p>
                </div>
              ))}
            </div>

            {result.missingFields.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Field yang perlu dilengkapi:</p>
                <div className="flex flex-wrap gap-1">
                  {result.missingFields.map(f => <Badge key={f} variant="outline" className="text-xs">{f}</Badge>)}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <div className={`flex items-center gap-2 text-xs rounded p-2 ${result.wouldCreateTask ? "bg-green-50 text-green-700" : "bg-muted text-muted-foreground"}`}>
                {result.wouldCreateTask ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                {result.wouldCreateTask ? "Task akan dibuat" : "Task tidak dibuat"}
              </div>
              <div className={`flex items-center gap-2 text-xs rounded p-2 ${result.wouldSendMiniForm ? "bg-blue-50 text-blue-700" : "bg-muted text-muted-foreground"}`}>
                {result.wouldSendMiniForm ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                {result.wouldSendMiniForm ? "Mini form akan dikirim" : "Tanpa mini form"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={onComplete} disabled={!tested}>
          {tested ? "Tes Selesai — Lanjutkan" : "Jalankan tes dulu"} <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
        {!tested && (
          <Button size="sm" variant="ghost" onClick={onComplete} className="text-muted-foreground text-xs">
            Lewati tes
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step 8: Done ────────────────────────────────────────────────────────────

function StepDone() {
  const [, navigate] = useLocation();

  const { data: status, isLoading } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => apiFetch<OnboardingStatus>("/api/system/onboarding-status"),
  });

  const checklistItems = [
    { key: "company_profile", label: "Profil perusahaan lengkap", done: status?.steps.company_profile.done ?? false },
    { key: "whatsapp",        label: "WhatsApp terhubung",          done: status?.steps.whatsapp.done ?? false },
    { key: "team",            label: "Anggota tim terdaftar",       done: status?.steps.team.done ?? false },
    { key: "customers",       label: "Customer siap",               done: status?.steps.customers.done ?? false },
    { key: "fleet",           label: "Armada terdaftar",            done: status?.steps.fleet.done ?? false },
    { key: "knowledge_base",  label: "Knowledge Base AI aktif",     done: status?.steps.knowledge_base.done ?? false },
    { key: "first_task",      label: "Pertama task/pesan masuk",    done: status?.steps.first_task.done ?? false },
  ];
  const pct = status?.overallPct ?? 0;
  const allDone = checklistItems.every(i => i.done);

  return (
    <div className="space-y-5">
      <div className="text-center py-4">
        <div className={`inline-flex items-center justify-center h-16 w-16 rounded-full mb-4 ${allDone ? "bg-green-100" : "bg-amber-100"}`}>
          <CheckCircle2 className={`h-8 w-8 ${allDone ? "text-green-600" : "text-amber-500"}`} />
        </div>
        <h2 className="text-xl font-bold">{allDone ? "Sistem Siap Beroperasi!" : "Setup Hampir Selesai"}</h2>
        <p className="text-sm text-muted-foreground mt-1">Skor kesiapan: <strong>{pct}%</strong></p>
        {!isLoading && <Progress value={pct} className="mt-3 max-w-xs mx-auto h-2" />}
      </div>

      <div className="border rounded-lg divide-y">
        {checklistItems.map(item => (
          <div key={item.key} className="flex items-center gap-3 px-4 py-3">
            {item.done
              ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              : <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />}
            <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
            {item.done
              ? <Badge className="ml-auto text-xs bg-green-100 text-green-700 border-0">Selesai</Badge>
              : <Badge className="ml-auto text-xs bg-amber-100 text-amber-700 border-0">Perlu dilengkapi</Badge>}
          </div>
        ))}
      </div>

      <div className="flex justify-center pt-2">
        <Button size="lg" onClick={() => navigate("/")} className="px-8">
          {allDone ? "🚀 Mulai Operasi!" : "Ke Dashboard →"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Wizard ─────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { user } = useAuth();
  const [, params] = useRoute("/onboarding/:step");
  const [, navigate] = useLocation();

  const stepParam = (params?.step as StepId) ?? "company";
  const currentIdx = STEP_IDS.indexOf(stepParam);
  const activeIdx  = currentIdx >= 0 ? currentIdx : 0;
  const activeStep = STEPS[activeIdx];

  const canEdit = !!user && MGMT_ROLES.has(user.role);
  const canView = !!user && (MGMT_ROLES.has(user.role) || READ_ROLES.has(user.role));

  const { data: status } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => apiFetch<OnboardingStatus>("/api/system/onboarding-status"),
    staleTime: 30_000,
  });

  function goTo(step: StepId) { navigate(`/onboarding/${step}`); }
  function goNext() {
    const next = STEPS[activeIdx + 1];
    if (next) goTo(next.id);
  }
  function goPrev() {
    const prev = STEPS[activeIdx - 1];
    if (prev) goTo(prev.id);
  }

  // RBAC guard
  if (!user) return null;
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-full min-h-64 text-center">
        <div>
          <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="font-medium">Akses Terbatas</p>
          <p className="text-sm text-muted-foreground mt-1">Halaman ini hanya untuk Admin, Owner, atau Supervisor.</p>
          <Button size="sm" className="mt-3" onClick={() => navigate("/")}>Ke Dashboard</Button>
        </div>
      </div>
    );
  }

  function stepDone(id: StepId): boolean {
    if (!status) return false;
    switch (id) {
      case "company":  return status.steps.company_profile.done;
      case "whatsapp": return status.steps.whatsapp.done;
      case "team":     return status.steps.team.done;
      case "customer": return status.steps.customers.done;
      case "vendor":   return true;
      case "fleet":    return status.steps.fleet.done;
      case "test":     return true;
      case "done":     return true;
      default:         return false;
    }
  }

  const overallPct = status?.overallPct ?? 0;

  return (
    <div className="flex h-full min-h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 shrink-0 border-r bg-muted/20 flex flex-col">
        <div className="px-4 py-5 border-b">
          <h1 className="font-semibold text-sm">Guided Onboarding</h1>
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Progres</span>
              <span>{overallPct}%</span>
            </div>
            <Progress value={overallPct} className="h-1.5" />
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {STEPS.map((step, idx) => {
            const isActive   = idx === activeIdx;
            const isDone     = stepDone(step.id);
            const isAccessible = idx <= activeIdx + 1 || isDone;
            return (
              <button
                key={step.id}
                onClick={() => isAccessible && goTo(step.id)}
                disabled={!isAccessible}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-colors
                  ${isActive ? "bg-primary text-primary-foreground" : isDone ? "text-foreground hover:bg-muted" : "text-muted-foreground hover:bg-muted"}
                  ${!isAccessible ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className={`shrink-0 mt-0.5 ${isActive ? "text-primary-foreground" : isDone ? "text-green-500" : "text-muted-foreground"}`}>
                  {isDone && !isActive ? <CheckCircle2 className="h-4 w-4" /> : step.icon}
                </div>
                <div>
                  <div className="text-xs font-medium leading-tight">{step.label}</div>
                  <div className={`text-xs leading-tight mt-0.5 ${isActive ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{step.desc}</div>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t">
          <button onClick={() => navigate("/")} className="text-xs text-muted-foreground hover:text-foreground">
            ← Kembali ke Dashboard
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-6 py-4 flex items-center gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            {STEPS.slice(0, activeIdx).map((s, i) => (
              <span key={s.id} className="flex items-center gap-1 text-xs">
                {i > 0 && <ChevronRight className="h-3 w-3" />}
                <span className="hover:text-foreground cursor-pointer" onClick={() => goTo(s.id)}>{s.label}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1 text-sm font-medium">
            {activeIdx > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            {activeStep?.icon}
            <span className="ml-1">{activeStep?.label}</span>
          </div>
          <Badge variant="outline" className="ml-auto text-xs">Langkah {activeIdx + 1} / {STEPS.length}</Badge>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-2xl">
            {activeStep?.id === "company"  && <StepCompany canEdit={canEdit} onComplete={goNext} />}
            {activeStep?.id === "whatsapp" && <StepWhatsApp onComplete={goNext} />}
            {activeStep?.id === "team"     && <StepTeam canEdit={canEdit} onComplete={goNext} />}
            {activeStep?.id === "customer" && <StepCustomer onComplete={goNext} />}
            {activeStep?.id === "vendor"   && <StepVendor onComplete={goNext} />}
            {activeStep?.id === "fleet"    && <StepFleet onComplete={goNext} />}
            {activeStep?.id === "test"     && <StepAiTest onComplete={goNext} />}
            {activeStep?.id === "done"     && <StepDone />}
          </div>
        </div>

        {/* Navigation footer */}
        {activeStep?.id !== "done" && (
          <div className="border-t px-6 py-3 flex items-center justify-between bg-background">
            <Button variant="ghost" size="sm" onClick={goPrev} disabled={activeIdx === 0}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Sebelumnya
            </Button>
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 w-6 rounded-full transition-colors ${i === activeIdx ? "bg-primary" : i < activeIdx ? "bg-primary/40" : "bg-muted"}`} />
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={goNext} className="text-muted-foreground text-xs">
              Lewati <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
