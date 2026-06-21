import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/auth-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, AlertTriangle, TrendingUp } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, opts?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  active:    { cls: "bg-green-100 text-green-800", label: "Aktif" },
  off:       { cls: "bg-gray-100 text-gray-600",   label: "Cuti/Libur" },
  suspended: { cls: "bg-red-100 text-red-800",     label: "Ditangguhkan" },
  resigned:  { cls: "bg-gray-200 text-gray-500",   label: "Keluar" },
};

const INCIDENT_CFG: Record<string, { cls: string; label: string }> = {
  open:     { cls: "bg-red-100 text-red-800",    label: "Terbuka" },
  closed:   { cls: "bg-green-100 text-green-800", label: "Ditutup" },
  resolved: { cls: "bg-blue-100 text-blue-800",  label: "Diselesaikan" },
};

export default function FleetDriverDetail() {
  const [, params] = useRoute("/fleet/drivers/:id");
  const id = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: driver, isLoading } = useQuery({
    queryKey: ["fleet-driver", id],
    queryFn: () => apiFetch(`/fleet/drivers/${id}`),
    enabled: !!id,
  });

  const { data: perfData } = useQuery({
    queryKey: ["fleet-driver-perf", id],
    queryFn: () => apiFetch(`/fleet/drivers/${id}/performance`),
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiFetch(`/fleet/drivers/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => { toast({ title: "Status diperbarui" }); queryClient.invalidateQueries({ queryKey: ["fleet-driver", id] }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Memuat...</div>;
  if (!driver) return <div className="p-6 text-muted-foreground">Pengemudi tidak ditemukan.</div>;

  const statusCfg = STATUS_CFG[driver.status] ?? STATUS_CFG.active;
  const now = new Date();
  const licDays = driver.licenseExpired
    ? Math.ceil((new Date(driver.licenseExpired).getTime() - now.getTime()) / 86400000)
    : null;
  const licClass = licDays === null ? "" : licDays < 0 ? "text-red-600" : licDays <= 30 ? "text-yellow-600" : "text-green-600";

  const perf = perfData?.data ?? [];
  const latestPerf = perf[0];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/fleet/drivers"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Kembali</Button></Link>
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">{driver.fullName}</h1>
        <Badge className={`${statusCfg.cls} text-xs`}>{statusCfg.label}</Badge>
        {licDays !== null && licDays <= 30 && (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />SIM {licDays < 0 ? "EXPIRED" : `expired ${licDays}h lagi`}
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          {(["active", "off", "suspended"] as const).filter(s => s !== driver.status).map(s => (
            <Button key={s} variant="outline" size="sm" onClick={() => statusMutation.mutate(s)}>
              Set {STATUS_CFG[s]?.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "ID Karyawan",     value: driver.employeeId ?? "—" },
          { label: "No. HP",           value: driver.phone ?? "—" },
          { label: "Email",            value: driver.email ?? "—" },
          { label: "Tipe SIM",         value: driver.licenseType ?? "—" },
          { label: "Nomor SIM",        value: driver.licenseNumber },
          { label: "Expired SIM",      value: driver.licenseExpired ?? "—", cls: licClass },
          { label: "Tanggal Bergabung", value: driver.joinDate ?? "—" },
          { label: "Lokasi Asal",      value: driver.baseLocation ?? "—" },
          { label: "Kendaraan",        value: driver.vehiclePlate ? `${driver.vehiclePlate} (${driver.vehicleUnit})` : "—" },
          { label: "Kontak Darurat",   value: driver.emergencyContact ? `${driver.emergencyContact} — ${driver.emergencyPhone ?? ""}` : "—" },
        ].map(({ label, value, cls }) => (
          <Card key={label} className="p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`text-sm font-medium mt-0.5 ${cls ?? ""}`}>{String(value)}</div>
          </Card>
        ))}
      </div>

      {latestPerf && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><TrendingUp className="h-4 w-4" />Performa Terakhir — {latestPerf.periodMonth}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
              {[
                { label: "Skor", value: latestPerf.performanceScore != null ? `${Number(latestPerf.performanceScore).toFixed(1)}` : "—" },
                { label: "Total Trip", value: latestPerf.totalTrips ?? "—" },
                { label: "Total KM", value: latestPerf.totalKm ? `${Number(latestPerf.totalKm).toLocaleString("id-ID")} km` : "—" },
                { label: "Tepat Waktu", value: latestPerf.onTimeDeliveries ?? "—" },
                { label: "Terlambat", value: latestPerf.lateDeliveries ?? "—" },
                { label: "BBM (L)", value: latestPerf.fuelConsumedLtr != null ? Number(latestPerf.fuelConsumedLtr).toFixed(1) : "—" },
                { label: "Insiden", value: latestPerf.incidents ?? "—" },
                { label: "Keluhan", value: latestPerf.customerComplaints ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} className="text-center p-2 bg-muted/30 rounded">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-sm font-bold">{String(value)}</div>
                </div>
              ))}
            </div>
            {latestPerf.aiNotes && <p className="text-xs text-muted-foreground mt-3 italic">{latestPerf.aiNotes}</p>}
          </CardContent>
        </Card>
      )}

      {/* Insiden */}
      {(driver.recentIncidents ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" />Insiden Terbaru</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Tanggal</TableHead><TableHead>Tipe</TableHead><TableHead>Deskripsi</TableHead>
                <TableHead>Severity</TableHead><TableHead>Kerugian</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(driver.recentIncidents ?? []).map((inc: { id: number; incidentDate: string; incidentType: string; description: string; severity: string; estimatedDamage?: number; status: string }) => {
                  const cfg = INCIDENT_CFG[inc.status] ?? INCIDENT_CFG.open;
                  return (
                    <TableRow key={inc.id}>
                      <TableCell className="text-sm">{inc.incidentDate}</TableCell>
                      <TableCell className="text-sm capitalize">{inc.incidentType.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-sm max-w-48 truncate">{inc.description}</TableCell>
                      <TableCell><Badge className={`text-xs ${inc.severity === "high" ? "bg-red-100 text-red-800" : inc.severity === "medium" ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-600"}`}>{inc.severity}</Badge></TableCell>
                      <TableCell className="text-sm">{inc.estimatedDamage ? `Rp ${Number(inc.estimatedDamage).toLocaleString("id-ID")}` : "—"}</TableCell>
                      <TableCell><Badge className={`${cfg.cls} text-xs`}>{cfg.label}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
