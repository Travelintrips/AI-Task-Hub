import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";

interface DriverRow {
  id: number; full_name: string; phone: string; status: string;
  license_number: string; license_type: string; license_expired: string | null;
  plate_number: string | null; doc_count: number; verified_count: number;
  open_incidents: number; created_at: string;
}
interface ExpiringLicense { id: number; full_name: string; phone: string; license_number: string; license_expired: string }
interface PendingDoc {
  id: number; driver_id: number; document_type: string; file_name: string; file_url: string | null;
  uploaded_at: string; driver_name: string; driver_phone: string;
}
interface PerfRow { id: number; full_name: string; overall_score: number | null; total_trips: number | null; avg_fuel_efficiency: number | null }
interface AdminData {
  drivers: DriverRow[];
  expiring_licenses: ExpiringLicense[];
  pending_documents: PendingDoc[];
  performance: PerfRow[];
  summary: { total_drivers: number; expiring_soon: number; pending_doc_review: number };
}

const DOC_LABELS: Record<string, string> = { sim: "SIM", ktp: "KTP", medical: "Ket. Sehat", photo: "Foto" };

export default function DriverAdminPage() {
  const { token: authToken } = useAuth();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"drivers" | "documents" | "expiring" | "performance">("drivers");
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const fetchData = () => {
    setLoading(true);
    fetch("/api/drivers/admin", {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  async function handleDocAction(doc: PendingDoc, action: "approve" | "reject") {
    const notes = action === "reject" ? prompt("Alasan penolakan (opsional):") ?? "" : "";
    setApprovingId(doc.id);
    try {
      const res = await fetch(`/api/drivers/${doc.driver_id}/approve-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ document_id: doc.id, action, notes }),
      });
      if (res.ok) fetchData();
    } finally {
      setApprovingId(null);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-3xl mb-2">🚛</div>
        <p className="text-gray-500">Memuat data driver...</p>
      </div>
    </div>
  );

  const TABS = [
    { key: "drivers" as const, label: `Driver (${data?.summary.total_drivers ?? 0})` },
    { key: "documents" as const, label: `Review Dok (${data?.summary.pending_doc_review ?? 0})`, badge: (data?.summary.pending_doc_review ?? 0) > 0 },
    { key: "expiring" as const, label: `SIM Exp. (${data?.summary.expiring_soon ?? 0})`, badge: (data?.summary.expiring_soon ?? 0) > 0 },
    { key: "performance" as const, label: "Performa" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">🚛 Driver Admin</h1>
        <p className="text-sm text-gray-500">Kelola driver, dokumen, dan performa</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Driver", value: data?.summary.total_drivers ?? 0, color: "bg-blue-50 text-blue-700" },
          { label: "SIM Kadaluarsa", value: data?.summary.expiring_soon ?? 0, color: "bg-orange-50 text-orange-700" },
          { label: "Dokumen Pending", value: data?.summary.pending_doc_review ?? 0, color: "bg-yellow-50 text-yellow-700" },
        ].map(card => (
          <div key={card.label} className={`rounded-2xl p-4 ${card.color}`}>
            <div className="text-2xl font-bold">{card.value}</div>
            <div className="text-sm font-medium">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? "bg-green-600 text-white" : "bg-white text-gray-600 border border-gray-200"
            } ${t.badge ? "ring-2 ring-orange-400" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Drivers Tab */}
      {tab === "drivers" && (
        <div className="space-y-3">
          {(data?.drivers ?? []).map(d => (
            <div key={d.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-lg flex-shrink-0">
                {d.status === "active" ? "🟢" : "⚫"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-800">{d.full_name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${d.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {d.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500">{d.phone}</p>
                <p className="text-xs text-gray-400">{d.license_number} · {d.license_type}</p>
                {d.plate_number && <p className="text-xs text-blue-600">{d.plate_number}</p>}
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>{Number(d.doc_count)}/4 dok</p>
                <p>{Number(d.verified_count)} terverif</p>
                {Number(d.open_incidents) > 0 && <p className="text-red-500">{Number(d.open_incidents)} insiden</p>}
              </div>
            </div>
          ))}
          {(data?.drivers ?? []).length === 0 && (
            <div className="text-center py-12 text-gray-400">Belum ada driver terdaftar</div>
          )}
        </div>
      )}

      {/* Pending Documents Tab */}
      {tab === "documents" && (
        <div className="space-y-3">
          {(data?.pending_documents ?? []).map(doc => (
            <div key={doc.id} className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-800">{doc.driver_name}</p>
                  <p className="text-sm text-gray-500">{doc.driver_phone}</p>
                </div>
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                  {DOC_LABELS[doc.document_type] ?? doc.document_type}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-3 truncate">📄 {doc.file_name}</p>
              {doc.file_url && (
                <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-600 underline block mb-3">
                  Lihat Dokumen →
                </a>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleDocAction(doc, "approve")}
                  disabled={approvingId === doc.id}
                  className="flex-1 bg-green-600 text-white rounded-xl py-2 text-sm font-medium disabled:opacity-60"
                >
                  {approvingId === doc.id ? "..." : "✅ Setujui"}
                </button>
                <button
                  onClick={() => handleDocAction(doc, "reject")}
                  disabled={approvingId === doc.id}
                  className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium disabled:opacity-60"
                >
                  {approvingId === doc.id ? "..." : "❌ Tolak"}
                </button>
              </div>
            </div>
          ))}
          {(data?.pending_documents ?? []).length === 0 && (
            <div className="text-center py-12 text-gray-400">Tidak ada dokumen pending</div>
          )}
        </div>
      )}

      {/* Expiring Licenses Tab */}
      {tab === "expiring" && (
        <div className="space-y-3">
          {(data?.expiring_licenses ?? []).map(d => {
            const days = Math.ceil((new Date(d.license_expired).getTime() - Date.now()) / 86_400_000);
            return (
              <div key={d.id} className={`bg-white rounded-2xl p-4 shadow-sm border-l-4 ${days <= 0 ? "border-red-500" : days <= 14 ? "border-orange-400" : "border-yellow-400"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-800">{d.full_name}</p>
                    <p className="text-sm text-gray-500">{d.phone}</p>
                    <p className="text-xs text-gray-400">{d.license_number}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${days <= 0 ? "text-red-600" : days <= 14 ? "text-orange-600" : "text-yellow-600"}`}>
                      {days <= 0 ? "EXPIRED" : `${days} hari`}
                    </p>
                    <p className="text-xs text-gray-400">{d.license_expired}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {(data?.expiring_licenses ?? []).length === 0 && (
            <div className="text-center py-12 text-gray-400">Tidak ada SIM yang akan kadaluarsa</div>
          )}
        </div>
      )}

      {/* Performance Tab */}
      {tab === "performance" && (
        <div className="space-y-3">
          {(data?.performance ?? []).map((p, idx) => (
            <div key={p.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                idx === 0 ? "bg-yellow-100 text-yellow-700" :
                idx === 1 ? "bg-gray-100 text-gray-600" :
                idx === 2 ? "bg-orange-100 text-orange-700" : "bg-gray-50 text-gray-500"
              }`}>
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800">{p.full_name}</p>
                <p className="text-xs text-gray-500">{p.total_trips ?? 0} trip · {p.avg_fuel_efficiency ? `${Number(p.avg_fuel_efficiency).toFixed(1)} KM/L` : "-"}</p>
              </div>
              <div className="text-right">
                <div className={`text-lg font-bold ${(p.overall_score ?? 0) >= 80 ? "text-green-600" : (p.overall_score ?? 0) >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                  {p.overall_score != null ? p.overall_score.toFixed(0) : "-"}
                </div>
                <p className="text-xs text-gray-400">score</p>
              </div>
            </div>
          ))}
          {(data?.performance ?? []).length === 0 && (
            <div className="text-center py-12 text-gray-400">Belum ada data performa</div>
          )}
        </div>
      )}
    </div>
  );
}
