/**
 * Public Page: Customer "My Bookings"
 * Route: /sc/my-bookings
 * No auth required — phone-based access
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, Clock, Dumbbell, LogOut, RefreshCw } from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Booking = {
  id: number;
  bookingNumber?: string;
  facilityName?: string;
  fieldType: string;
  bookingDate: string;
  startTime: string;
  endTime?: string;
  totalPrice?: number;
  paymentStatus?: string;
  status: string;
  paymentDeadline?: string;
  adminNotes?: string;
  paymentProofToken?: string;
};

const PAYMENT_LABELS: Record<string, { label: string; cls: string }> = {
  unpaid:               { label: "Menunggu Pembayaran", cls: "bg-orange-100 text-orange-700 border-orange-300" },
  waiting_verification: { label: "Verifikasi Pembayaran", cls: "bg-blue-100 text-blue-700 border-blue-300" },
  paid:                 { label: "Terkonfirmasi", cls: "bg-green-100 text-green-700 border-green-300" },
  cancelled:            { label: "Dibatalkan", cls: "bg-red-100 text-red-700 border-red-300" },
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:   { label: "Menunggu", cls: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  confirmed: { label: "Terkonfirmasi", cls: "bg-green-100 text-green-700 border-green-300" },
  cancelled: { label: "Dibatalkan", cls: "bg-red-100 text-red-700 border-red-300" },
  completed: { label: "Selesai", cls: "bg-blue-100 text-blue-700 border-blue-300" },
};

function formatCurrency(n?: number) {
  if (!n) return "—";
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function formatDateIndo(isoDate?: string) {
  if (!isoDate) return "—";
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function PaymentBadge({ status }: { status: string }) {
  const c = PAYMENT_LABELS[status] ?? PAYMENT_LABELS.unpaid;
  return <Badge className={`${c.cls} border text-xs font-medium px-2 py-0.5`}>{c.label}</Badge>;
}

export default function ScMyBookings() {
  const [phoneInput, setPhoneInput] = useState("");
  const [submittedPhone, setSubmittedPhone] = useState("");

  // company scoping: default company for this tenant
  const company = (window as Record<string, unknown>).SC_COMPANY_ID as string | undefined ?? "default";

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sc-my-bookings", submittedPhone, company],
    queryFn: () =>
      fetch(`${BASE}/api/public/sc/my-bookings?phone=${encodeURIComponent(submittedPhone)}&company=${encodeURIComponent(company)}`)
        .then(r => r.json()),
    enabled: !!submittedPhone,
  });

  const bookings: Booking[] = data?.data ?? [];
  const total = bookings.length;
  const confirmed = bookings.filter(b => b.status === "confirmed" || b.paymentStatus === "paid").length;
  const pending = bookings.filter(b => b.status === "pending" && b.paymentStatus !== "paid").length;
  const displayPhone = submittedPhone ? submittedPhone.replace(/^62/, "0") : "";

  const handleSearch = () => {
    const digits = phoneInput.replace(/\D/g, "");
    if (!digits || digits.length < 5) return;
    const normalized = digits.startsWith("62") ? digits : `62${digits.replace(/^0/, "")}`;
    setSubmittedPhone(normalized);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-orange-500 rounded-full p-1.5">
              <Dumbbell className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-gray-800">Sport Center</span>
          </div>
          {submittedPhone && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">{displayPhone}</span>
              <div className="bg-orange-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">{total}</div>
              <Button variant="ghost" size="sm" onClick={() => { setSubmittedPhone(""); setPhoneInput(""); }}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Booking Saya</h1>
          <p className="text-sm text-gray-500 mt-0.5">Riwayat dan status pemesanan fasilitas Anda</p>
        </div>

        {/* Phone Input */}
        {!submittedPhone && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <p className="text-sm font-medium text-gray-700">Masukkan nomor WhatsApp Anda untuk melihat booking</p>
            <div className="flex gap-2">
              <Input
                placeholder="08xxxxxxxxxx atau 628xxxxxxxxx"
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} className="bg-orange-500 hover:bg-orange-600">
                Cari
              </Button>
            </div>
          </div>
        )}

        {/* Stats */}
        {submittedPhone && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total Booking", value: total, cls: "text-gray-800" },
                { label: "Terkonfirmasi", value: confirmed, cls: "text-green-600" },
                { label: "Menunggu", value: pending, cls: "text-orange-500" },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Booking List */}
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">
                Booking Aktif{" "}
                <span className="text-orange-500">({bookings.filter(b => b.status !== "cancelled" && b.status !== "completed").length})</span>
              </h2>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {isLoading && (
              <div className="text-center text-gray-400 py-10">Memuat...</div>
            )}

            {!isLoading && bookings.length === 0 && (
              <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
                <Dumbbell className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Belum ada booking ditemukan untuk nomor ini.</p>
                <p className="text-gray-400 text-xs mt-1">Kirim pesan ke WhatsApp kami untuk booking lapangan.</p>
              </div>
            )}

            {bookings.map(b => {
              const statusCfg = STATUS_LABELS[b.status] ?? STATUS_LABELS.pending;
              const isActive = b.status !== "cancelled" && b.status !== "completed";
              return (
                <div key={b.id}
                  className={`bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm ${isActive ? "border-l-4 border-l-orange-400" : "opacity-70"}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-bold text-gray-900">{b.facilityName ?? b.fieldType}</div>
                        <div className="text-xs font-semibold text-orange-500 uppercase tracking-wide mt-0.5">{b.fieldType}</div>
                      </div>
                      <PaymentBadge status={b.paymentStatus ?? b.status} />
                    </div>

                    <div className="flex items-center gap-3 mt-3 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                        {formatDateIndo(b.bookingDate)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-gray-400" />
                        {b.startTime}{b.endTime ? ` – ${b.endTime}` : ""}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <div className="text-lg font-bold text-orange-500">{formatCurrency(b.totalPrice)}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-mono">#{b.bookingNumber ?? b.id}</span>
                        {b.paymentProofToken && (
                          <Link href={`/sc/status/${b.paymentProofToken}`}>
                            <span className="text-blue-600 hover:underline cursor-pointer">Detail &gt;</span>
                          </Link>
                        )}
                      </div>
                    </div>

                    {b.paymentStatus === "unpaid" && b.paymentDeadline && isActive && (
                      <div className="mt-2 p-2 bg-orange-50 rounded-lg text-xs text-orange-700">
                        ⏰ Bayar sebelum {new Date(b.paymentDeadline).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
