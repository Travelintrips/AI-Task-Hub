/**
 * Sprint 10A-3 — Vendor Status Portal (Public, token-based)
 * Route: /vendor/status/:token
 * No authentication required
 */

import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Error ${res.status}`);
  }
  return res.json();
}

interface VendorStatus {
  vendor: {
    id: number;
    name: string;
    service_type: string;
    registration_status: string;
    status_label: string;
    review_notes: string | null;
    capability_score: number;
    completed_capabilities: string[];
  };
  documents: {
    uploaded: Array<{ type: string; is_verified: boolean; expiry_date: string | null }>;
    missing: string[];
    required: string[];
  };
  next_action: string;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  unregistered:  { color: "text-gray-600",  bg: "bg-gray-100",  icon: "📋" },
  pending_review:{ color: "text-yellow-700",bg: "bg-yellow-50", icon: "🕐" },
  approved:      { color: "text-green-700", bg: "bg-green-50",  icon: "✅" },
  rejected:      { color: "text-red-700",   bg: "bg-red-50",    icon: "❌" },
  needs_revision:{ color: "text-orange-700",bg: "bg-orange-50", icon: "📝" },
};

const DOC_LABELS: Record<string, string> = {
  npwp: "NPWP Perusahaan", nib: "NIB", siup: "SIUP / Izin Usaha",
  stnk: "STNK Kendaraan", kir: "Surat KIR", company_profile: "Company Profile",
  pkc: "PKC Kepabeanan", insurance: "Sertifikat Asuransi",
};

export default function VendorStatusPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery<VendorStatus>({
    queryKey: ["vendor-status", token],
    queryFn: () => apiFetch(`/public/vendor/status/${token}`),
    retry: false,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Memuat status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Tautan Tidak Valid</h2>
          <p className="text-gray-500 text-sm">{(error as Error).message}</p>
          <p className="text-gray-400 text-xs mt-4">
            Kirim <strong>STATUS VENDOR</strong> via WhatsApp untuk mendapatkan tautan baru.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { vendor, documents, next_action } = data;
  const statusCfg = STATUS_CONFIG[vendor.registration_status] ?? STATUS_CONFIG["unregistered"]!;
  const capPct = vendor.capability_score;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className="text-4xl mb-2">🏢</div>
          <h1 className="text-xl font-bold text-gray-900">{vendor.name}</h1>
          <p className="text-gray-400 text-sm">{vendor.service_type}</p>
        </div>

        {/* Registration Status */}
        <div className={`rounded-2xl p-5 ${statusCfg.bg}`}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Status Pendaftaran</p>
          <div className={`text-xl font-bold ${statusCfg.color} flex items-center gap-2`}>
            <span>{statusCfg.icon}</span>
            <span>{vendor.status_label}</span>
          </div>
          {vendor.review_notes && (
            <div className="mt-3 bg-white/70 rounded-lg p-3 text-sm text-gray-700">
              <p className="font-semibold text-xs mb-1">Catatan Admin:</p>
              {vendor.review_notes}
            </div>
          )}
        </div>

        {/* Next Action */}
        <div className="bg-blue-50 rounded-2xl p-4 flex gap-3">
          <span className="text-blue-500 text-lg flex-shrink-0">💡</span>
          <div>
            <p className="text-xs font-semibold text-blue-700 mb-0.5">Langkah Selanjutnya</p>
            <p className="text-sm text-blue-800">{next_action}</p>
          </div>
        </div>

        {/* Capability Score */}
        <div className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">Kelengkapan Profil</p>
            <span className={`text-sm font-bold ${capPct >= 80 ? "text-green-600" : capPct >= 50 ? "text-yellow-600" : "text-red-600"}`}>
              {capPct}%
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
            <div
              className={`h-2 rounded-full transition-all ${capPct >= 80 ? "bg-green-500" : capPct >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
              style={{ width: `${capPct}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {vendor.completed_capabilities.map(c => (
              <span key={c} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ {c}</span>
            ))}
          </div>
        </div>

        {/* Document Status */}
        <div className="bg-white rounded-2xl shadow p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">Status Dokumen</p>

          {documents.required.length === 0 ? (
            <p className="text-sm text-gray-400">Tidak ada dokumen yang dipersyaratkan.</p>
          ) : (
            <div className="space-y-2">
              {documents.required.map(docType => {
                const uploaded = documents.uploaded.find(d => d.type === docType);
                const isUploaded = !!uploaded;
                const isVerified = uploaded?.is_verified ?? false;
                return (
                  <div key={docType} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-sm text-gray-700">{DOC_LABELS[docType] ?? docType}</p>
                      {uploaded?.expiry_date && (
                        <p className="text-xs text-gray-400">Exp: {uploaded.expiry_date}</p>
                      )}
                    </div>
                    {isUploaded ? (
                      isVerified
                        ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ Terverifikasi</span>
                        : <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">🕐 Menunggu Verifikasi</span>
                    ) : (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">❌ Belum Upload</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {documents.missing.length > 0 && (
            <div className="mt-3 bg-orange-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-orange-700 mb-1">Dokumen yang masih kurang ({documents.missing.length}):</p>
              <p className="text-xs text-orange-600">
                {documents.missing.map(d => DOC_LABELS[d] ?? d).join(", ")}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Kirim <strong>DOKUMEN VENDOR</strong> via WhatsApp untuk tautan upload.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center pb-4">
          Halaman diperbarui setiap 60 detik · Hubungi admin untuk bantuan
        </p>
      </div>
    </div>
  );
}
