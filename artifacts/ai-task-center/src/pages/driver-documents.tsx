import { useEffect, useState, useRef } from "react";
import { useParams, useLocation } from "wouter";

interface DocItem {
  id: number; type: string; label: string; file_name: string; file_url: string | null;
  is_current: boolean; is_verified: boolean; expiry_date: string | null; uploaded_at: string;
}
interface RequiredDoc { type: string; label: string; uploaded: boolean }
interface DocData {
  driver_id: number;
  uploaded_documents: DocItem[];
  required_documents: RequiredDoc[];
  missing_documents: Array<{ type: string; label: string }>;
  completion_pct: number;
}

const MIME_MAP: Record<string, string> = {
  "application/pdf": "PDF", "image/jpeg": "JPG", "image/jpg": "JPG",
  "image/png": "PNG", "image/webp": "WEBP",
};

export default function DriverDocumentsPage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [data, setData] = useState<DocData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState<string>("");
  const [expiryDate, setExpiryDate] = useState<string>("");

  const fetchData = () => {
    if (!token) return;
    setLoading(true);
    fetch(`/api/public/driver/documents/${token}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Gagal memuat dokumen"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [token]);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !selectedType || !token) { alert("Pilih jenis dokumen dan file terlebih dahulu"); return; }

    const reader = new FileReader();
    reader.onload = async () => {
      setUploading(selectedType);
      setUploadMsg(null);
      try {
        const base64 = (reader.result as string).split(",")[1] ?? "";
        const res = await fetch(`/api/public/driver/documents/${token}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            document_type: selectedType,
            file_name: file.name,
            file_base64: base64,
            mime_type: file.type || "image/jpeg",
            expiry_date: expiryDate || null,
          }),
        });
        const d = await res.json() as Record<string, unknown>;
        if (!res.ok) { setUploadMsg(`❌ ${String(d["error"] ?? "Gagal upload")}`); return; }
        setUploadMsg(`✅ ${String(d["message"] ?? "Berhasil upload!")}`);
        setSelectedType("");
        setExpiryDate("");
        if (fileRef.current) fileRef.current.value = "";
        fetchData();
      } catch {
        setUploadMsg("❌ Gagal upload dokumen");
      } finally {
        setUploading(null);
      }
    };
    reader.readAsDataURL(file);
  }

  if (loading) return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center">
      <p className="text-green-700">Memuat dokumen...</p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 shadow text-center max-w-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-sm text-gray-600">{error}</p>
        {error.includes("profil") && (
          <button onClick={() => navigate(`/driver/profile/${token}`)} className="mt-4 bg-green-600 text-white px-4 py-2 rounded-xl text-sm">
            Isi Profil Dulu
          </button>
        )}
      </div>
    </div>
  );

  const DOC_ICONS: Record<string, string> = { sim: "🪪", ktp: "🆔", medical: "🏥", photo: "📸" };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white px-4 py-5 flex items-center gap-3">
        <button onClick={() => navigate(`/driver/home/${token}`)} className="text-white/80">←</button>
        <div>
          <h1 className="font-bold text-lg">📄 Dokumen Driver</h1>
          <p className="text-green-200 text-xs">Kelengkapan: {data?.completion_pct ?? 0}%</p>
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto space-y-4">
        {/* Progress */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Progres Dokumen</span>
            <span className="text-sm font-bold text-green-600">{data?.completion_pct ?? 0}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full">
            <div
              className="h-2 bg-green-500 rounded-full transition-all"
              style={{ width: `${data?.completion_pct ?? 0}%` }}
            />
          </div>
        </div>

        {/* Required Documents Status */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-3">Dokumen Wajib</h2>
          <div className="space-y-2">
            {data?.required_documents?.map(doc => (
              <div key={doc.type} className={`flex items-center gap-3 p-3 rounded-xl ${doc.uploaded ? "bg-green-50" : "bg-red-50"}`}>
                <span className="text-xl">{DOC_ICONS[doc.type] ?? "📄"}</span>
                <span className="flex-1 text-sm font-medium text-gray-700">{doc.label}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${doc.uploaded ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {doc.uploaded ? "✓ Ada" : "Kurang"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Upload Form */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-3">⬆️ Upload Dokumen Baru</h2>

          {uploadMsg && (
            <div className={`mb-3 p-3 rounded-xl text-sm font-medium ${uploadMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              {uploadMsg}
            </div>
          )}

          <div className="space-y-3">
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            >
              <option value="">-- Pilih Jenis Dokumen --</option>
              <option value="sim">🪪 SIM (Surat Izin Mengemudi)</option>
              <option value="ktp">🆔 KTP</option>
              <option value="medical">🏥 Surat Keterangan Sehat</option>
              <option value="photo">📸 Foto Driver</option>
            </select>

            {(selectedType === "sim" || selectedType === "medical") && (
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Masa Berlaku</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={e => setExpiryDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                />
              </div>
            )}

            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-green-400 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <p className="text-sm text-gray-500">📎 Klik untuk pilih file</p>
              <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG, WEBP (maks. 8MB)</p>
              <p className="text-xs text-gray-600 mt-1">{fileRef.current?.files?.[0]?.name ?? ""}</p>
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
              onChange={() => setUploadMsg(null)} />

            <button
              onClick={handleUpload}
              disabled={!!uploading || !selectedType}
              className="w-full bg-green-600 text-white rounded-xl py-3 font-bold text-sm disabled:opacity-60"
            >
              {uploading ? `Mengupload ${String(MIME_MAP[uploading] ?? uploading)}...` : "⬆️ Upload"}
            </button>
          </div>
        </div>

        {/* Uploaded Docs */}
        {(data?.uploaded_documents?.length ?? 0) > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-3">Riwayat Upload</h2>
            <div className="space-y-2">
              {data?.uploaded_documents?.map(doc => (
                <div key={doc.id} className={`flex items-start gap-3 p-3 rounded-xl ${doc.is_current ? "bg-green-50" : "bg-gray-50"}`}>
                  <span className="text-lg mt-0.5">{DOC_ICONS[doc.type] ?? "📄"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">{doc.label}</span>
                      {doc.is_verified && <span className="text-xs text-green-600">✅</span>}
                      {!doc.is_current && <span className="text-xs text-gray-400">(lama)</span>}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{doc.file_name}</p>
                    {doc.expiry_date && <p className="text-xs text-orange-600">Berlaku s/d: {doc.expiry_date}</p>}
                  </div>
                  {doc.file_url && (
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-600 underline whitespace-nowrap">Lihat</a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
