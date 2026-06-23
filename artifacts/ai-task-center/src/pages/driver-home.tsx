import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";

interface DriverHomeData {
  registered: boolean;
  driver: {
    id: number; name: string; status: string;
    license_number: string; license_type: string; license_expired: string | null;
    license_days_left: number | null; license_warning: boolean;
    primary_vehicle_id: number | null; base_location: string | null;
  } | null;
  active_trip: { id: number; destination: string; origin: string; actual_departure: string; vehicle_plate: string } | null;
  documents: { sim: boolean; ktp: boolean; medical: boolean; photo: boolean };
  documents_complete: boolean;
  last_fuel: { liters_filled: number; km_per_liter: number | null; logged_at: string } | null;
  portal_links: { profile: string; documents: string; trips: string; history: string };
}

export default function DriverHomePage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [data, setData] = useState<DriverHomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/driver/home/${token}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Gagal memuat data"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-2">🚛</div>
        <p className="text-green-700">Memuat portal driver...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 shadow text-center max-w-sm w-full">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="font-bold text-gray-800 mb-2">Link Tidak Valid</h2>
        <p className="text-sm text-gray-500 mb-4">{error}</p>
        <p className="text-xs text-gray-400">Kirim <strong>DAFTAR DRIVER</strong> via WhatsApp untuk mendapatkan link baru.</p>
      </div>
    </div>
  );

  if (!data) return null;

  const docKeys = ["sim", "ktp", "medical", "photo"] as const;
  const docLabels = { sim: "SIM", ktp: "KTP", medical: "Ket. Sehat", photo: "Foto" };
  const missingCount = docKeys.filter(k => !data.documents[k]).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 py-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">🚛</div>
          <div>
            <h1 className="font-bold text-lg">{data.driver?.name ?? "Driver Baru"}</h1>
            <p className="text-green-200 text-sm">{data.driver ? `SIM: ${data.driver.license_number}` : "Belum terdaftar"}</p>
          </div>
        </div>
        {data.driver?.license_warning && (
          <div className="mt-3 bg-yellow-500 rounded-lg px-3 py-2 text-sm font-medium">
            ⚠️ SIM kadaluarsa {data.driver.license_days_left} hari lagi!
          </div>
        )}
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto">
        {/* Registration Banner */}
        {!data.registered && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <h2 className="font-semibold text-blue-800 mb-1">👋 Selamat Datang!</h2>
            <p className="text-sm text-blue-600 mb-3">Lengkapi profil Anda untuk mulai menggunakan portal driver.</p>
            <button
              onClick={() => navigate(`/driver/profile/${token}`)}
              className="w-full bg-blue-600 text-white rounded-xl py-2.5 font-medium text-sm"
            >
              Lengkapi Profil Sekarang →
            </button>
          </div>
        )}

        {/* Active Trip */}
        {data.active_trip && (
          <div className="bg-green-50 border border-green-300 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-green-700 font-semibold">🟢 Trip Aktif</span>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">On Route</span>
            </div>
            <p className="text-sm font-medium text-gray-800">→ {data.active_trip.destination}</p>
            <p className="text-xs text-gray-500 mt-1">{data.active_trip.vehicle_plate}</p>
            <button
              onClick={() => navigate(`/driver/trips/${token}`)}
              className="w-full mt-3 bg-green-600 text-white rounded-xl py-2 font-medium text-sm"
            >
              Selesaikan Trip
            </button>
          </div>
        )}

        {/* Documents Status */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">📄 Dokumen</h2>
            {missingCount === 0
              ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ Lengkap</span>
              : <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{missingCount} kurang</span>
            }
          </div>
          <div className="grid grid-cols-4 gap-2">
            {docKeys.map(k => (
              <div key={k} className={`text-center p-2 rounded-xl ${data.documents[k] ? "bg-green-50" : "bg-red-50"}`}>
                <div className="text-lg">{data.documents[k] ? "✅" : "❌"}</div>
                <div className="text-xs mt-1 text-gray-600">{docLabels[k]}</div>
              </div>
            ))}
          </div>
          {missingCount > 0 && (
            <button
              onClick={() => navigate(`/driver/documents/${token}`)}
              className="w-full mt-3 bg-orange-500 text-white rounded-xl py-2 font-medium text-sm"
            >
              Upload Dokumen
            </button>
          )}
        </div>

        {/* Last Fuel */}
        {data.last_fuel && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-2">⛽ BBM Terakhir</h2>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-lg font-bold text-gray-800">{data.last_fuel.liters_filled} L</div>
                <div className="text-xs text-gray-500">Liter</div>
              </div>
              {data.last_fuel.km_per_liter && (
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600">{data.last_fuel.km_per_liter.toFixed(1)}</div>
                  <div className="text-xs text-gray-500">KM/L</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Nav */}
        {data.registered && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "👤 Profil", path: `/driver/profile/${token}` },
              { label: "📄 Dokumen", path: `/driver/documents/${token}` },
              { label: "🗺️ Trip", path: `/driver/trips/${token}` },
              { label: "📋 Riwayat", path: `/driver/history/${token}` },
            ].map(({ label, path }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="bg-white rounded-2xl p-4 shadow-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
