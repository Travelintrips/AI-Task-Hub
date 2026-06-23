import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";

interface TripData {
  active_trip: {
    id: number; destination: string; origin: string;
    trip_purpose: string; actual_departure: string;
    plate_number: string; vehicle_type: string;
  } | null;
  assigned_vehicle: { id: number; plate_number: string; vehicle_type: string; brand: string; model: string } | null;
  can_start_trip: boolean;
}

export default function DriverTripsPage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [data, setData] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [destination, setDestination] = useState("");

  const fetchData = () => {
    if (!token) return;
    fetch(`/api/public/driver/trips/${token}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Gagal memuat trip"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [token]);

  async function handleStart() {
    if (!destination.trim()) { alert("Masukkan tujuan trip"); return; }
    setProcessing(true); setMsg(null);
    try {
      const res = await fetch(`/api/public/driver/trips/${token}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: destination.trim(), trip_purpose: "pengiriman" }),
      });
      const d = await res.json() as Record<string, unknown>;
      if (!res.ok) { setMsg(`❌ ${String(d["error"] ?? "Gagal memulai trip")}`); return; }
      setMsg(`✅ ${String(d["message"] ?? "Trip dimulai!")}`);
      setDestination("");
      fetchData();
    } catch { setMsg("❌ Gagal memulai trip"); }
    finally { setProcessing(false); }
  }

  async function handleEnd(actualKm: string) {
    setProcessing(true); setMsg(null);
    try {
      const res = await fetch(`/api/public/driver/trips/${token}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual_km: actualKm ? Number(actualKm) : null }),
      });
      const d = await res.json() as Record<string, unknown>;
      if (!res.ok) { setMsg(`❌ ${String(d["error"] ?? "Gagal menyelesaikan trip")}`); return; }
      setMsg(`✅ ${String(d["message"] ?? "Trip selesai!")}`);
      fetchData();
    } catch { setMsg("❌ Gagal menyelesaikan trip"); }
    finally { setProcessing(false); }
  }

  if (loading) return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center">
      <p className="text-green-700">Memuat data trip...</p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 shadow text-center max-w-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-sm text-gray-600">{error}</p>
        {error.includes("profil") && (
          <button onClick={() => navigate(`/driver/profile/${token}`)}
            className="mt-4 bg-green-600 text-white px-4 py-2 rounded-xl text-sm">
            Isi Profil Dulu
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white px-4 py-5 flex items-center gap-3">
        <button onClick={() => navigate(`/driver/home/${token}`)} className="text-white/80">←</button>
        <div>
          <h1 className="font-bold text-lg">🗺️ Trip</h1>
          <p className="text-green-200 text-xs">Mulai atau selesaikan trip</p>
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto space-y-4">
        {msg && (
          <div className={`p-3 rounded-2xl text-sm font-medium ${msg.startsWith("✅") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {msg}
          </div>
        )}

        {/* Active Trip */}
        {data?.active_trip ? (
          <ActiveTripCard trip={data.active_trip} onEnd={handleEnd} processing={processing} />
        ) : (
          // Start Trip Form
          <StartTripCard
            vehicle={data?.assigned_vehicle}
            destination={destination}
            onChangeDestination={setDestination}
            onStart={handleStart}
            processing={processing}
            canStart={data?.can_start_trip ?? false}
          />
        )}

        <button
          onClick={() => navigate(`/driver/history/${token}`)}
          className="w-full bg-white rounded-2xl p-4 shadow-sm text-gray-700 font-medium text-left"
        >
          📋 Lihat Riwayat Trip
        </button>
      </div>
    </div>
  );
}

function ActiveTripCard({
  trip,
  onEnd,
  processing,
}: {
  trip: NonNullable<TripData["active_trip"]>;
  onEnd: (km: string) => void;
  processing: boolean;
}) {
  const [km, setKm] = useState("");
  const departed = new Date(trip.actual_departure);
  const elapsed = Math.round((Date.now() - departed.getTime()) / 60_000);

  return (
    <div className="bg-green-50 border-2 border-green-400 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="font-bold text-green-800 text-lg">🟢 Trip Aktif</span>
        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">{elapsed} menit</span>
      </div>
      <div className="space-y-2 mb-4">
        <div className="flex gap-2">
          <span className="text-sm text-gray-500 w-20">Tujuan:</span>
          <span className="text-sm font-bold text-gray-800">{trip.destination}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-sm text-gray-500 w-20">Asal:</span>
          <span className="text-sm text-gray-700">{trip.origin}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-sm text-gray-500 w-20">Kendaraan:</span>
          <span className="text-sm text-gray-700">{trip.plate_number}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-sm text-gray-500 w-20">Berangkat:</span>
          <span className="text-sm text-gray-700">{departed.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>

      <div className="space-y-3">
        <input
          type="number"
          placeholder="Odometer akhir (km) — opsional"
          value={km}
          onChange={e => setKm(e.target.value)}
          className="w-full border border-green-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
        />
        <button
          onClick={() => onEnd(km)}
          disabled={processing}
          className="w-full bg-red-500 text-white rounded-xl py-3 font-bold text-base disabled:opacity-60"
        >
          {processing ? "Memproses..." : "🏁 Selesaikan Trip"}
        </button>
      </div>
    </div>
  );
}

function StartTripCard({
  vehicle,
  destination,
  onChangeDestination,
  onStart,
  processing,
  canStart,
}: {
  vehicle: TripData["assigned_vehicle"];
  destination: string;
  onChangeDestination: (v: string) => void;
  onStart: () => void;
  processing: boolean;
  canStart: boolean;
}) {
  if (!vehicle) return (
    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 text-center">
      <p className="text-2xl mb-2">🚛</p>
      <p className="text-sm text-orange-700 font-medium">Belum ada kendaraan yang ditugaskan</p>
      <p className="text-xs text-orange-500 mt-1">Hubungi admin untuk assignment kendaraan</p>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <h2 className="font-bold text-gray-800 mb-4">🟢 Mulai Trip Baru</h2>
      <div className="bg-gray-50 rounded-xl p-3 mb-4">
        <p className="text-xs text-gray-500">Kendaraan</p>
        <p className="font-bold text-gray-800">{vehicle.plate_number}</p>
        <p className="text-sm text-gray-600">{vehicle.brand} {vehicle.model}</p>
      </div>
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Tujuan trip (wajib)"
          value={destination}
          onChange={e => onChangeDestination(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        />
        <button
          onClick={onStart}
          disabled={processing || !canStart}
          className="w-full bg-green-600 text-white rounded-xl py-3 font-bold text-base disabled:opacity-60"
        >
          {processing ? "Memproses..." : "🟢 Mulai Trip"}
        </button>
      </div>
    </div>
  );
}
