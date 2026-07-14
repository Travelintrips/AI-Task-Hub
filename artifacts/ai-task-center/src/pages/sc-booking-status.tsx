/**
 * Public Page: Booking Status by Booking Number
 * Route: /sc/status/:bookingNumber
 * No auth required
 */

import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dumbbell, CalendarDays, Clock, Phone, User, RefreshCw, CheckCircle, XCircle, Loader2 } from "lucide-react";
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
  durationHours?: number;
  bookerName?: string;
  phone?: string;
  status: string;
  paymentStatus?: string;
  totalPrice?: number;
  paymentDeadline?: string;
  paymentProofUrl?: string;
  adminNotes?: string;
};

const STATUS_CFG: Record<string, { label: string; cls: string; icon: React.ReactNode; desc: string }> = {
  pending: {
    label: "Menunggu Konfirmasi", cls: "bg-orange-100 text-orange-700 border-orange-300",
    icon: <Loader2 className="h-5 w-5 text-orange-500 animate-spin" />,
    desc: "Booking Anda sedang menunggu konfirmasi dari admin setelah pembayaran diverifikasi.",
  },
  confirmed: {
    label: "Terkonfirmasi", cls: "bg-green-100 text-green-700 border-green-300",
    icon: <CheckCircle className="h-5 w-5 text-green-500" />,
    desc: "Booking Anda telah dikonfirmasi. Silakan datang sesuai jadwal.",
  },
  cancelled: {
    label: "Dibatalkan", cls: "bg-red-100 text-red-700 border-red-300",
    icon: <XCircle className="h-5 w-5 text-red-500" />,
    desc: "Booking ini telah dibatalkan. Hubungi admin jika ada pertanyaan.",
  },
  completed: {
    label: "Selesai", cls: "bg-blue-100 text-blue-700 border-blue-300",
    icon: <CheckCircle className="h-5 w-5 text-blue-500" />,
    desc: "Terima kasih telah menggunakan fasilitas kami. Sampai jumpa!",
  },
};

const PAYMENT_CFG: Record<string, { label: string; cls: string }> = {
  unpaid:               { label: "Belum Dibayar",        cls: "bg-orange-100 text-orange-700 border-orange-300" },
  waiting_verification: { label: "Menunggu Verifikasi",  cls: "bg-blue-100 text-blue-700 border-blue-300" },
  paid:                 { label: "Lunas",                 cls: "bg-green-100 text-green-700 border-green-300" },
  cancelled:            { label: "Dibatalkan",            cls: "bg-red-100 text-red-700 border-red-300" },
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

export default function ScBookingStatus() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["sc-booking-status", token],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/public/sc/status/${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Status ${res.status}`);
      }
      return res.json();
    },
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const booking: Booking | undefined = data?.data;
  const statusCfg = STATUS_CFG[booking?.status ?? "pending"] ?? STATUS_CFG.pending;
  const paymentCfg = PAYMENT_CFG[booking?.paymentStatus ?? "unpaid"] ?? PAYMENT_CFG.unpaid;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-2">
          <div className="bg-orange-500 rounded-full p-1.5">
            <Dumbbell className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-gray-800">Sport Center</span>
          <span className="text-gray-300 mx-1">|</span>
          <span className="text-sm text-gray-500">Status Booking</span>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {isLoading && (
          <div className="text-center py-16">
            <Loader2 className="h-8 w-8 text-orange-400 animate-spin mx-auto mb-3" />
            <p className="text-gray-500">Memuat status booking...</p>
          </div>
        )}

        {isError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <XCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
            <p className="text-red-700 font-medium">Booking tidak ditemukan</p>
            <p className="text-red-500 text-sm mt-1">Periksa kembali nomor booking Anda</p>
          </div>
        )}

        {booking && (
          <>
            {/* Booking Number */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
              <div className="text-xs text-gray-400 uppercase tracking-widest mb-1">Nomor Booking</div>
              <div className="text-2xl font-bold text-orange-500 font-mono">{booking.bookingNumber ?? token}</div>
            </div>

            {/* Status Card */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3">
                {statusCfg.icon}
                <div>
                  <Badge className={`${statusCfg.cls} border font-medium`}>{statusCfg.label}</Badge>
                  <p className="text-sm text-gray-500 mt-1">{statusCfg.desc}</p>
                </div>
              </div>
            </div>

            {/* Booking Details */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h2 className="font-semibold text-gray-800 border-b border-gray-100 pb-2">Detail Booking</h2>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Fasilitas</div>
                  <div className="font-semibold text-gray-800">{booking.facilityName ?? booking.fieldType}</div>
                  <div className="text-xs text-orange-500 uppercase font-medium">{booking.fieldType}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Total Pembayaran</div>
                  <div className="font-bold text-orange-500 text-lg">{formatCurrency(booking.totalPrice)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><CalendarDays className="h-3 w-3" />Tanggal</div>
                  <div className="font-medium text-gray-700">{formatDateIndo(booking.bookingDate)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><Clock className="h-3 w-3" />Jam</div>
                  <div className="font-medium text-gray-700">
                    {booking.startTime}{booking.endTime ? ` – ${booking.endTime}` : ""}
                    {booking.durationHours ? ` (${booking.durationHours} jam)` : ""}
                  </div>
                </div>
                {booking.bookerName && (
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><User className="h-3 w-3" />Pemesan</div>
                    <div className="font-medium text-gray-700">{booking.bookerName}</div>
                  </div>
                )}
                {booking.phone && (
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><Phone className="h-3 w-3" />No. WA</div>
                    <div className="font-medium text-gray-700">{booking.phone.replace(/^62/, "0")}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Status */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 border-b border-gray-100 pb-2 mb-3">Status Pembayaran</h2>
              <div className="flex items-center justify-between">
                <Badge className={`${paymentCfg.cls} border font-medium`}>{paymentCfg.label}</Badge>
                {booking.paymentStatus === "unpaid" && booking.paymentDeadline && (
                  <span className="text-xs text-red-500 font-medium">
                    Batas: {new Date(booking.paymentDeadline).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
              {booking.adminNotes && (
                <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                  <span className="font-medium">Catatan Admin: </span>{booking.adminNotes}
                </div>
              )}
              {booking.paymentProofUrl && (
                <div className="mt-3">
                  <a href={booking.paymentProofUrl} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 text-sm underline">
                    📎 Lihat Bukti Transfer ↗
                  </a>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />Perbarui Status
              </Button>
              <Link href="/sc/my-bookings">
                <Button variant="outline" className="flex-1">Booking Saya</Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
