import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, HardDrive, RefreshCw, ShieldAlert } from "lucide-react";
import { useGetVpsStorageInventory, getGetVpsStorageInventoryQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { isVpsStorageDevHost } from "@/lib/vps-storage-dev-host";
import NotFound from "@/pages/not-found";

export default function VpsStoragePage() {
  const { user } = useAuth();
  const allowed = isVpsStorageDevHost() && user?.role === "super_admin";
  // The generated client reuses the AuthProvider's trusted token getter.
  const { data, error, isFetching, refetch } = useGetVpsStorageInventory({
    query: { queryKey: getGetVpsStorageInventoryQueryKey(), enabled: allowed, retry: false, staleTime: 30_000 },
  });
  const [expanded, setExpanded] = useState<string[]>(["docker-images"]);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setSelected([]); }, [data]);

  if (!allowed) return <NotFound />;

  return <div className="p-6 space-y-5 text-foreground">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><HardDrive /> Penyimpanan VPS</h1>
        <p className="text-sm text-muted-foreground">Inventaris detail, dengan proteksi image aktif dan rollback</p>
      </div>
      <button onClick={() => { void refetch(); }} disabled={isFetching}
        className="rounded bg-blue-600 px-3 py-2 text-sm text-white flex items-center gap-2">
        <RefreshCw size={16} />{isFetching ? "Memuat" : "Perbarui"}
      </button>
    </div>
    <div className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm flex gap-2">
      <ShieldAlert size={18} /> Mode aman: pemilihan tidak menghapus data.
      Eksekusi penghapusan dinonaktifkan sampai verifikasi backend dan audit tersedia.
    </div>
    {error && <div role="alert" className="rounded border border-red-700 p-3">
      Inventaris read-only DEV belum dapat diakses. Periksa kesiapan file host dan feature flag.
    </div>}
    {data && <>
      <p className="text-xs text-muted-foreground">
        Pembaruan: {new Date(data.generatedAt).toLocaleString("id-ID")}
      </p>
      {data.categories.map(group => <section key={group.id}
        className="rounded-lg border border-border overflow-hidden">
        <button className="w-full p-4 flex justify-between items-center bg-muted"
          onClick={() => setExpanded(v => v.includes(group.id) ? v.filter(x => x !== group.id) : [...v, group.id])}>
          <strong>{group.title} ({group.items.length})</strong>
          {expanded.includes(group.id) ? <ChevronDown /> : <ChevronRight />}
        </button>
        {expanded.includes(group.id) && <div className="divide-y divide-border">
          {group.items.map(item => <label key={item.id + item.name}
            className="flex items-start gap-3 p-3 hover:bg-muted/40">
            <input type="checkbox" className="mt-1" disabled={item.protected}
              checked={selected.includes(item.id + item.name)}
              onChange={e => setSelected(v => e.target.checked
                ? [...v, item.id + item.name]
                : v.filter(x => x !== item.id + item.name))} />
            <div className="flex-1 min-w-0">
              <div className="break-all text-sm">{item.name}</div>
              <div className="text-xs text-muted-foreground">
                {item.reason}{item.created ? " · " + item.created : ""}
              </div>
            </div>
            <div className="shrink-0 text-sm font-medium">{item.sizeDisplay}</div>
          </label>)}
        </div>}
      </section>)}
      <div className="flex justify-between items-center rounded border border-border p-4">
        <span>{selected.length} item dipilih</span>
        <button disabled className="rounded bg-muted px-4 py-2 text-sm cursor-not-allowed">
          Hapus terpilih (menunggu verifikasi)
        </button>
      </div>
    </>}
  </div>;
}
