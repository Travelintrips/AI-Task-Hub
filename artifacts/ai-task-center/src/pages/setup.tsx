import { useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Setup() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      toast({ title: "Password minimal 8 karakter", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Konfirmasi password tidak cocok", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, companyId: "default" }),
      });

      const body = await res.json() as { message?: string; error?: string };

      if (!res.ok) {
        // 409 = setup already done
        if (res.status === 409) {
          toast({
            title: "Setup sudah selesai",
            description: "Silakan login dengan akun yang sudah ada.",
          });
          navigate("/");
          return;
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      setDone(true);
      toast({ title: "Akun admin berhasil dibuat! Mengalihkan ke login…" });

      // Auto-login with the new credentials
      await login(email, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Setup gagal";
      toast({ title: "Setup gagal", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2 font-bold text-primary text-xl">
            <Activity className="h-6 w-6" />
            <span>AI Task Center</span>
          </div>
          <p className="text-sm text-muted-foreground">Setup awal — buat akun Super Admin</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Buat Akun Admin Pertama
            </CardTitle>
            <CardDescription>
              Akun ini akan menjadi Super Admin dengan akses penuh ke seluruh sistem.
              Hanya bisa dilakukan sekali.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="text-center py-4 space-y-2">
                <ShieldCheck className="h-10 w-10 text-green-500 mx-auto" />
                <p className="font-medium">Akun berhasil dibuat</p>
                <p className="text-sm text-muted-foreground">Mengalihkan ke dashboard…</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nama Lengkap</Label>
                  <Input
                    id="name"
                    placeholder="Budi Santoso"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@perusahaan.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Min. 8 karakter"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Konfirmasi Password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    placeholder="Ulangi password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Membuat akun…" : "Buat Akun Super Admin"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Sudah punya akun?{" "}
          <a href="/" className="underline hover:text-foreground">Kembali ke login</a>
        </p>
      </div>
    </div>
  );
}
