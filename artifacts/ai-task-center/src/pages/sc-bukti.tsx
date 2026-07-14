/**
 * Public Page: Upload Payment Proof
 * Route: /sc/bukti/:token
 * No auth required — token-based access
 */

import { useState } from "react";
import { useParams } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dumbbell, Upload, CheckCircle, AlertCircle, Image } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ScBukti() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [proofUrl, setProofUrl] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [displayBookingNumber, setDisplayBookingNumber] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/public/sc/bukti/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal upload");
      return data;
    },
    onSuccess: (data) => {
      setUploadSuccess(true);
      setDisplayBookingNumber(data.bookingNumber ?? null);
    },
  });

  const isValidUrl = proofUrl.startsWith("http://") || proofUrl.startsWith("https://");

  if (uploadSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <div className="bg-green-100 rounded-full p-4 w-16 h-16 mx-auto flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Bukti Diterima!</h1>
          <p className="text-gray-500 text-sm">
            Bukti transfer Anda telah berhasil dikirim. Admin akan segera memverifikasi pembayaran.
          </p>
          {displayBookingNumber && (
            <div className="bg-orange-50 rounded-lg p-3">
              <div className="text-xs text-gray-400">Nomor Booking</div>
              <div className="font-bold text-orange-600 font-mono text-lg">{displayBookingNumber}</div>
            </div>
          )}
          {/* token is the payment_proof_token — same token used for status lookup */}
          {token && (
            <a href={`${BASE}/sc/status/${token}`}
              className="block w-full bg-orange-500 hover:bg-orange-600 text-white rounded-lg py-2.5 font-medium text-sm transition-colors">
              Cek Status Booking
            </a>
          )}
        </div>
      </div>
    );
  }

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
          <span className="text-sm text-gray-500">Upload Bukti Transfer</span>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Upload Bukti Transfer</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload bukti transfer pembayaran Anda agar admin dapat memverifikasi.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {/* Instructions */}
          <div className="bg-blue-50 rounded-lg p-4 space-y-2">
            <p className="text-sm font-semibold text-blue-800">Cara Upload Bukti Transfer:</p>
            <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
              <li>Upload foto bukti transfer ke layanan seperti <strong>Google Drive</strong>, <strong>imgbb.com</strong>, atau <strong>Cloudinary</strong></li>
              <li>Salin link langsung ke gambar tersebut</li>
              <li>Tempel link di kolom di bawah ini</li>
              <li>Klik tombol "Kirim Bukti Transfer"</li>
            </ol>
          </div>

          {/* URL Input */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">
              Link Bukti Transfer (URL Gambar) *
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Image className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  className="pl-9"
                  placeholder="https://i.imgbb.com/xxxx.jpg"
                  value={proofUrl}
                  onChange={e => setProofUrl(e.target.value)}
                />
              </div>
            </div>
            {proofUrl && !isValidUrl && (
              <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                URL harus diawali dengan http:// atau https://
              </p>
            )}
            {isValidUrl && (
              <div className="mt-2">
                <img src={proofUrl} alt="Preview" className="max-h-32 rounded-lg border border-gray-200 object-cover"
                  onError={e => (e.currentTarget.style.display = "none")} />
              </div>
            )}
          </div>

          {submitMutation.isError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {(submitMutation.error as Error).message}
            </div>
          )}

          <Button
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => submitMutation.mutate()}
            disabled={!isValidUrl || submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <>
                <Upload className="h-4 w-4 mr-2 animate-bounce" />
                Mengirim...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Kirim Bukti Transfer
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-gray-400 text-center">
          Setelah bukti diterima, admin akan memverifikasi dalam 1x24 jam.
        </p>
      </div>
    </div>
  );
}
