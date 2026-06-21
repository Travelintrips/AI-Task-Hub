import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { getStoredToken } from "@/lib/auth-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, RefreshCw, Search, AlertTriangle, ExternalLink } from "lucide-react";

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

type ExpiringDoc = {
  id: number;
  fleetUnitId: number;
  docType: string;
  docTypeLabel: string;
  docNumber?: string;
  expiredDate?: string;
  daysLeft?: number | null;
  status: string;
  issuingAuthority?: string;
  plateNumber?: string;
  unitNumber?: string;
};

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  active:        { cls: "bg-green-100 text-green-800 border-green-300",  label: "Aktif" },
  expiring_soon: { cls: "bg-yellow-100 text-yellow-800 border-yellow-300", label: "Akan Expired" },
  expired:       { cls: "bg-red-100 text-red-800 border-red-300",       label: "EXPIRED" },
};

export default function FleetDocuments() {
  const [daysFilter, setDaysFilter] = useState("30");
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-docs-expiring", daysFilter],
    queryFn: () => apiFetch(`/fleet/documents/expiring?days=${daysFilter}`),
    refetchInterval: 60000,
  });

  const docs: ExpiringDoc[] = (data?.data ?? []).filter((d: ExpiringDoc) => {
    if (docTypeFilter !== "all" && d.docType !== docTypeFilter) return false;
    if (search && !d.plateNumber?.toLowerCase().includes(search.toLowerCase()) && !d.unitNumber?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const expired = docs.filter(d => d.status === "expired").length;
  const expiringSoon = docs.filter(d => d.status === "expiring_soon").length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Dokumen Kendaraan</h1>
          {expired > 0 && (
            <Badge className="bg-red-100 text-red-800 border-red-300 border">
              <AlertTriangle className="h-3 w-3 mr-1" />{expired} Expired
            </Badge>
          )}
          {expiringSoon > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border">
              <AlertTriangle className="h-3 w-3 mr-1" />{expiringSoon} Akan Expired
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        Halaman ini menampilkan dokumen yang akan atau sudah expired. Untuk upload dokumen baru, buka halaman <Link href="/fleet/units" className="font-medium underline">Detail Kendaraan</Link>.
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm" placeholder="Cari plat / unit..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={daysFilter} onValueChange={setDaysFilter}>
          <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Expired dalam 7 hari</SelectItem>
            <SelectItem value="14">Expired dalam 14 hari</SelectItem>
            <SelectItem value="30">Expired dalam 30 hari</SelectItem>
            <SelectItem value="60">Expired dalam 60 hari</SelectItem>
            <SelectItem value="90">Expired dalam 90 hari</SelectItem>
          </SelectContent>
        </Select>
        <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Tipe</SelectItem>
            <SelectItem value="stnk">STNK</SelectItem>
            <SelectItem value="kir">KIR</SelectItem>
            <SelectItem value="insurance">Asuransi</SelectItem>
            <SelectItem value="tax">Pajak</SelectItem>
            <SelectItem value="mutation">Mutasi</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kendaraan</TableHead>
                <TableHead>Tipe Dokumen</TableHead>
                <TableHead>Nomor Dokumen</TableHead>
                <TableHead>Tanggal Expired</TableHead>
                <TableHead>Sisa Hari</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Penerbit</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Memuat data...</TableCell></TableRow>
              ) : docs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileText className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Tidak ada dokumen yang akan expired dalam {daysFilter} hari ke depan</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : docs.map(doc => {
                const cfg = STATUS_CFG[doc.status] ?? STATUS_CFG.active;
                const daysLeft = doc.daysLeft;
                const daysClass = daysLeft === null ? "" : daysLeft < 0 ? "text-red-600 font-bold" : daysLeft <= 7 ? "text-red-500 font-medium" : daysLeft <= 14 ? "text-orange-500" : "text-yellow-600";
                return (
                  <TableRow key={doc.id} className={`hover:bg-muted/30 ${doc.status === "expired" ? "bg-red-50/40" : doc.status === "expiring_soon" ? "bg-yellow-50/40" : ""}`}>
                    <TableCell>
                      <div className="font-medium text-sm">{doc.plateNumber ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{doc.unitNumber ?? ""}</div>
                    </TableCell>
                    <TableCell className="font-medium text-sm">{doc.docTypeLabel}</TableCell>
                    <TableCell className="text-sm font-mono">{doc.docNumber ?? "—"}</TableCell>
                    <TableCell className="text-sm">{doc.expiredDate ?? "—"}</TableCell>
                    <TableCell className={`text-sm ${daysClass}`}>
                      {daysLeft === null ? "—" : daysLeft < 0 ? `${Math.abs(daysLeft)} hari lalu` : daysLeft === 0 ? "HARI INI" : `${daysLeft} hari`}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${cfg.cls} border text-xs font-medium`}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{doc.issuingAuthority ?? "—"}</TableCell>
                    <TableCell>
                      <Link href={`/fleet/units/${doc.fleetUnitId}`}>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                          <ExternalLink className="h-3 w-3 mr-1" />Detail
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
