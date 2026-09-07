/**
 * Sprint 10A-3 — Vendor Documents Portal (Public, token-based)
 * Route: /vendor/documents/:token
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

interface DocEntry {
  id: number;
  type: string;
  label: string;
  file_name: string | null;
  file_url: string | null;
  is_verified: boolean;
  expiry_date: string | null;
  status: string | null;
  uploaded_at: string;
}

interface RequiredDoc {
  type: string;
  label: string;
  uploaded: boolean;
}

interface MissingDoc {
  type: string;
  label: string;
}

interface DocumentsData {
  vendor_name: string;
  uploaded_documents: DocEntry[];
  missing_documents: MissingDoc[];
  required_documents: RequiredDoc[];
}

function StatusBadge({ doc }: { doc: DocEntry }) {
  if (doc.is_verified)
    return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ Terverifikasi</span>;
  if (doc.status === "valid")
    return <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">✓ Valid</span>;
  if (doc.status === "needs_review")
    return <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">🔍 Perlu Review</span>;
  if (doc.status === "invalid")
    return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">❌ Tidak Valid</span>;
  return <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">🕐 Diproses</span>;
}

export default function VendorDocumentsPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery<DocumentsData>({
    queryKey: ["vendor-documents", token],
    queryFn: () => apiFetch(`/public/vendor/documents/${token}`),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Memuat dokumen...</p>
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
            Kirim <strong>DOKUMEN VENDOR</strong> via WhatsApp untuk mendapatkan tautan baru.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const uploadedPct = data.required_documents.length > 0
    ? Math.round((data.required_documents.filter(d => d.uploaded).length / data.required_documents.length) * 100)
    : 100;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className="text-4xl mb-2">📂</div>
          <h1 className="text-xl font-bold text-gray-900">Dokumen Vendor</h1>
          <p className="text-gray-400 text-sm">{data.vendor_name}</p>
        </div>

        {/* Completion bar */}
        <div className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-700">Kelengkapan Dokumen</p>
            <span className={`text-sm font-bold ${uploadedPct === 100 ? "text-green-600" : uploadedPct >= 50 ? "text-yellow-600" : "text-red-600"}`}>
              {uploadedPct}%
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${uploadedPct === 100 ? "bg-green-500" : uploadedPct >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
              style={{ width: `${uploadedPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {data.uploaded_documents.length} dari {data.required_documents.length} dokumen terpenuhi
          </p>
        </div>

        {/* Missing documents */}
        {data.missing_documents.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
            <p className="text-sm font-semibold text-orange-800 mb-3">
              ⚠️ Dokumen yang belum diupload ({data.missing_documents.length})
            </p>
            <div className="space-y-2">
              {data.missing_documents.map(doc => (
                <div key={doc.type} className="flex items-center justify-between bg-white rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{doc.label}</p>
                    <p className="text-xs text-gray-400">{doc.type.toUpperCase()}</p>
                  </div>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">❌ Belum ada</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-orange-600 mt-3 font-medium">
              Kirimkan dokumen ke admin via WhatsApp atau email untuk diproses.
            </p>
          </div>
        )}

        {/* Uploaded documents */}
        {data.uploaded_documents.length > 0 && (
          <div className="bg-white rounded-2xl shadow p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3">
              📄 Dokumen Terupload ({data.uploaded_documents.length})
            </p>
            <div className="space-y-3">
              {data.uploaded_documents.map(doc => (
                <div key={doc.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{doc.label}</p>
                      {doc.file_name && (
                        <p className="text-xs text-gray-400">{doc.file_name}</p>
                      )}
                    </div>
                    <StatusBadge doc={doc} />
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    {doc.expiry_date && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        doc.expiry_date < new Date().toISOString().split("T")[0]!
                          ? "bg-red-100 text-red-600"
                          : "bg-gray-100 text-gray-500"
                      }`}>
                        Exp: {doc.expiry_date}
                      </span>
                    )}
                    {doc.file_url && (
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Lihat file ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 rounded-2xl p-4">
          <p className="text-xs font-semibold text-blue-700 mb-2">📌 Cara Upload Dokumen</p>
          <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
            <li>Siapkan file dokumen (PDF/JPG/PNG)</li>
            <li>Kirimkan ke admin via WhatsApp beserta keterangan jenis dokumen</li>
            <li>Admin akan memverifikasi dan mengunggah ke sistem</li>
            <li>Anda akan mendapat notifikasi WhatsApp hasil verifikasi</li>
          </ol>
        </div>

        <p className="text-xs text-gray-400 text-center pb-4">
          Hubungi admin untuk bantuan · Data dienkripsi dan aman
        </p>
      </div>
    </div>
  );
}
