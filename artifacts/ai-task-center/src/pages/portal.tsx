import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, LogIn, Eye, FileText, Ship, DollarSign, Clock, CheckCircle, AlertCircle, ArrowLeft, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, token: string) {
  const res = await fetch(`${BASE}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const STATUS_LABEL: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new_inquiry:         { label: "Inquiry Baru",       color: "bg-blue-100 text-blue-700",    icon: AlertCircle },
  waiting_documents:   { label: "Tunggu Dokumen",     color: "bg-amber-100 text-amber-700",  icon: FileText },
  documents_received:  { label: "Dokumen Diterima",   color: "bg-indigo-100 text-indigo-700",icon: CheckCircle },
  in_progress:         { label: "Sedang Diproses",    color: "bg-orange-100 text-orange-700",icon: Clock },
  completed:           { label: "Selesai",             color: "bg-green-100 text-green-700",  icon: CheckCircle },
  waiting_customer:    { label: "Menunggu Anda",      color: "bg-teal-100 text-teal-700",    icon: Clock },
  ready_for_review:    { label: "Siap Review",        color: "bg-violet-100 text-violet-700",icon: Eye },
  default:             { label: "Diproses",            color: "bg-gray-100 text-gray-700",    icon: Clock },
};

interface PortalTask {
  id: number;
  taskNumber: string | null;
  title: string;
  status: string;
  category: string | null;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

function LoginForm({ onLogin }: { onLogin: (token: string, name: string) => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [taskNumber, setTaskNumber] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!phone) { toast({ title: "Nomor WhatsApp wajib diisi", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/portal/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, taskNumber }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Login gagal", variant: "destructive" }); return; }
      onLogin(data.token, data.customerName ?? phone);
    } catch { toast({ title: "Koneksi gagal", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-3"><Shield className="h-7 w-7 text-white" /></div>
          <CardTitle className="text-xl">Portal Customer</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Masuk untuk melihat status pengiriman Anda</p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div><Label>Nomor WhatsApp *</Label><Input className="mt-1" placeholder="Contoh: 6281234567890" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><Label>Nomor Task (Opsional)</Label><Input className="mt-1" placeholder="Contoh: WA-2601-1234" value={taskNumber} onChange={(e) => setTaskNumber(e.target.value)} /></div>
          <Button className="w-full" onClick={handleLogin} disabled={loading || !phone}><LogIn className="h-4 w-4 mr-2" />{loading ? "Memverifikasi..." : "Masuk"}</Button>
          <p className="text-xs text-center text-muted-foreground">Login menggunakan nomor WhatsApp yang Anda daftarkan</p>
        </CardContent>
      </Card>
    </div>
  );
}

function TaskList({ token, name, onSelect, onLogout }: { token: string; name: string; onSelect: (id: number) => void; onLogout: () => void }) {
  const { data: tasks = [], isLoading } = useQuery<PortalTask[]>({
    queryKey: ["portal-tasks", token],
    queryFn: () => apiFetch("/portal/tasks", token),
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2"><div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center"><Shield className="h-4 w-4 text-primary" /></div><div><p className="font-semibold text-sm">Portal Customer</p><p className="text-xs text-muted-foreground">{name}</p></div></div>
        <Button variant="ghost" size="sm" onClick={onLogout} className="text-xs">Keluar</Button>
      </div>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <h2 className="font-semibold text-lg mt-2">Daftar Pengiriman Anda</h2>
        {isLoading ? <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
        : tasks.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground"><Ship className="h-10 w-10 mx-auto mb-3 opacity-30" /><p>Belum ada data pengiriman</p></CardContent></Card>
        : tasks.map((t) => {
          const st = STATUS_LABEL[t.status] ?? STATUS_LABEL.default;
          const Icon = st.icon;
          return (
            <Card key={t.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onSelect(t.id)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="text-xs text-muted-foreground font-mono">{t.taskNumber}</p><p className="font-semibold text-sm mt-0.5">{t.title}</p></div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 shrink-0 ${st.color}`}><Icon className="h-3 w-3" />{st.label}</span>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  {t.category && <span>{t.category}</span>}
                  <span>Dibuat {format(new Date(t.createdAt), "dd MMM yyyy", { locale: idLocale })}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TaskDetail({ token, taskId, onBack }: { token: string; taskId: number; onBack: () => void }) {
  const { data: task, isLoading } = useQuery({
    queryKey: ["portal-task", taskId, token],
    queryFn: () => apiFetch(`/portal/tasks/${taskId}`, token),
  });

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>;
  if (!task) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Task tidak ditemukan</div>;

  const st = STATUS_LABEL[task.status] ?? STATUS_LABEL.default;
  const StatusIcon = st.icon;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3 sticky top-0 z-10 shadow-sm">
        <Button variant="ghost" size="sm" onClick={onBack} className="p-0 h-auto"><ArrowLeft className="h-5 w-5" /></Button>
        <div><p className="font-semibold text-sm">{task.taskNumber}</p><p className="text-xs text-muted-foreground">{task.title}</p></div>
      </div>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div><p className="font-bold text-base">{task.title}</p>{task.category && <p className="text-sm text-muted-foreground">{task.category}</p>}</div>
            <span className={`text-sm px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5 ${st.color}`}><StatusIcon className="h-4 w-4" />{st.label}</span>
          </div>
        </CardContent></Card>

        {task.trackings?.length > 0 && (
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Ship className="h-4 w-4" />Tracking Pengiriman</CardTitle></CardHeader>
            <CardContent className="space-y-3">{task.trackings.map((tr: { id: number; trackingNumber: string | null; vesselName: string | null; portOfLoading: string | null; portOfDischarge: string | null; currentStatus: string | null; eta: string | null }) => (
              <div key={tr.id} className="text-sm space-y-1">
                {tr.trackingNumber && <p className="font-mono font-medium">{tr.trackingNumber}</p>}
                {tr.vesselName && <p className="text-muted-foreground">Kapal: {tr.vesselName}</p>}
                {tr.portOfLoading && tr.portOfDischarge && <p className="text-muted-foreground">{tr.portOfLoading} → {tr.portOfDischarge}</p>}
                {tr.currentStatus && <p className="text-green-700 font-medium">{tr.currentStatus}</p>}
                {tr.eta && <p className="text-muted-foreground">ETA: {format(new Date(tr.eta), "dd MMM yyyy", { locale: idLocale })}</p>}
              </div>
            ))}</CardContent></Card>
        )}

        {task.events?.length > 0 && (
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4" />Timeline Pengiriman</CardTitle></CardHeader>
            <CardContent><div className="space-y-3">
              {task.events.map((ev: { id: number; eventDescription: string; location: string | null; eventTime: string }) => (
                <div key={ev.id} className="flex gap-3 text-sm">
                  <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div><p className="font-medium">{ev.eventDescription}</p>{ev.location && <p className="text-muted-foreground text-xs">{ev.location}</p>}<p className="text-xs text-muted-foreground mt-0.5">{format(new Date(ev.eventTime), "dd MMM yyyy HH:mm", { locale: idLocale })}</p></div>
                </div>
              ))}
            </div></CardContent></Card>
        )}

        {task.quotations?.length > 0 && (
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Penawaran Harga</CardTitle></CardHeader>
            <CardContent className="space-y-3">{task.quotations.map((q: { id: number; quotationNumber: string | null; totalAmount: number; currency: string; status: string; validUntil: string | null }) => (
              <div key={q.id} className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center justify-between"><p className="font-mono text-xs">{q.quotationNumber}</p><Badge variant={q.status === "accepted" ? "default" : "secondary"}>{q.status === "accepted" ? "Diterima" : q.status === "sent" ? "Menunggu" : q.status}</Badge></div>
                <p className="font-bold text-lg mt-1">{new Intl.NumberFormat("id-ID", { style: "currency", currency: q.currency, minimumFractionDigits: 0 }).format(q.totalAmount ?? 0)}</p>
                {q.validUntil && <p className="text-xs text-muted-foreground">Valid s/d {format(new Date(q.validUntil), "dd MMM yyyy", { locale: idLocale })}</p>}
              </div>
            ))}</CardContent></Card>
        )}
      </div>
    </div>
  );
}

export default function PortalPage() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem("portal_token"));
  const [name, setName] = useState<string>(() => sessionStorage.getItem("portal_name") ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  const handleLogin = (t: string, n: string) => { sessionStorage.setItem("portal_token", t); sessionStorage.setItem("portal_name", n); setToken(t); setName(n); };
  const handleLogout = () => { sessionStorage.removeItem("portal_token"); sessionStorage.removeItem("portal_name"); setToken(null); setSelectedTaskId(null); };

  if (!token) return <LoginForm onLogin={handleLogin} />;
  if (selectedTaskId) return <TaskDetail token={token} taskId={selectedTaskId} onBack={() => setSelectedTaskId(null)} />;
  return <TaskList token={token} name={name} onSelect={setSelectedTaskId} onLogout={handleLogout} />;
}
