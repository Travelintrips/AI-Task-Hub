/**
 * Sprint 10A-3 — Vendor Registration Portal (Public, token-based)
 * Route: /vendor/register/:token
 * No authentication required
 */

import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Error ${res.status}`);
  }
  return res.json();
}

interface FieldDef {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  help?: string;
}

interface FormMeta {
  status: string;
  phone: string;
  prefill: Record<string, unknown>;
  fields: FieldDef[];
}

interface SubmitResult {
  success: boolean;
  vendor_id: number;
  message: string;
  registration_status: string;
  required_docs: string[];
  status_url: string;
}

export default function VendorRegisterPage() {
  const { token } = useParams<{ token: string }>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: meta, isLoading, error: fetchErr } = useQuery<FormMeta>({
    queryKey: ["vendor-register", token],
    queryFn: () => apiFetch(`/public/vendor/register/${token}`),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch(`/public/vendor/register/${token}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data: SubmitResult) => {
      setSubmitted(data);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  function handleChange(name: string, value: string) {
    setValues(prev => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, string> = {};
    if (meta) {
      for (const f of meta.fields) {
        body[f.name] = values[f.name] ?? (meta.prefill[f.name] as string) ?? "";
      }
    }
    mutation.mutate(body);
  }

  const docLabels: Record<string, string> = {
    npwp: "NPWP Perusahaan",
    nib: "NIB (Nomor Induk Berusaha)",
    siup: "SIUP / Izin Usaha",
    stnk: "STNK Kendaraan",
    kir: "Surat KIR / Uji Berkala",
    company_profile: "Company Profile",
    pkc: "PKC (Persetujuan Kelayakan Kepabeanan)",
    insurance: "Sertifikat Asuransi",
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Memuat formulir...</p>
        </div>
      </div>
    );
  }

  if (fetchErr) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Tautan Tidak Valid</h2>
          <p className="text-gray-500 text-sm">
            {(fetchErr as Error).message || "Tautan pendaftaran ini sudah kedaluwarsa atau tidak valid."}
          </p>
          <p className="text-gray-400 text-xs mt-4">
            Hubungi kami via WhatsApp dan kirim pesan <strong>DAFTAR VENDOR</strong> untuk mendapatkan tautan baru.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="text-2xl font-bold text-green-700">Pendaftaran Berhasil!</h2>
            <p className="text-gray-500 text-sm mt-2">{submitted.message}</p>
          </div>

          <div className="bg-green-50 rounded-xl p-4 mb-6">
            <p className="text-sm font-semibold text-green-800 mb-2">Status Pendaftaran</p>
            <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs font-medium px-3 py-1 rounded-full">
              🕐 Menunggu Review
            </span>
          </div>

          {submitted.required_docs.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-semibold text-gray-700 mb-2">📋 Dokumen yang perlu disiapkan:</p>
              <ul className="space-y-1">
                {submitted.required_docs.map(d => (
                  <li key={d} className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                    {docLabels[d] ?? d}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-400 mt-2">Upload dokumen akan dilakukan oleh admin atau via portal dokumen.</p>
            </div>
          )}

          {submitted.status_url && (
            <a
              href={submitted.status_url}
              className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
            >
              📊 Pantau Status Pendaftaran
            </a>
          )}

          <p className="text-xs text-gray-400 text-center mt-4">
            Tim kami akan menghubungi Anda via WhatsApp dalam 1–2 hari kerja.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🏢</div>
          <h1 className="text-2xl font-bold text-gray-900">Pendaftaran Vendor</h1>
          <p className="text-gray-500 text-sm mt-1">
            Isi formulir di bawah untuk mendaftar sebagai mitra vendor kami.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-6 space-y-5">
          {meta?.fields.map((field) => {
            const defaultVal = (meta.prefill[field.name] as string) ?? "";
            const value = values[field.name] ?? defaultVal;

            if (field.type === "select") {
              return (
                <div key={field.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {field.help && <p className="text-xs text-gray-400 mb-1">{field.help}</p>}
                  <select
                    value={value}
                    onChange={e => handleChange(field.name, e.target.value)}
                    required={field.required}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">— Pilih —</option>
                    {field.options?.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              );
            }

            if (field.type === "textarea") {
              return (
                <div key={field.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {field.help && <p className="text-xs text-gray-400 mb-1">{field.help}</p>}
                  <textarea
                    value={value}
                    onChange={e => handleChange(field.name, e.target.value)}
                    required={field.required}
                    rows={3}
                    placeholder={field.help}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              );
            }

            return (
              <div key={field.name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {field.help && <p className="text-xs text-gray-400 mb-1">{field.help}</p>}
                <input
                  type={field.type === "number" ? "number" : "text"}
                  value={value}
                  onChange={e => handleChange(field.name, e.target.value)}
                  required={field.required}
                  placeholder={field.help}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            );
          })}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            {mutation.isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Menyimpan...
              </>
            ) : "Kirim Pendaftaran 🚀"}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Data Anda aman dan hanya digunakan untuk proses verifikasi vendor.
          </p>
        </form>
      </div>
    </div>
  );
}
