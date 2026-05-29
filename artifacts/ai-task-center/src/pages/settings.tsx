import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, Building2, MessageSquare, Smartphone, Save,
  CheckCircle2, XCircle, Loader2, Eye, EyeOff, Send, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SettingsData {
  companyId: string;
  companyName: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  companyEmail: string | null;
  fonnteToken: string | null;
  fonnteConfigured: boolean;
  whatsappPhoneNumberId: string | null;
  whatsappToken: string | null;
  whatsappWebhookVerifyToken: string | null;
  whatsappConfigured: boolean;
  templateMissingDoc: string | null;
  templateNewTask: string | null;
  templateAssignment: string | null;
  templateProgress: string | null;
  templateApproval: string | null;
  templateCompleted: string | null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function authHeader(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchSettings(): Promise<SettingsData> {
  const res = await fetch("/api/settings", { headers: authHeader() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function saveSettings(data: Partial<SettingsData>): Promise<{ success: boolean; message: string }> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Gagal menyimpan" }));
    throw new Error(err.error ?? "Gagal menyimpan");
  }
  return res.json();
}

async function testFonnte(phone: string, token?: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const res = await fetch("/api/settings/test-fonnte", {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ phone, token }),
  });
  return res.json();
}

// ─── Masked input ─────────────────────────────────────────────────────────────

function TokenInput({
  label, value, onChange, placeholder, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  const isMasked = value.startsWith("••••••••");

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="relative">
        <Input
          type={show || isMasked ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-10 font-mono text-sm"
        />
        {!isMasked && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
      {isMasked && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <Info className="w-3 h-3" />
          Token sudah tersimpan. Ketik token baru untuk menggantinya.
        </p>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 text-xs">
      <CheckCircle2 className="w-3 h-3" /> Terhubung
    </Badge>
  ) : (
    <Badge className="bg-red-100 text-red-700 border-red-200 gap-1 text-xs">
      <XCircle className="w-3 h-3" /> Belum dikonfigurasi
    </Badge>
  );
}

// ─── Default templates ────────────────────────────────────────────────────────

const DEFAULT_TEMPLATES: Record<string, string> = {
  templateMissingDoc: `Halo {customerName}, selamat {greeting}.\n\nKami membutuhkan dokumen berikut untuk melanjutkan proses {taskNumber}:\n{missingDocs}\n\nMohon segera kirimkan agar proses dapat kami lanjutkan.\n\nTerima kasih,\n{companyName}`,
  templateNewTask: `Halo {customerName}, terima kasih telah menghubungi kami.\n\nPermintaan Anda telah kami terima dan diberi nomor task {taskNumber}.\nKami akan segera menindaklanjutinya.\n\nSalam,\n{companyName}`,
  templateAssignment: `Halo {customerName}, task Anda {taskNumber} telah kami assign ke {assignedTo}.\n\nMereka akan segera menghubungi Anda.\n\nTerima kasih,\n{companyName}`,
  templateProgress: `Halo {customerName}, update untuk task {taskNumber}:\n\n{progressNote}\n\nJika ada pertanyaan, silakan hubungi kami.\n\nSalam,\n{companyName}`,
  templateApproval: `Halo {customerName}, task {taskNumber} telah selesai dikerjakan.\n\nMohon konfirmasi persetujuan Anda dengan membalas pesan ini.\n\nTerima kasih,\n{companyName}`,
  templateCompleted: `Halo {customerName}, task {taskNumber} telah selesai! 🎉\n\nTerima kasih atas kepercayaan Anda. Kami siap membantu kembali kapan saja.\n\nSalam,\n{companyName}`,
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isAdmin = user?.role === "super_admin" || user?.role === "company_admin";

  const { data, isLoading } = useQuery<SettingsData>({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  // Form state
  const [form, setForm] = useState<Partial<SettingsData>>({});
  const [testPhone, setTestPhone] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = (key: keyof SettingsData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "Pengaturan berhasil disimpan ✅" });
    },
    onError: (err: Error) => {
      toast({ title: "Gagal menyimpan", description: err.message, variant: "destructive" });
    },
  });

  const handleTest = async () => {
    if (!testPhone) {
      toast({ title: "Nomor HP wajib diisi", variant: "destructive" });
      return;
    }
    setIsTesting(true);
    try {
      const result = await testFonnte(testPhone, form.fonnteToken ?? undefined);
      if (result.success) {
        toast({ title: "Pesan tes berhasil terkirim ✅", description: result.message });
      } else {
        toast({ title: "Gagal mengirim", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Gagal menghubungi server", variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 gap-2">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="text-sm">Memuat pengaturan…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-5 pb-4 border-b bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-blue-500" />
              Pengaturan
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Konfigurasi perusahaan, WhatsApp, dan template pesan
            </p>
          </div>
          {isAdmin && (
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
              className="gap-1.5"
            >
              {saveMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Save className="w-4 h-4" />}
              Simpan
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 sm:px-6 py-5">
        <Tabs defaultValue="company">
          <TabsList className="mb-5">
            <TabsTrigger value="company" className="gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> Perusahaan
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="gap-1.5">
              <Smartphone className="w-3.5 h-3.5" /> WhatsApp
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Template Pesan
            </TabsTrigger>
          </TabsList>

          {/* ── Tab Perusahaan ── */}
          <TabsContent value="company">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Informasi Perusahaan</CardTitle>
                <CardDescription>
                  Data ini digunakan dalam template pesan WhatsApp yang dikirim ke pelanggan.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Nama Perusahaan</Label>
                    <Input
                      value={form.companyName ?? ""}
                      onChange={(e) => set("companyName", e.target.value)}
                      placeholder="PT Contoh Indonesia"
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email Perusahaan</Label>
                    <Input
                      type="email"
                      value={form.companyEmail ?? ""}
                      onChange={(e) => set("companyEmail", e.target.value)}
                      placeholder="info@perusahaan.com"
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nomor HP / WhatsApp Perusahaan</Label>
                    <Input
                      value={form.companyPhone ?? ""}
                      onChange={(e) => set("companyPhone", e.target.value)}
                      placeholder="628123456789"
                      disabled={!isAdmin}
                    />
                    <p className="text-xs text-gray-400">Format internasional tanpa tanda + (contoh: 628123456789)</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Alamat Perusahaan</Label>
                  <Textarea
                    value={form.companyAddress ?? ""}
                    onChange={(e) => set("companyAddress", e.target.value)}
                    placeholder="Jl. Contoh No. 123, Jakarta"
                    rows={3}
                    disabled={!isAdmin}
                  />
                </div>
                {!isAdmin && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Hanya admin yang dapat mengubah pengaturan ini.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab WhatsApp ── */}
          <TabsContent value="whatsapp" className="space-y-4">
            {/* Fonnte */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Fonnte Gateway</CardTitle>
                    <CardDescription>
                      Gateway WhatsApp utama untuk mengirim notifikasi ke pelanggan.
                    </CardDescription>
                  </div>
                  <StatusBadge configured={data?.fonnteConfigured ?? false} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isAdmin ? (
                  <TokenInput
                    label="Fonnte Token"
                    value={form.fonnteToken ?? ""}
                    onChange={(v) => set("fonnteToken", v)}
                    placeholder="Masukkan Fonnte API token"
                    hint="Dapatkan token dari dashboard.fonnte.com"
                  />
                ) : (
                  <div className="text-sm text-gray-500">
                    {data?.fonnteConfigured ? "Token sudah dikonfigurasi." : "Token belum dikonfigurasi."}
                  </div>
                )}

                {/* Test kirim */}
                <div className="border-t pt-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Uji Kirim Pesan</p>
                  <div className="flex gap-2">
                    <Input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="628123456789"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      onClick={handleTest}
                      disabled={isTesting || (!data?.fonnteConfigured && !form.fonnteToken)}
                      className="gap-1.5 flex-shrink-0"
                    >
                      {isTesting
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Send className="w-4 h-4" />}
                      Kirim Tes
                    </Button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Masukkan nomor HP tujuan (format internasional) lalu klik Kirim Tes untuk memverifikasi koneksi.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* WhatsApp Business API */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">WhatsApp Business API (Meta)</CardTitle>
                    <CardDescription>
                      Untuk menerima pesan masuk via webhook dari Meta. Opsional jika sudah menggunakan Fonnte.
                    </CardDescription>
                  </div>
                  <StatusBadge configured={data?.whatsappConfigured ?? false} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isAdmin ? (
                  <>
                    <div className="space-y-1.5">
                      <Label>Phone Number ID</Label>
                      <Input
                        value={form.whatsappPhoneNumberId ?? ""}
                        onChange={(e) => set("whatsappPhoneNumberId", e.target.value)}
                        placeholder="Masukkan Phone Number ID dari Meta"
                        className="font-mono text-sm"
                      />
                    </div>
                    <TokenInput
                      label="Access Token"
                      value={form.whatsappToken ?? ""}
                      onChange={(v) => set("whatsappToken", v)}
                      placeholder="Masukkan WhatsApp Access Token"
                      hint="Dari Meta Developer Console → WhatsApp → API Setup"
                    />
                    <div className="space-y-1.5">
                      <Label>Webhook Verify Token</Label>
                      <Input
                        value={form.whatsappWebhookVerifyToken ?? ""}
                        onChange={(e) => set("whatsappWebhookVerifyToken", e.target.value)}
                        placeholder="Token verifikasi webhook (bebas pilih)"
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-gray-400">
                        Gunakan token ini saat setup webhook di Meta Developer Console.
                        URL webhook:{" "}
                        <code className="bg-gray-100 px-1 rounded text-xs">
                          https://your-domain/api/webhook/whatsapp
                        </code>
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500">
                    {data?.whatsappConfigured ? "WhatsApp Business API sudah dikonfigurasi." : "Belum dikonfigurasi."}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab Template ── */}
          <TabsContent value="templates" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Template Pesan WhatsApp</CardTitle>
                <CardDescription>
                  Kustomisasi pesan yang dikirim otomatis ke pelanggan. Variabel yang tersedia:{" "}
                  <code className="bg-gray-100 px-1 rounded text-xs">
                    {"{customerName}"} {"{taskNumber}"} {"{companyName}"} {"{assignedTo}"} {"{greeting}"} {"{missingDocs}"} {"{progressNote}"}
                  </code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {(
                  [
                    { key: "templateNewTask",    label: "📋 Konfirmasi Tugas Baru" },
                    { key: "templateMissingDoc", label: "📄 Permintaan Dokumen" },
                    { key: "templateAssignment", label: "👤 Notifikasi Assignee" },
                    { key: "templateProgress",   label: "🔄 Update Progress" },
                    { key: "templateApproval",   label: "✅ Permintaan Persetujuan" },
                    { key: "templateCompleted",  label: "🎉 Tugas Selesai" },
                  ] as { key: keyof SettingsData; label: string }[]
                ).map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">{label}</Label>
                      {isAdmin && !form[key] && (
                        <button
                          type="button"
                          className="text-xs text-blue-500 hover:underline"
                          onClick={() => set(key, DEFAULT_TEMPLATES[key] ?? "")}
                        >
                          Gunakan default
                        </button>
                      )}
                    </div>
                    <Textarea
                      value={(form[key] as string) ?? ""}
                      onChange={(e) => set(key, e.target.value)}
                      placeholder={DEFAULT_TEMPLATES[key]}
                      rows={5}
                      disabled={!isAdmin}
                      className="text-sm font-mono resize-y"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
