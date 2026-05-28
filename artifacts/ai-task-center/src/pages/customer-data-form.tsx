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

export default function CustomerDataForm() {
  const { taskId, token } = useParams<{ taskId: string; token: string }>();
  const [step, setStep] = useState<"checklist" | "form" | "done">("checklist");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [error, setError] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["customer-data", taskId, token],
    queryFn: () => apiFetch(`/public/customer-data/${taskId}/${token}`),
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/public/customer-data/${taskId}/${token}`, {
        method: "POST",
        body: JSON.stringify({ fields, notes, submittedBy: data?.task?.customerName ?? "Customer" }),
      }),
    onSuccess: () => setStep("done"),
    onError: (e: Error) => setError(e.message),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    setError("");
    try {
      const urlRes = await apiFetch(`/public/customer-data/${taskId}/${token}/upload-url`, {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mimeType: file.type }),
      });
      await fetch(urlRes.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      await apiFetch(`/public/customer-data/${taskId}/${token}/attachments`, {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, objectPath: urlRes.path, mimeType: file.type, fileSize: file.size, uploadedBy: data?.task?.customerName ?? "Customer" }),
      });
      setUploadedFiles((prev) => [...prev, file.name]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Memuat formulir...</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-6 max-w-sm w-full text-center">
          <div className="text-red-500 text-4xl mb-3">⚠️</div>
          <h2 className="font-bold text-gray-800 mb-2">Link Tidak Valid</h2>
          <p className="text-gray-500 text-sm">Link ini sudah kadaluarsa atau tidak valid. Silakan hubungi tim kami.</p>
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full text-center">
          <div className="text-green-500 text-5xl mb-4">✅</div>
          <h2 className="font-bold text-gray-800 text-lg mb-2">Terima Kasih!</h2>
          <p className="text-gray-500 text-sm mb-4">
            Data Anda sudah berhasil dikirim. Tim kami akan segera memprosesnya dan menghubungi Anda.
          </p>
          <div className="bg-blue-50 rounded-xl p-4 text-left">
            <p className="text-blue-700 text-xs font-medium">📋 Nomor Referensi</p>
            <p className="text-blue-900 font-bold">{data.task?.taskNumber ?? `TASK-${data.task?.id}`}</p>
          </div>
        </div>
      </div>
    );
  }

  const task = data.task;
  const audit = data.audit;
  const missingFields = (audit?.missingFields ?? []) as string[];
  const unclearFields = (audit?.unclearFields ?? []) as string[];
  const allRequired = [...missingFields, ...unclearFields];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-4 pt-10 pb-8">
        <div className="max-w-lg mx-auto">
          <p className="text-blue-200 text-xs mb-1">Formulir Data Customer</p>
          <h1 className="text-xl font-bold leading-tight mb-1">{task.title}</h1>
          {task.customerName && <p className="text-blue-100 text-sm">👤 {task.customerName}</p>}
          <p className="text-blue-200 text-xs mt-2">{task.taskNumber ?? `TASK-${task.id}`}</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">⚠️ {error}</div>
        )}

        {step === "checklist" && (
          <>
            {/* Intro */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="font-bold text-gray-800 mb-2">📋 Data yang Dibutuhkan</h2>
              <p className="text-gray-500 text-sm">
                Tim kami membutuhkan beberapa data/dokumen dari Anda untuk melanjutkan proses. Mohon lengkapi sesuai daftar berikut.
              </p>
            </div>

            {/* Missing fields checklist */}
            {allRequired.length > 0 ? (
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <p className="text-xs text-gray-400 font-medium mb-3">DATA YANG PERLU DILENGKAPI</p>
                <div className="space-y-2">
                  {allRequired.map((field, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b last:border-0">
                      <span className="text-red-400 mt-0.5">❌</span>
                      <span className="text-sm text-gray-700">{field}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
                <p className="text-green-700 font-medium">✅ Semua data sudah lengkap!</p>
              </div>
            )}

            {/* Custom missing data text */}
            {task.missingData && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
                <p className="text-xs text-orange-600 font-bold mb-2">CATATAN DARI TIM</p>
                <p className="text-sm text-orange-800">{task.missingData}</p>
              </div>
            )}

            {audit?.recommendation && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                <p className="text-xs text-blue-600 font-bold mb-2">REKOMENDASI</p>
                <p className="text-sm text-blue-800">{audit.recommendation}</p>
              </div>
            )}

            <button onClick={() => setStep("form")}
              className="w-full bg-blue-600 text-white rounded-2xl py-4 font-bold text-sm">
              Lanjut Isi Data →
            </button>
          </>
        )}

        {step === "form" && (
          <>
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="font-bold text-gray-800 mb-1">Lengkapi Data</h2>
              <p className="text-gray-500 text-sm">Isi data di bawah sesuai kemampuan Anda.</p>
            </div>

            {/* Dynamic fields based on missing */}
            {allRequired.map((field, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm p-4">
                <label className="block text-xs text-gray-400 mb-1 font-medium">{field.toUpperCase()}</label>
                <input
                  value={fields[field] ?? ""}
                  onChange={(e) => setFields((prev) => ({ ...prev, [field]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                  placeholder={`Masukkan ${field}`}
                />
              </div>
            ))}

            {/* Upload section */}
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <p className="text-xs text-gray-400 font-medium mb-2">UPLOAD DOKUMEN PENDUKUNG</p>
              <label className={`block w-full border-2 border-dashed border-blue-200 rounded-xl p-6 text-center cursor-pointer hover:bg-blue-50 transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                <input type="file" className="hidden" accept="image/*,application/pdf,.doc,.docx"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                    <p className="text-blue-600 text-sm">Mengupload...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-2xl">📎</span>
                    <p className="text-blue-600 text-sm font-medium">Pilih File</p>
                    <p className="text-gray-400 text-xs">Foto, PDF, Word</p>
                  </div>
                )}
              </label>
              {uploadedFiles.length > 0 && (
                <div className="mt-3 space-y-1">
                  {uploadedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-green-700">
                      <span>✅</span><span className="truncate">{f}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">CATATAN TAMBAHAN (opsional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none"
                placeholder="Jika ada keterangan tambahan..." />
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
              <p className="text-yellow-800 text-xs">
                Setelah Anda submit, tim kami akan memverifikasi data dan menghubungi Anda jika masih ada yang kurang.
              </p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep("checklist")}
                className="flex-1 bg-gray-100 text-gray-700 rounded-2xl py-3 font-semibold text-sm">
                ← Kembali
              </button>
              <button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}
                className="flex-2 flex-grow bg-blue-600 text-white rounded-2xl py-3 font-bold text-sm disabled:opacity-50">
                {submitMutation.isPending ? "Mengirim..." : "📤 Kirim Data"}
              </button>
            </div>
          </>
        )}
      </div>
      <div className="h-8" />
    </div>
  );
}
