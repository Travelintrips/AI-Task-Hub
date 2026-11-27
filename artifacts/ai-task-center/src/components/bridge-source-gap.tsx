import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export type SourceSyncGap = {
  status: "AVAILABLE" | "UNAVAILABLE";
  lookbackDays: number;
  total: number | null;
  rows: Array<{commandId:string;sourceStatus:string;createdAt:string;category:string;sourceAckRecorded:boolean}>;
};
const labels:Record<string,string> = {
  HANDSHAKE:"Handshake — perlu tinjauan",
  PROTECTED_WAKE:"Wake terlindungi",
  PASSIVE_EVENT:"Event pasif",
  OTHER_COMMAND:"Command sumber lainnya",
};
const date=(value:string) => new Intl.DateTimeFormat("id-ID",{timeZone:"Asia/Jakarta",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value))+" WIB";
export function BridgeSourceGap({gap,detail=false}:{gap?:SourceSyncGap;detail?:boolean}) {
  if (!gap) return null;
  if (gap.status!=="AVAILABLE" || gap.total===null) return <p role="alert" className="text-sm text-amber-700">Cakupan sinkronisasi AI Core belum dapat diperiksa; jumlah record yang hilang belum diketahui.</p>;
  if (!detail) return <div className="rounded-md border p-3 text-sm">
    <strong>{gap.total} record sumber belum masuk Job Registry</strong>
    <span className="ml-2 text-xs text-muted-foreground">14 hari terakhir · observasi terpisah, bukan antrean atau ACK baru.</span>
    <Link href="/bridge-jobs#source-gap" className="ml-2 text-blue-700 hover:underline">Lihat cakupan sinkronisasi</Link>
  </div>;
  return <Card id="source-gap" data-testid="bridge-source-gap">
    <CardHeader>
      <CardTitle className="text-base">Cakupan sinkronisasi AI Core</CardTitle>
      <p className="text-sm text-muted-foreground">{gap.total} record sumber belum masuk registry dalam {gap.lookbackDays} hari terakhir. Ini pembacaan langsung dari AI Core, bukan penambahan job atau bukti penyelesaian. Tidak ada retry maupun ACK otomatis dari panel ini.</p>
    </CardHeader>
    <CardContent className="overflow-x-auto">
      {gap.total===0 ? <p className="text-sm text-muted-foreground">Tidak ada record sumber yang belum tercermin pada rentang ini.</p> :
      <table className="w-full text-sm text-left">
        <thead className="border-b text-muted-foreground"><tr><th className="py-2 pr-4">ID sumber</th><th className="py-2 pr-4">Kategori</th><th className="py-2 pr-4">Status sumber</th><th className="py-2 pr-4">ACK sumber</th><th className="py-2">Waktu</th></tr></thead>
        <tbody>{gap.rows.map(row=><tr className="border-b" key={row.commandId}><td className="py-2 pr-4 font-mono text-xs" title={row.commandId}>{row.commandId.slice(0,8)}</td><td className="py-2 pr-4">{labels[row.category]??"Lainnya"}</td><td className="py-2 pr-4">{row.sourceStatus} (sumber)</td><td className="py-2 pr-4">{row.sourceAckRecorded?"Tercatat di sumber":"Belum tercatat"}</td><td className="py-2 whitespace-nowrap">{date(row.createdAt)}</td></tr>)}</tbody>
      </table>}
      {gap.rows.length<gap.total && <p className="text-xs text-muted-foreground mt-2">Menampilkan {gap.rows.length} dari {gap.total} record.</p>}
    </CardContent>
  </Card>;
}
