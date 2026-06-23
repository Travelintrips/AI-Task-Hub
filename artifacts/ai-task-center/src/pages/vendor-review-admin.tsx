/**
 * Sprint 10A-3 — Admin: Vendor Review & Adoption Metrics
 * Route: /admin/vendor-review
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

interface PendingVendor {
  id: number;
  name: string;
  service_type: string | null;
  phone: string | null;
  contact_person: string | null;
  contact_email: string | null;
  nib: string | null;
  npwp: string | null;
  coverage_area: string | null;
  vehicle_type: string | null;
  service_capacity: string | null;
  registration_status: string;
  review_notes: string | null;
  created_at: string;
  doc_count: number;
}

interface AdoptionMetrics {
  registrations: {
    total_self_service: number;
    pending_review: number;
    approved: number;
    rejected: number;
    needs_revision: number;
    fully_complete: number;
  };
  documents: {
    total_uploaded: number;
    vendors_with_docs: number;
    verification_rate: number;
  };
  funnel: {
    tokens_sent: number;
    registrations_completed: number;
    expired_unused: number;
    conversion_rate: number;
  };
  onboarding_completion_pct: number;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  unregistered:   { label: "Belum Daftar",       color: "bg-gray-100 text-gray-600" },
  pending_review: { label: "Menunggu Review",     color: "bg-yellow-100 text-yellow-700" },
  approved:       { label: "Disetujui",           color: "bg-green-100 text-green-700" },
  rejected:       { label: "Ditolak",             color: "bg-red-100 text-red-700" },
  needs_revision: { label: "Perlu Revisi",        color: "bg-orange-100 text-orange-700" },
};

export default function VendorReviewAdmin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reviewVendor, setReviewVendor] = useState<PendingVendor | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject" | "request_revision" | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const { data: pending = [], isLoading } = useQuery<PendingVendor[]>({
    queryKey: ["vendor-pending-review"],
    queryFn: () => apiFetch("/vendors/pending-review"),
    refetchInterval: 30_000,
  });

  const { data: metrics } = useQuery<AdoptionMetrics>({
    queryKey: ["vendor-adoption-metrics"],
    queryFn: () => apiFetch("/vendors/adoption-metrics"),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ vendorId, action, notes }: { vendorId: number; action: string; notes: string }) =>
      apiFetch(`/vendors/${vendorId}/review`, {
        method: "POST",
        body: JSON.stringify({ action, notes }),
      }),
    onSuccess: () => {
      toast({ title: "Review berhasil disimpan." });
      queryClient.invalidateQueries({ queryKey: ["vendor-pending-review"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-adoption-metrics"] });
      setReviewVendor(null);
      setReviewAction(null);
      setReviewNotes("");
    },
    onError: (err: Error) => {
      toast({ title: "Gagal menyimpan review", description: err.message, variant: "destructive" });
    },
  });

  function openReview(vendor: PendingVendor, action: "approve" | "reject" | "request_revision") {
    setReviewVendor(vendor);
    setReviewAction(action);
    setReviewNotes("");
  }

  function submitReview() {
    if (!reviewVendor || !reviewAction) return;
    reviewMutation.mutate({ vendorId: reviewVendor.id, action: reviewAction, notes: reviewNotes });
  }

  const actionLabels: Record<string, string> = {
    approve: "Setujui Vendor",
    reject: "Tolak Vendor",
    request_revision: "Minta Revisi",
  };

  const actionColors: Record<string, string> = {
    approve: "bg-green-600 hover:bg-green-700",
    reject: "bg-red-600 hover:bg-red-700",
    request_revision: "bg-orange-500 hover:bg-orange-600",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">🏢 Review Vendor Self-Service</h1>

      {/* Adoption Metrics */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-yellow-600">{metrics.registrations.pending_review}</div>
              <div className="text-sm text-muted-foreground mt-1">Menunggu Review</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{metrics.registrations.approved}</div>
              <div className="text-sm text-muted-foreground mt-1">Disetujui</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{metrics.funnel.conversion_rate}%</div>
              <div className="text-sm text-muted-foreground mt-1">Konversi Token → Daftar</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-purple-600">{metrics.documents.total_uploaded}</div>
              <div className="text-sm text-muted-foreground mt-1">Dokumen Diupload</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Funnel Card */}
      {metrics && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base">Funnel Onboarding Vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-400 inline-block" />
                <span>Token Terkirim: <b>{metrics.funnel.tokens_sent}</b></span>
              </div>
              <span className="text-muted-foreground">→</span>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" />
                <span>Registrasi Selesai: <b>{metrics.funnel.registrations_completed}</b></span>
              </div>
              <span className="text-muted-foreground">→</span>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-400 inline-block" />
                <span>Disetujui: <b>{metrics.registrations.approved}</b></span>
              </div>
              <span className="ml-auto text-muted-foreground">
                Token Kadaluarsa Tanpa Digunakan: {metrics.funnel.expired_unused}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Review Table */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor Menunggu Review ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Memuat data...</div>
          ) : pending.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Tidak ada vendor yang menunggu review saat ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Perusahaan</th>
                    <th className="text-left py-2 pr-4 font-medium">Layanan</th>
                    <th className="text-left py-2 pr-4 font-medium">PIC / Kontak</th>
                    <th className="text-left py-2 pr-4 font-medium">NIB / NPWP</th>
                    <th className="text-left py-2 pr-4 font-medium">Docs</th>
                    <th className="text-left py-2 pr-4 font-medium">Status</th>
                    <th className="text-left py-2 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((v) => {
                    const st = STATUS_LABELS[v.registration_status] ?? STATUS_LABELS["pending_review"]!;
                    return (
                      <tr key={v.id} className="border-b hover:bg-muted/40">
                        <td className="py-3 pr-4">
                          <div className="font-medium">{v.name}</div>
                          <div className="text-xs text-muted-foreground">{v.phone}</div>
                          {v.coverage_area && (
                            <div className="text-xs text-muted-foreground">📍 {v.coverage_area}</div>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <div>{v.service_type ?? "—"}</div>
                          {v.vehicle_type && (
                            <div className="text-xs text-muted-foreground">{v.vehicle_type}</div>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <div>{v.contact_person ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{v.contact_email ?? ""}</div>
                        </td>
                        <td className="py-3 pr-4 text-xs">
                          <div>NIB: {v.nib ?? "—"}</div>
                          <div>NPWP: {v.npwp ?? "—"}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`font-semibold ${v.doc_count > 0 ? "text-green-600" : "text-red-500"}`}>
                            {v.doc_count}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${st.color}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex gap-1 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-700 border-green-300 hover:bg-green-50 h-7 text-xs"
                              onClick={() => openReview(v, "approve")}
                            >
                              ✓ Setujui
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-orange-600 border-orange-300 hover:bg-orange-50 h-7 text-xs"
                              onClick={() => openReview(v, "request_revision")}
                            >
                              📝 Revisi
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-300 hover:bg-red-50 h-7 text-xs"
                              onClick={() => openReview(v, "reject")}
                            >
                              ✗ Tolak
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!reviewVendor} onOpenChange={(open) => { if (!open) { setReviewVendor(null); setReviewAction(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewAction ? actionLabels[reviewAction] : ""}: {reviewVendor?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="review-notes">
              {reviewAction === "approve" ? "Catatan (opsional)" : "Alasan / Catatan *"}
            </Label>
            <Textarea
              id="review-notes"
              className="mt-1"
              rows={4}
              placeholder={
                reviewAction === "approve"
                  ? "Catatan tambahan untuk vendor (opsional)..."
                  : "Jelaskan alasan atau perbaikan yang diperlukan..."
              }
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewVendor(null); setReviewAction(null); }}>
              Batal
            </Button>
            <Button
              className={reviewAction ? actionColors[reviewAction] : ""}
              disabled={reviewMutation.isPending || (reviewAction !== "approve" && !reviewNotes.trim())}
              onClick={submitReview}
            >
              {reviewMutation.isPending ? "Menyimpan..." : (reviewAction ? actionLabels[reviewAction] : "Simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
