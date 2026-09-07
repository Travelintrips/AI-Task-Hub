import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { useAuth } from "@/contexts/auth-context";
import {
  Building2, User, MessageSquare, Package, Database,
  CheckCircle2, XCircle, Rocket, ChevronRight, ChevronLeft,
  Loader2, Star, RefreshCw, Copy, Eye, EyeOff, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── API helper ────────────────────────────────────────────────────────────────
function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getStoredToken();
  return fetch(`/api/company-onboarding${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  }).then(async (r) => {
    if (!r.ok) {
      const body = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `Error ${r.status}`);
    }
    return r.json() as Promise<T>;
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Template {
  label: string; description: string; industry: string;
  modules: string[]; starterIntents: string[];
}

interface ModuleDef { key: string; label: string; description: string }

interface ReadinessCheck {
  name: string; passed: boolean; weight: number; detail: string;
}

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Profil",    icon: Building2 },
  { id: 2, label: "Admin",     icon: User },
  { id: 3, label: "WhatsApp",  icon: MessageSquare },
  { id: 4, label: "Modul",     icon: Package },
  { id: 5, label: "Data Awal", icon: Database },
  { id: 6, label: "Readiness", icon: CheckCircle2 },
  { id: 7, label: "Go Live",   icon: Rocket },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-between px-2 py-4 overflow-x-auto">
      {STEPS.map((s, i) => {
        const done    = current > s.id;
        const active  = current === s.id;
        const Icon    = s.icon;
        return (
          <div key={s.id} className="flex items-center">
            <div className={cn(
              "flex flex-col items-center gap-1 min-w-[52px]",
            )}>
              <div className={cn(
                "h-9 w-9 rounded-full flex items-center justify-center border-2 transition-all",
                done   ? "bg-green-500 border-green-500 text-white" :
                active ? "bg-primary border-primary text-white" :
                         "bg-muted border-muted-foreground/30 text-muted-foreground",
              )}>
                {done ? <CheckCircle2 className="h-4.5 w-4.5" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={cn(
                "text-[10px] font-medium text-center whitespace-nowrap",
                active ? "text-primary" : done ? "text-green-600" : "text-muted-foreground",
              )}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn("h-px flex-1 mx-1 mt-[-14px]", done ? "bg-green-400" : "bg-muted")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700 flex items-start gap-2">
      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
      {msg}
    </div>
  );
}

// ── Step 1: Company Profile ───────────────────────────────────────────────────
function Step1Profile({
  templates, modules, onDone,
}: {
  templates: Record<string, Template>;
  modules: ModuleDef[];
  onDone: (companyId: string) => void;
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [companyId, setCompanyId]     = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry]       = useState("");
  const [phone, setPhone]             = useState("");
  const [email, setEmail]             = useState("");
  const [address, setAddress]         = useState("");
  const [error, setError]             = useState("");

  const applyTemplate = (key: string) => {
    const t = templates[key];
    if (!t) return;
    setSelectedTemplate(key);
    setIndustry(t.industry);
  };

  const mutation = useMutation({
    mutationFn: () => apiFetch<{ companyId: string }>("/create", {
      method: "POST",
      body: JSON.stringify({ companyId, companyName, industry, phone, email, address, templateKey: selectedTemplate || undefined }),
    }),
    onSuccess: (data) => { setError(""); onDone(data.companyId); },
    onError: (e: Error) => setError(e.message),
  });

  const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-base mb-1">Pilih Template (opsional)</h3>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(templates).map(([key, t]) => (
            <button
              key={key}
              onClick={() => applyTemplate(key)}
              className={cn(
                "border rounded-lg p-3 text-left transition-all hover:border-primary/60",
                selectedTemplate === key ? "border-primary bg-primary/5" : "border-muted",
              )}
            >
              <p className="text-sm font-semibold">{t.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
              {selectedTemplate === key && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {t.modules.map(m => (
                    <span key={m} className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">{m}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t pt-4 space-y-3">
        <h3 className="font-semibold text-base">Profil Perusahaan</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>Company ID <span className="text-red-500">*</span></Label>
            <div className="flex gap-2">
              <Input
                value={companyId}
                onChange={e => setCompanyId(slugify(e.target.value))}
                placeholder="contoh: pt_maju_jaya"
                className="font-mono text-sm"
              />
              {companyName && (
                <Button variant="outline" size="sm" type="button"
                  onClick={() => setCompanyId(slugify(companyName))}>
                  Auto
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Lowercase, huruf/angka/underscore. Tidak bisa diubah.</p>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Nama Perusahaan <span className="text-red-500">*</span></Label>
            <Input value={companyName} onChange={e => { setCompanyName(e.target.value); if (!companyId) setCompanyId(slugify(e.target.value)); }} placeholder="PT Maju Jaya Indonesia" />
          </div>
          <div className="space-y-1">
            <Label>Industri</Label>
            <Input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="logistics / trading / dll" />
          </div>
          <div className="space-y-1">
            <Label>Telepon</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="08xxx" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@perusahaan.com" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Alamat</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Jl. Sudirman No. 1, Jakarta" />
          </div>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}
      <Button
        className="w-full"
        disabled={!companyId || !companyName || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Buat Profil Perusahaan <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

// ── Step 2: Admin User ────────────────────────────────────────────────────────
function Step2Admin({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole]   = useState<"owner" | "company_admin">("owner");
  const [result, setResult] = useState<{
    email: string; role: string; temporaryPassword: string; activationLink: string;
  } | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError]   = useState("");

  const mutation = useMutation({
    mutationFn: () => apiFetch<{
      email: string; role: string; temporaryPassword: string; activationLink: string;
    }>(`/${companyId}/admin`, {
      method: "POST",
      body: JSON.stringify({ name, email, role }),
    }),
    onSuccess: (data) => { setResult(data); setError(""); },
    onError: (e: Error) => setError(e.message),
  });

  if (result) {
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span className="font-semibold text-green-700">Admin user berhasil dibuat!</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Email:</span>
              <code className="bg-white px-2 py-0.5 rounded border">{result.email}</code>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Role:</span>
              <Badge>{result.role}</Badge>
            </div>
            <div className="flex justify-between items-center gap-2">
              <span className="text-muted-foreground shrink-0">Password sementara:</span>
              <div className="flex items-center gap-1">
                <code className="bg-white px-2 py-0.5 rounded border font-mono text-xs">
                  {showPwd ? result.temporaryPassword : "••••••••"}
                </code>
                <button onClick={() => setShowPwd(!showPwd)} className="text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(result.temporaryPassword)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">⚠️ Simpan password ini sekarang — tidak akan ditampilkan lagi.</p>
        </div>
        <Button className="w-full" onClick={onDone}>
          Lanjut ke WhatsApp <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Buat akun pertama untuk perusahaan ini. Password sementara akan dibuat otomatis.</p>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Nama Lengkap <span className="text-red-500">*</span></Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ahmad Fauzi" />
        </div>
        <div className="space-y-1">
          <Label>Email <span className="text-red-500">*</span></Label>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@perusahaan.com" />
        </div>
        <div className="space-y-1">
          <Label>Role</Label>
          <div className="flex gap-2">
            {(["owner", "company_admin"] as const).map(r => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "flex-1 border rounded-md py-2 text-sm font-medium transition-all",
                  role === r ? "border-primary bg-primary/5 text-primary" : "border-muted text-muted-foreground hover:border-primary/40",
                )}
              >{r}</button>
            ))}
          </div>
        </div>
      </div>
      {error && <ErrorBox msg={error} />}
      <Button className="w-full" disabled={!name || !email || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Buat Admin User <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

// ── Step 3: WhatsApp ──────────────────────────────────────────────────────────
function Step3WhatsApp({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (skip: boolean) => apiFetch(`/${companyId}/whatsapp`, {
      method: "POST",
      body: JSON.stringify({ fonnteToken: token || undefined, skip }),
    }),
    onSuccess: () => { setError(""); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
        <p className="font-medium mb-1">Fonnte WhatsApp Gateway</p>
        <p>Dapatkan API token dari <a href="https://fonnte.com" target="_blank" rel="noopener" className="underline">fonnte.com</a>. Tanpa ini, notifikasi WhatsApp tidak akan berfungsi.</p>
      </div>
      <div className="space-y-1">
        <Label>Fonnte API Token</Label>
        <Input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="Masukkan token dari fonnte.com"
        />
      </div>
      {error && <ErrorBox msg={error} />}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => mutation.mutate(true)}>
          Lewati (atur nanti)
        </Button>
        <Button
          className="flex-1"
          disabled={!token || mutation.isPending}
          onClick={() => mutation.mutate(false)}
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Simpan & Lanjut <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Module Selection ──────────────────────────────────────────────────
function Step4Modules({
  companyId, modules, templateModules, onDone,
}: {
  companyId: string; modules: ModuleDef[]; templateModules: string[]; onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(templateModules));
  const [error, setError]       = useState("");

  const toggle = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/${companyId}/modules`, {
      method: "POST",
      body: JSON.stringify({ modules: Array.from(selected) }),
    }),
    onSuccess: () => { setError(""); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Pilih modul yang akan aktif untuk perusahaan ini. Dapat diubah kapan saja.</p>
      <div className="grid grid-cols-1 gap-2">
        {modules.map(m => {
          const isSelected = selected.has(m.key);
          return (
            <button
              key={m.key}
              onClick={() => toggle(m.key)}
              className={cn(
                "flex items-start gap-3 border rounded-lg p-3 text-left transition-all",
                isSelected ? "border-primary bg-primary/5" : "border-muted hover:border-primary/40",
              )}
            >
              <div className={cn(
                "h-5 w-5 rounded border-2 mt-0.5 flex items-center justify-center shrink-0 transition-all",
                isSelected ? "bg-primary border-primary" : "border-muted-foreground/30",
              )}>
                {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
              </div>
              <div>
                <p className="text-sm font-semibold">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{selected.size} modul dipilih</p>
      {error && <ErrorBox msg={error} />}
      <Button
        className="w-full"
        disabled={selected.size === 0 || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Simpan Modul <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

// ── Step 5: Initial Data ──────────────────────────────────────────────────────
function Step5Seed({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const [customerLine, setCustomerLine]   = useState("");
  const [vendorLine, setVendorLine]       = useState("");
  const [teamLine, setTeamLine]           = useState("");
  const [error, setError]                 = useState("");

  const parseLine = (raw: string) =>
    raw.split("\n").map(s => s.trim()).filter(Boolean).map(s => ({ name: s }));

  const mutation = useMutation({
    mutationFn: (skip: boolean) => apiFetch<{ results: Record<string, number> }>(`/${companyId}/seed`, {
      method: "POST",
      body: JSON.stringify({
        skip,
        customers:   parseLine(customerLine),
        vendors:     parseLine(vendorLine),
        teamMembers: parseLine(teamLine),
      }),
    }),
    onSuccess: () => { setError(""); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Isi data awal opsional (satu nama per baris), atau lewati dan isi nanti.</p>
      <div className="space-y-3">
        {[
          { label: "Pelanggan (nama, satu per baris)", value: customerLine, onChange: setCustomerLine, ph: "PT ABC\nCV XYZ" },
          { label: "Vendor / Supplier (nama, satu per baris)", value: vendorLine, onChange: setVendorLine, ph: "Vendor Utama\nSuplier B" },
          { label: "Anggota Tim (nama, satu per baris)", value: teamLine, onChange: setTeamLine, ph: "Ahmad Fauzi\nBudi Santoso" },
        ].map(f => (
          <div key={f.label} className="space-y-1">
            <Label>{f.label}</Label>
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm min-h-[72px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder={f.ph}
              value={f.value}
              onChange={e => f.onChange(e.target.value)}
            />
          </div>
        ))}
      </div>
      {error && <ErrorBox msg={error} />}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => mutation.mutate(true)}>
          Lewati (isi nanti)
        </Button>
        <Button className="flex-1" disabled={mutation.isPending} onClick={() => mutation.mutate(false)}>
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Seed Data <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 6: Readiness Check ───────────────────────────────────────────────────
function Step6Readiness({ companyId, onDone }: { companyId: string; onDone: (pct: number) => void }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["readiness", companyId],
    queryFn: () => apiFetch<{
      readinessPct: number; isReady: boolean; checks: ReadinessCheck[]; message: string;
    }>(`/${companyId}/readiness`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Menghitung readiness...</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card className={cn("border-2", data.isReady ? "border-green-400" : "border-yellow-400")}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold">Readiness Score</span>
            <span className={cn("text-2xl font-bold", data.isReady ? "text-green-600" : "text-yellow-600")}>
              {data.readinessPct}%
            </span>
          </div>
          <Progress value={data.readinessPct} className="h-3 mb-2" />
          <p className="text-sm text-muted-foreground">{data.message}</p>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {data.checks.map(c => (
          <div key={c.name} className="flex items-center gap-3 py-1.5 border-b last:border-0">
            {c.passed
              ? <CheckCircle2 className="h-4.5 w-4.5 text-green-500 shrink-0" />
              : <XCircle className="h-4.5 w-4.5 text-red-400 shrink-0" />}
            <div className="flex-1">
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.detail}</p>
            </div>
            <span className="text-xs text-muted-foreground">{c.weight}%</span>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={() => refetch()}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
      </Button>
      {data.isReady ? (
        <Button className="w-full" onClick={() => onDone(data.readinessPct)}>
          Lanjut ke Go Live <Rocket className="h-4 w-4 ml-1.5" />
        </Button>
      ) : (
        <p className="text-xs text-center text-muted-foreground">Lengkapi semua item wajib lalu refresh untuk lanjut ke Go Live</p>
      )}
    </div>
  );
}

// ── Step 7: Go Live ───────────────────────────────────────────────────────────
function Step7GoLive({ companyId, readinessPct }: { companyId: string; readinessPct: number }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<{
    companyName: string; wentLiveAt: string; readinessPct: number;
    welcomeChecklist: Array<{ item: string; done: boolean }>; message: string;
  } | null>(null);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => apiFetch<typeof result>(`/${companyId}/go-live`, { method: "POST" }),
    onSuccess: (data) => {
      setResult(data);
      setError("");
      qc.invalidateQueries({ queryKey: ["gov-companies"] });
      qc.invalidateQueries({ queryKey: ["gov-health"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (result) {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
            <Rocket className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-green-700">{result?.message}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {result?.wentLiveAt ? new Date(result.wentLiveAt).toLocaleString("id-ID") : ""}
          </p>
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Welcome Checklist</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {result?.welcomeChecklist?.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <div className="h-4 w-4 rounded border border-muted-foreground/30 shrink-0" />
                {c.item}
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
          Perusahaan sudah aktif. Admin bisa login di halaman utama menggunakan kredensial yang dibuat di Step 2.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-2 border-primary/30 bg-primary/5">
        <CardContent className="p-5 text-center">
          <Zap className="h-10 w-10 text-primary mx-auto mb-3" />
          <h3 className="text-lg font-bold mb-1">Siap Go Live!</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Readiness score: <span className="font-bold text-green-600">{readinessPct}%</span>
          </p>
          <ul className="text-sm text-left space-y-1.5 mb-4">
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />Profil perusahaan terdaftar</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />Admin user aktif</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />Modul dikonfigurasi</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />Audit log akan direkam</li>
          </ul>
        </CardContent>
      </Card>
      {error && <ErrorBox msg={error} />}
      <Button className="w-full h-12 text-base" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending
          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Mengaktifkan perusahaan...</>
          : <><Rocket className="h-5 w-5 mr-2" />🚀 Go Live Sekarang!</>}
      </Button>
    </div>
  );
}

// ── Sessions List ─────────────────────────────────────────────────────────────
function SessionsList() {
  const { data, isLoading } = useQuery({
    queryKey: ["onboarding-sessions"],
    queryFn: () => apiFetch<{
      sessions: Array<{
        company_id: string; company_name: string | null; template_used: string | null;
        current_step: number; readiness_pct: number; went_live_at: string | null; created_at: string;
        profile_done: boolean; admin_done: boolean; wa_done: boolean; modules_done: boolean;
      }>;
    }>("/sessions"),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Memuat sesi...</div>;
  if (!data?.sessions?.length) return (
    <Card className="p-6 text-center">
      <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <p className="font-medium">Belum ada sesi onboarding</p>
      <p className="text-sm text-muted-foreground">Mulai onboarding perusahaan baru di atas</p>
    </Card>
  );

  const stepLabel = ["", "Profil", "Admin", "WhatsApp", "Modul", "Data Awal", "Readiness", "Go Live"];

  return (
    <div className="space-y-2">
      {data.sessions.map(s => (
        <Card key={s.company_id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{s.company_name ?? s.company_id}</p>
                <p className="text-xs text-muted-foreground">{s.company_id} · {s.template_used ?? "no template"}</p>
              </div>
              <div className="text-right shrink-0">
                {s.went_live_at
                  ? <Badge className="bg-green-100 text-green-700 border-green-200">🚀 Live</Badge>
                  : <Badge variant="secondary">Step {s.current_step}: {stepLabel[s.current_step] ?? "?"}</Badge>}
              </div>
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Readiness</span><span>{s.readiness_pct}%</span>
              </div>
              <Progress value={s.readiness_pct} className="h-1.5" />
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {[
                { label: "Profil", done: s.profile_done },
                { label: "Admin",  done: s.admin_done },
                { label: "WA",     done: s.wa_done },
                { label: "Modul",  done: s.modules_done },
              ].map(c => (
                <span key={c.label} className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full border font-medium",
                  c.done ? "bg-green-50 text-green-600 border-green-200" : "bg-gray-50 text-gray-400 border-gray-200",
                )}>
                  {c.done ? "✓" : "○"} {c.label}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CompanyOnboardingFactoryPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [mode, setMode] = useState<"list" | "wizard">("list");
  const [step, setStep]               = useState(1);
  const [companyId, setCompanyId]     = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [readinessPct, setReadinessPct] = useState(0);

  const { data: templateData } = useQuery({
    queryKey: ["onboarding-templates"],
    queryFn: () => apiFetch<{ templates: Record<string, Template>; modules: ModuleDef[] }>("/templates"),
  });

  const startWizard = () => { setStep(1); setCompanyId(""); setMode("wizard"); };

  const templates = templateData?.templates ?? {};
  const modules   = templateData?.modules ?? [];
  const templateModules = selectedTemplate ? (templates[selectedTemplate]?.modules ?? []) : [];

  if (mode === "list") {
    return (
      <div className="flex-1 space-y-4 p-4 sm:p-6 overflow-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Company Onboarding Factory</h1>
              <p className="text-sm text-muted-foreground">Perusahaan baru siap operasional dalam &lt;15 menit · Sprint 10B-2</p>
            </div>
          </div>
          {isSuperAdmin && (
            <Button onClick={startWizard}>
              <Building2 className="h-4 w-4 mr-2" />Onboard Perusahaan Baru
            </Button>
          )}
        </div>

        {!isSuperAdmin && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="p-4 text-sm text-yellow-700">
              Hanya super_admin yang dapat membuat perusahaan baru. Hubungi administrator sistem.
            </CardContent>
          </Card>
        )}

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Sesi Onboarding</h2>
          <SessionsList />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 overflow-auto">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={() => setMode("list")}>
            <ChevronLeft className="h-4 w-4 mr-1" />Kembali
          </Button>
          <div>
            <h1 className="text-lg font-bold">Onboarding Perusahaan Baru</h1>
            {companyId && <p className="text-xs text-muted-foreground">ID: {companyId}</p>}
          </div>
        </div>

        <StepIndicator current={step} />

        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {(() => { const S = STEPS.find(s => s.id === step); return S ? <S.icon className="h-4.5 w-4.5 text-primary" /> : null; })()}
              Step {step}: {STEPS.find(s => s.id === step)?.label}
            </CardTitle>
            {step === 1 && <CardDescription>Daftarkan identitas perusahaan baru</CardDescription>}
            {step === 2 && <CardDescription>Buat akun admin pertama untuk {companyId}</CardDescription>}
            {step === 3 && <CardDescription>Konfigurasi WhatsApp untuk notifikasi otomatis</CardDescription>}
            {step === 4 && <CardDescription>Pilih modul yang akan diaktifkan</CardDescription>}
            {step === 5 && <CardDescription>Seed data awal opsional (pelanggan, vendor, tim)</CardDescription>}
            {step === 6 && <CardDescription>Verifikasi kesiapan sebelum Go Live</CardDescription>}
            {step === 7 && <CardDescription>Aktifkan perusahaan dan mulai beroperasi</CardDescription>}
          </CardHeader>
          <CardContent>
            {step === 1 && (
              <Step1Profile
                templates={templates}
                modules={modules}
                onDone={(id) => {
                  setCompanyId(id);
                  setStep(2);
                }}
              />
            )}
            {step === 2 && <Step2Admin companyId={companyId} onDone={() => setStep(3)} />}
            {step === 3 && <Step3WhatsApp companyId={companyId} onDone={() => setStep(4)} />}
            {step === 4 && (
              <Step4Modules
                companyId={companyId}
                modules={modules}
                templateModules={templateModules}
                onDone={() => setStep(5)}
              />
            )}
            {step === 5 && <Step5Seed companyId={companyId} onDone={() => setStep(6)} />}
            {step === 6 && (
              <Step6Readiness
                companyId={companyId}
                onDone={(pct) => { setReadinessPct(pct); setStep(7); }}
              />
            )}
            {step === 7 && <Step7GoLive companyId={companyId} readinessPct={readinessPct} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
