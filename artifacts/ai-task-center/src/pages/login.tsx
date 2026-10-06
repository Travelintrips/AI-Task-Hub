import { useEffect, useRef, useState } from "react";
import { Activity, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { apiGetGoogleConfig } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, string | number | boolean>,
          ) => void;
        };
      };
    };
  }
}

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const { toast } = useToast();
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [showPassword, setShowPw] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const renderGoogleButton = async () => {
      try {
        const { clientId } = await apiGetGoogleConfig();
        if (cancelled || !googleButtonRef.current) return;

        const initialize = () => {
          if (cancelled || !googleButtonRef.current || !window.google) return;
          googleButtonRef.current.innerHTML = "";
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: async ({ credential }) => {
              if (!credential) return;
              setLoading(true);
              try {
                await loginWithGoogle(credential);
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : "Login Google gagal";
                toast({ title: "Login Google gagal", description: msg, variant: "destructive" });
              } finally {
                setLoading(false);
              }
            },
          });
          window.google.accounts.id.renderButton(googleButtonRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "signin_with",
            shape: "rectangular",
            width: 320,
          });
        };

        if (window.google) {
          initialize();
          return;
        }

        const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
        if (existing) {
          existing.addEventListener("load", initialize, { once: true });
          return;
        }

        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.dataset.googleIdentity = "true";
        script.addEventListener("load", initialize, { once: true });
        document.head.appendChild(script);
      } catch (err) {
        console.error("Failed to initialize Google login", err);
      }
    };

    void renderGoogleButton();
    return () => {
      cancelled = true;
    };
  }, [loginWithGoogle, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login gagal";
      toast({ title: "Login gagal", description: msg, variant: "destructive" });
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
          <p className="text-sm text-muted-foreground">Masuk ke akun Anda</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Masuk</CardTitle>
            <CardDescription>Gunakan email dan password yang terdaftar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center">
              <div ref={googleButtonRef} aria-label="Masuk dengan Google" />
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">atau</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@contoh.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Memproses..." : "Masuk"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          Gunakan akun Google perusahaan atau email/password yang sudah terdaftar.
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Belum ada akun admin?{" "}
          <a href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/setup`} className="underline hover:text-foreground">
            Setup awal
          </a>
        </p>
      </div>
    </div>
  );
}
