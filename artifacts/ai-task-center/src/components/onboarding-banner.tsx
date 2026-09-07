import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, ChevronRight, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

const SKIP_KEY = "onboarding_banner_skipped_at";
const SKIP_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function apiFetch(path: string) {
  const token = localStorage.getItem("ai_task_center_token");
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const MGMT_ROLES = new Set(["super_admin", "owner", "company_admin"]);

export function OnboardingBanner() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(() => {
    try {
      const ts = localStorage.getItem(SKIP_KEY);
      if (!ts) return false;
      return Date.now() - parseInt(ts, 10) < SKIP_TTL_MS;
    } catch {
      return false;
    }
  });

  const { data } = useQuery({
    queryKey: ["onboarding-status-banner"],
    queryFn: () => apiFetch("/api/system/onboarding-status"),
    staleTime: 60_000,
    enabled: !!user && MGMT_ROLES.has(user.role) && !dismissed,
  });

  if (!user || !MGMT_ROLES.has(user.role)) return null;
  if (dismissed) return null;

  const pct: number = data?.overallPct ?? 100;
  if (pct >= 80) return null;

  const incomplete = Object.entries(data?.steps ?? {})
    .filter(([, s]) => !(s as { done: boolean }).done)
    .map(([k]) => k.replace(/_/g, " "));

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3 mb-4">
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">
          Setup belum lengkap ({pct}%) — selesaikan onboarding agar semua fitur aktif.
        </p>
        {incomplete.length > 0 && (
          <p className="text-xs text-amber-700 mt-0.5">
            Belum selesai: {incomplete.join(", ")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => navigate("/onboarding")}
          className="inline-flex items-center gap-1 text-xs font-medium bg-amber-600 text-white rounded px-3 py-1.5 hover:bg-amber-700"
        >
          Lanjutkan Setup <ChevronRight className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            localStorage.setItem(SKIP_KEY, String(Date.now()));
            setDismissed(true);
          }}
          className="p-1 text-amber-500 hover:text-amber-700 rounded"
          title="Lewati untuk sekarang"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
