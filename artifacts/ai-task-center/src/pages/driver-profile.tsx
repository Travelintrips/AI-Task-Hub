import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";

interface ProfileData {
  registered: boolean;
  driver: Record<string, string | number | null> | null;
  available_vehicles: Array<{ id: number; plate_number: string; vehicle_type: string }>;
  fields: Array<{ name: string; label: string; type: string; required: boolean; options?: string[] }>;
}

export default function DriverProfilePage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/driver/profile/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        if (d.driver) {
          const initial: Record<string, string> = {};
          for (const [k, v] of Object.entries(d.driver)) {
            if (v !== null && v !== undefined) initial[k] = String(v);
          }
          setForm(initial);
        }
      })
      .catch(() => setError("Gagal memuat profil"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/public/driver/profile/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json() as Record<string, unknown>;
      if (!res.ok) { alert(String(d["error"] ?? "Gagal menyimpan")); return; }
      setSaved(true);
      setTimeout(() => navigate(`/driver/home/${token}`), 1500);
    } catch {
      alert("Gagal menyimpan profil");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center">
      <p className="text-green-700">Memuat profil...</p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 shadow text-center max-w-sm w-full">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-sm text-gray-600">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white px-4 py-5 flex items-center gap-3">
        <button onClick={() => navigate(`/driver/home/${token}`)} className="text-white/80">←</button>
        <div>
          <h1 className="font-bold text-lg">👤 Profil Driver</h1>
          <p className="text-green-200 text-xs">{data?.registered ? "Update data Anda" : "Lengkapi pendaftaran"}</p>
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto">
        {saved && (
          <div className="bg-green-50 border border-green-300 rounded-2xl p-4 mb-4 text-center text-green-700 font-medium">
            ✅ Profil berhasil disimpan!
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {data?.fields?.map(field => (
            <div key={field.name} className="bg-white rounded-2xl p-4 shadow-sm">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </label>
              {field.type === "select" ? (
                <select
                  value={form[field.name] ?? ""}
                  onChange={e => setForm(prev => ({ ...prev, [field.name]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  required={field.required}
                >
                  <option value="">Pilih...</option>
                  {field.options?.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={form[field.name] ?? ""}
                  onChange={e => setForm(prev => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={`Masukkan ${field.label.toLowerCase()}`}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  required={field.required}
                />
              )}
            </div>
          ))}

          {/* Vehicle Assignment */}
          {(data?.available_vehicles?.length ?? 0) > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                🚛 Kendaraan yang Ditugaskan
              </label>
              <select
                value={form["primary_vehicle_id"] ?? ""}
                onChange={e => setForm(prev => ({ ...prev, primary_vehicle_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              >
                <option value="">-- Belum ditugaskan --</option>
                {data?.available_vehicles?.map(v => (
                  <option key={v.id} value={String(v.id)}>
                    {v.plate_number} ({v.vehicle_type})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-green-600 text-white rounded-2xl py-3.5 font-bold text-base disabled:opacity-60"
          >
            {saving ? "Menyimpan..." : "💾 Simpan Profil"}
          </button>
        </form>
      </div>
    </div>
  );
}
