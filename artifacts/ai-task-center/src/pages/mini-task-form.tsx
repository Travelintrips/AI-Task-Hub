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

const STATUS_LABELS: Record<string, string> = {
  new_inquiry: "Inquiry Baru",
  waiting_documents: "Menunggu Dokumen",
  documents_received: "Dokumen Diterima",
  audit_in_progress: "Audit Berjalan",
  missing_data: "Data Kurang",
  ready_for_review: "Siap Direview",
  assigned: "Ditugaskan",
  in_progress: "Sedang Dikerjakan",
  waiting_customer: "Menunggu Customer",
  waiting_vendor: "Menunggu Vendor",
  quotation_ready: "Quotation Siap",
  approved_by_customer: "Disetujui Customer",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

export default function MiniTaskForm() {
  const { taskId, token } = useParams<{ taskId: string; token: string }>();
  const [tab, setTab] = useState<"info" | "progress" | "upload" | "trucking" | "quotation">("info");
  const [progressNote, setProgressNote] = useState("");
  const [statusUpdate, setStatusUpdate] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [quotationAmount, setQuotationAmount] = useState("");
  const [quotationNotes, setQuotationNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["mini-task", taskId, token],
    queryFn: () => apiFetch(`/public/mini-task/${taskId}/${token}`),
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/public/mini-task/${taskId}/${token}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => setSubmitted(true),
    onError: (e: Error) => setError(e.message),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    setError("");
    try {
      const urlRes = await apiFetch(`/public/mini-task/${taskId}/${token}/upload-url`, {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mimeType: file.type }),
      });
      await fetch(urlRes.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      await apiFetch(`/public/mini-task/${taskId}/${token}/attachments`, {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, objectPath: urlRes.path, mimeType: file.type, fileSize: file.size, uploadedBy: submittedBy || "Tim" }),
      });
      alert("File berhasil diupload!");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function handleSubmitProgress() {
    setError("");
    submitMutation.mutate({ progressNote, statusUpdate: statusUpdate || undefined, submittedBy: submittedBy || "Tim" });
  }

  function handleSubmitTrucking() {
    setError("");
    submitMutation.mutate({ driverName, driverPhone, plateNumber, submittedBy: submittedBy || "Tim", statusUpdate: "in_progress" });
  }

  function handleSubmitQuotation() {
    setError("");
    submitMutation.mutate({ quotationAmount, quotationNotes, submittedBy: submittedBy || "Tim" });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Memuat data task...</p>
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
          <p className="text-gray-500 text-sm">Link ini sudah kadaluarsa atau tidak valid. Hubungi admin untuk mendapatkan link baru.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-6 max-w-sm w-full text-center">
          <div className="text-green-500 text-5xl mb-3">✅</div>
          <h2 className="font-bold text-gray-800 mb-2">Berhasil Dikirim!</h2>
          <p className="text-gray-500 text-sm">Update Anda sudah diterima dan akan segera diproses.</p>
          <button onClick={() => setSubmitted(false)} className="mt-4 text-blue-600 text-sm underline">Kirim lagi</button>
        </div>
      </div>
    );
  }

  const task = data.task;
  const audit = data.audit;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 pt-10 pb-6">
        <p className="text-blue-200 text-xs mb-1">{task.taskNumber ?? `TASK-${task.id}`}</p>
        <h1 className="text-lg font-bold leading-tight mb-2">{task.title}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">
            {STATUS_LABELS[task.status] ?? task.status}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] ?? "bg-gray-100"}`}>
            {task.priority?.toUpperCase()}
          </span>
        </div>
        {task.customerName && (
          <p className="text-blue-100 text-sm mt-2">👤 {task.customerName}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white overflow-x-auto">
        {(["info", "progress", "upload", "trucking", "quotation"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap flex-shrink-0 border-b-2 transition-colors ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
            }`}
          >
            {{ info: "ℹ️ Info", progress: "📝 Progress", upload: "📎 Upload", trucking: "🚛 Trucking", quotation: "💰 Quotation" }[t]}
          </button>
        ))}
      </div>

      <div className="p-4 max-w-lg mx-auto">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">⚠️ {error}</div>
        )}

        {/* INFO TAB */}
        {tab === "info" && (
          <div className="space-y-3">
            {task.description && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-400 mb-1 font-medium">DESKRIPSI</p>
                <p className="text-sm text-gray-700">{task.description}</p>
              </div>
            )}
            {task.requiredAction && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <p className="text-xs text-orange-600 mb-1 font-bold">TINDAKAN YANG DIBUTUHKAN</p>
                <p className="text-sm text-orange-800">{task.requiredAction}</p>
              </div>
            )}
            {task.aiSummary && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-400 mb-1 font-medium">RINGKASAN AI</p>
                <p className="text-sm text-gray-700">{task.aiSummary}</p>
              </div>
            )}
            {audit && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-400 mb-2 font-medium">STATUS AUDIT</p>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  audit.auditStatus === "passed" ? "bg-green-100 text-green-700" :
                  audit.auditStatus === "incomplete" ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>{audit.auditStatus}</span>
                {Array.isArray(audit.missingFields) && audit.missingFields.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-400 mb-1">Data yang masih kurang:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {(audit.missingFields as string[]).map((f, i) => (
                        <li key={i} className="text-sm text-red-600">{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {audit.recommendation && (
                  <p className="text-sm text-gray-600 mt-2">{audit.recommendation}</p>
                )}
              </div>
            )}
            {task.dueDate && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-400 mb-1 font-medium">TENGGAT WAKTU</p>
                <p className="text-sm text-gray-700">📅 {new Date(task.dueDate).toLocaleDateString("id-ID", { dateStyle: "long" })}</p>
              </div>
            )}
          </div>
        )}

        {/* PROGRESS TAB */}
        {tab === "progress" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">NAMA ANDA</label>
              <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Anda" />
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">UPDATE STATUS</label>
              <select value={statusUpdate} onChange={(e) => setStatusUpdate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">-- Tidak ada perubahan --</option>
                <option value="in_progress">▶️ Sedang Dikerjakan</option>
                <option value="waiting_customer">⏳ Menunggu Customer</option>
                <option value="waiting_vendor">⏳ Menunggu Vendor</option>
                <option value="completed">✅ Selesai</option>
              </select>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">CATATAN PROGRESS</label>
              <textarea value={progressNote} onChange={(e) => setProgressNote(e.target.value)} rows={4}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Tulis update progress Anda di sini..." />
            </div>
            <button onClick={handleSubmitProgress} disabled={submitMutation.isPending}
              className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-50">
              {submitMutation.isPending ? "Mengirim..." : "📤 Kirim Update"}
            </button>
          </div>
        )}

        {/* UPLOAD TAB */}
        {tab === "upload" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">NAMA ANDA</label>
              <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Anda" />
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4 text-center">
              <p className="text-gray-500 text-sm mb-3">Upload foto atau dokumen</p>
              <label className={`block w-full border-2 border-dashed border-blue-300 rounded-xl p-8 cursor-pointer hover:bg-blue-50 transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                <input type="file" className="hidden" accept="image/*,application/pdf,.doc,.docx"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                    <p className="text-blue-600 text-sm">Mengupload...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">📎</span>
                    <p className="text-blue-600 font-medium text-sm">Pilih File</p>
                    <p className="text-gray-400 text-xs">Foto, PDF, atau Dokumen</p>
                  </div>
                )}
              </label>
            </div>
            {data.attachments?.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-400 mb-2 font-medium">FILE YANG SUDAH DIUPLOAD</p>
                <div className="space-y-2">
                  {(data.attachments as { id: number; fileName: string; fileType: string }[]).map((a) => (
                    <div key={a.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <span>{a.fileType === "image" ? "🖼️" : a.fileType === "pdf" ? "📄" : "📎"}</span>
                      <span className="truncate">{a.fileName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TRUCKING TAB */}
        {tab === "trucking" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">NAMA ANDA</label>
              <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Anda" />
            </div>
            {[
              { label: "NAMA DRIVER", value: driverName, set: setDriverName, placeholder: "Nama lengkap driver" },
              { label: "NO. HP DRIVER", value: driverPhone, set: setDriverPhone, placeholder: "08xxxxxxxxxx", type: "tel" },
              { label: "NO. PLAT KENDARAAN", value: plateNumber, set: setPlateNumber, placeholder: "B 1234 XYZ" },
            ].map(({ label, value, set, placeholder, type }) => (
              <div key={label} className="bg-white rounded-xl shadow-sm p-4">
                <label className="block text-xs text-gray-400 mb-1 font-medium">{label}</label>
                <input value={value} onChange={(e) => set(e.target.value)} type={type ?? "text"}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder={placeholder} />
              </div>
            ))}
            <button onClick={handleSubmitTrucking} disabled={submitMutation.isPending || !driverName}
              className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-50">
              {submitMutation.isPending ? "Menyimpan..." : "🚛 Simpan Info Trucking"}
            </button>
          </div>
        )}

        {/* QUOTATION TAB */}
        {tab === "quotation" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">NAMA ANDA</label>
              <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Anda" />
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">JUMLAH QUOTATION</label>
              <input value={quotationAmount} onChange={(e) => setQuotationAmount(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Rp 5.000.000" />
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">CATATAN QUOTATION</label>
              <textarea value={quotationNotes} onChange={(e) => setQuotationNotes(e.target.value)} rows={4}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Detail biaya, syarat & ketentuan..." />
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
              <p className="text-yellow-800 text-xs">⚠️ <strong>Catatan:</strong> Quotation ini bersifat usulan. Persetujuan final dilakukan oleh Admin.</p>
            </div>
            <button onClick={handleSubmitQuotation} disabled={submitMutation.isPending || !quotationAmount}
              className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-50">
              {submitMutation.isPending ? "Mengirim..." : "💰 Kirim Quotation"}
            </button>
          </div>
        )}
      </div>

      <div className="h-8" />
    </div>
  );
}
