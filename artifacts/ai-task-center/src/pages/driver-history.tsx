import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";

interface Trip {
  id: number; origin: string; destination: string; trip_purpose: string;
  actual_departure: string; actual_arrival: string; actual_km: number | null;
  status: string; delay_minutes: number | null; notes: string | null;
  plate_number: string; vehicle_type: string;
}

export default function DriverHistoryPage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/driver/history/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setTrips((d.trips as Trip[]) ?? []);
      })
      .catch(() => setError("Gagal memuat riwayat"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center">
      <p className="text-green-700">Memuat riwayat...</p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 shadow text-center max-w-sm">
        <p className="text-sm text-gray-600">{error}</p>
      </div>
    </div>
  );

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  }
  function formatDuration(start: string, end: string) {
    const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
    return `${Math.floor(mins / 60)}j ${mins % 60}m`;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white px-4 py-5 flex items-center gap-3">
        <button onClick={() => navigate(`/driver/home/${token}`)} className="text-white/80">←</button>
        <div>
          <h1 className="font-bold text-lg">📋 Riwayat Trip</h1>
          <p className="text-green-200 text-xs">{trips.length} trip terakhir</p>
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto">
        {trips.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🗺️</p>
            <p className="text-gray-500">Belum ada riwayat trip</p>
          </div>
        ) : (
          <div className="space-y-3">
            {trips.map(trip => (
              <div key={trip.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-800">{trip.origin} → {trip.destination}</p>
                    <p className="text-xs text-gray-500">{trip.plate_number} · {formatDate(trip.actual_departure)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    trip.status === "completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {trip.status === "completed" ? "✅ Selesai" : trip.status}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
                  {trip.actual_departure && trip.actual_arrival && (
                    <span>⏱️ {formatDuration(trip.actual_departure, trip.actual_arrival)}</span>
                  )}
                  {trip.actual_km && <span>📏 {trip.actual_km.toLocaleString("id-ID")} km</span>}
                </div>
                {trip.notes && <p className="text-xs text-gray-500 mt-1 italic">{trip.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
