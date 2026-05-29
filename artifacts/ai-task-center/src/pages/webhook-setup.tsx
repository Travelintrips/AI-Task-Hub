import { useState } from "react";
import {
  Webhook,
  Copy,
  CheckCheck,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Smartphone,
  Server,
  Key,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

function CopyableCode({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-1">
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2 border">
        <code className="text-sm font-mono flex-1 break-all">{value}</code>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleCopy}
        >
          {copied ? (
            <CheckCheck className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
            {step}
          </div>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

export default function WebhookSetup() {
  const domain = window.location.origin;
  const fonnteWebhookUrl = `${domain}/api/webhook/fonnte`;
  const verifyToken =
    import.meta.env.VITE_WHATSAPP_WEBHOOK_VERIFY_TOKEN ??
    "(lihat secret WHATSAPP_WEBHOOK_VERIFY_TOKEN)";

  return (
    <div className="p-6 max-w-3xl mx-auto w-full space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Webhook className="h-6 w-6 text-green-600" />
          Panduan Konfigurasi Webhook
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hubungkan WhatsApp via Fonnte agar pesan masuk otomatis diproses oleh
          sistem
        </p>
      </div>

      {/* Alert info */}
      <Alert className="border-blue-200 bg-blue-50 text-blue-800">
        <AlertCircle className="h-4 w-4 text-blue-600" />
        <AlertDescription>
          Setelah webhook dikonfigurasi, setiap pesan WhatsApp yang masuk akan
          otomatis dideteksi oleh AI, dibuatkan task, dan dicatat di halaman
          Messages.
        </AlertDescription>
      </Alert>

      {/* Status badges */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="gap-1.5 py-1">
          <Server className="h-3 w-3 text-green-600" />
          Server aktif
        </Badge>
        <Badge variant="outline" className="gap-1.5 py-1">
          <Smartphone className="h-3 w-3 text-green-600" />
          Endpoint siap menerima pesan
        </Badge>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {/* Step 1 */}
        <StepCard step={1} title="Salin URL Webhook Server Ini">
          <p className="text-muted-foreground">
            URL berikut adalah endpoint server ini yang akan menerima pesan
            masuk dari Fonnte. Salin URL ini untuk digunakan di langkah
            berikutnya.
          </p>
          <CopyableCode
            value={fonnteWebhookUrl}
            label="URL Webhook Fonnte"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-amber-800 text-xs">
            <p className="font-semibold mb-1">Penting:</p>
            <p>
              URL ini berisi domain Replit Anda yang aktif. Jika domain berubah
              (misal setelah publish ke domain kustom), URL ini perlu diperbarui
              di dashboard Fonnte.
            </p>
          </div>
        </StepCard>

        {/* Step 2 */}
        <StepCard step={2} title="Login ke Dashboard Fonnte">
          <p className="text-muted-foreground">
            Buka dashboard Fonnte dan masuk ke pengaturan webhook perangkat Anda.
          </p>
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a
              href="https://fonnte.com/account/webhook"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Buka Dashboard Fonnte
            </a>
          </Button>
          <ol className="list-none space-y-2 mt-2">
            {[
              "Login ke akun Fonnte Anda",
              'Pilih menu "Device" → pilih perangkat WhatsApp yang digunakan',
              'Cari bagian "Webhook" atau "Incoming Message"',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-muted-foreground">
                <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                {step}
              </li>
            ))}
          </ol>
        </StepCard>

        {/* Step 3 */}
        <StepCard step={3} title="Tempel URL Webhook & Simpan">
          <p className="text-muted-foreground">
            Di kolom URL Webhook Fonnte, tempel URL yang sudah disalin di Langkah 1,
            lalu simpan pengaturan.
          </p>
          <CopyableCode
            value={fonnteWebhookUrl}
            label="Tempel URL ini ke kolom webhook Fonnte"
          />
          <div className="bg-green-50 border border-green-200 rounded-md p-3 text-green-800 text-xs space-y-1">
            <p className="font-semibold flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Tips verifikasi:
            </p>
            <p>
              Kirim pesan WhatsApp ke nomor yang terdaftar di Fonnte. Pesan
              tersebut akan muncul di halaman <strong>Messages</strong> dalam
              beberapa detik.
            </p>
          </div>
        </StepCard>

        {/* Step 4 — opsional: Meta / WhatsApp Business */}
        <StepCard step={4} title="(Opsional) Webhook Meta WhatsApp Business API">
          <p className="text-muted-foreground">
            Jika Anda menggunakan Meta WhatsApp Business API secara langsung
            (bukan via Fonnte), gunakan endpoint berikut di Meta Developer
            Console.
          </p>
          <CopyableCode
            value={`${domain}/api/webhook/whatsapp`}
            label="URL Webhook Meta"
          />
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Key className="h-3 w-3" /> Verify Token
              </p>
              <div className="bg-muted rounded-md px-3 py-2 border text-xs font-mono break-all">
                {verifyToken}
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-1 pt-5">
              <p>Masukkan Verify Token di atas saat melakukan verifikasi webhook di Meta Developer Console.</p>
            </div>
          </div>
        </StepCard>
      </div>

      {/* Checklist */}
      <Card className="border-green-200 bg-green-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-green-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Checklist Setelah Konfigurasi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-green-800">
            {[
              "URL webhook sudah ditempel di dashboard Fonnte",
              "Kirim pesan uji coba ke nomor WhatsApp bisnis",
              "Cek halaman Messages — pesan harus muncul dalam hitungan detik",
              "Cek halaman AI Tasks — task otomatis dibuat dari pesan masuk",
              "Cek halaman Notif WA — riwayat notifikasi keluar sudah tercatat",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
