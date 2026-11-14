import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { ChevronDown, ChevronRight, HardDrive, RefreshCw, ShieldAlert } from "lucide-react";

type Item = { id: string; name: string; sizeDisplay: string; created?: string; protected: boolean; reason: string };
type Category = { id: string; title: string; items: Item[] };
type Inventory = { generatedAt: string; categories: Category[]; readOnly: boolean };

export default function VpsStoragePage() {
  const { token, user } = useAuth();
  const [data, setData] = useState<Inventory | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["docker-images"]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/system/vps-storage", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Inventaris VPS belum tersedia (HTTP ${response.status})`);
      const json = await response.json() as Inventory;
      setData(json);
      setSelected([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal membaca inventaris"); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (user?.role === "super_admin") void refresh(); }, [user?.role, token]);
  if (user?.role !== "super_admin") return <div role="alert" className="p-6 text-foreground">Hanya Super Admin yang dapat melihat inventaris VPS.</div>;
  return <div className="p-6 space-y-5 text-foreground">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold flex items-center gap-2"><HardDrive/> Penyimpanan VPS</h1><p className="text-sm text-slate-400">Inventaris detail, dengan proteksi image aktif dan rollback</p></div><button onClick={() => void refresh()} disabled={loading} className="rounded bg-blue-600 px-3 py-2 text-sm flex items-center gap-2"><RefreshCw size={16}/>{loading ? "Memuat" : "Perbarui"}</button></div>
    <div className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm flex gap-2"><ShieldAlert size={18}/> Mode aman: pemilihan tidak menghapus data. Eksekusi penghapusan dinonaktifkan sampai verifikasi backend dan audit tersedia.</div>
    {error && <div role="alert" className="rounded border border-red-700 p-3 text-red-300">{error}</div>}
    {data && <><p className="text-xs text-slate-400">Pembaruan: {new Date(data.generatedAt).toLocaleString("id-ID")}</p>{data.categories.map(group => <section key={group.id} className="rounded-lg border border-slate-700 overflow-hidden"><button className="w-full p-4 flex justify-between items-center bg-slate-800" onClick={() => setExpanded(v => v.includes(group.id) ? v.filter(x => x !== group.id) : [...v, group.id])}><strong>{group.title} ({group.items.length})</strong>{expanded.includes(group.id) ? <ChevronDown/> : <ChevronRight/>}</button>{expanded.includes(group.id) && <div className="divide-y divide-slate-800">{group.items.map(item => <label key={item.id + item.name} className="flex items-start gap-3 p-3 hover:bg-slate-800/40"><input type="checkbox" className="mt-1" disabled={item.protected} checked={selected.includes(item.id + item.name)} onChange={e => setSelected(v => e.target.checked ? [...v, item.id + item.name] : v.filter(x => x !== item.id + item.name))}/><div className="flex-1 min-w-0"><div className="break-all text-sm">{item.name}</div><div className="text-xs text-slate-400">{item.reason}{item.created ? ` · ${item.created}` : ""}</div></div><div className="shrink-0 text-sm font-medium">{item.sizeDisplay}</div></label>)}</div>}</section>)}<div className="flex justify-between items-center rounded border border-slate-700 p-4"><span>{selected.length} item dipilih</span><button disabled className="rounded bg-slate-700 px-4 py-2 text-sm cursor-not-allowed">Hapus terpilih (menunggu verifikasi)</button></div></>}
  </div>;
}
