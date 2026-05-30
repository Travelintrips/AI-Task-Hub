import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Square, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStoredToken } from "@/lib/auth-api";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, init?: RequestInit) {
  const token = getStoredToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

interface ChecklistItem {
  id: number;
  itemName: string;
  isDone: boolean;
  doneAt: string | null;
  doneBy: string | null;
  notes: string | null;
  sortOrder: number;
}

interface Props {
  taskId: number;
  taskType?: string;
  category?: string | null;
}

export function OperationalChecklist({ taskId, taskType = "ai_task", category }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newItem, setNewItem] = useState("");

  const qKey = ["checklists", taskType, taskId];

  const { data: items = [], isLoading } = useQuery<ChecklistItem[]>({
    queryKey: qKey,
    queryFn: () => apiFetch(`/checklists/${taskType}/${taskId}`),
  });

  const initMut = useMutation({
    mutationFn: () => apiFetch(`/checklists/${taskType}/${taskId}/init`, { method: "POST", body: JSON.stringify({ category }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isDone }: { id: number; isDone: boolean }) => apiFetch(`/checklists/${id}`, { method: "PATCH", body: JSON.stringify({ isDone }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  const addMut = useMutation({
    mutationFn: (itemName: string) => apiFetch(`/checklists/${taskType}/${taskId}/items`, { method: "POST", body: JSON.stringify({ itemName }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setNewItem(""); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/checklists/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  const doneCount = items.filter((i) => i.isDone).length;
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><CheckSquare className="h-4 w-4 text-primary" />Checklist Operasional</CardTitle>
          {items.length === 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => initMut.mutate()} disabled={initMut.isPending}>
              {initMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Inisialisasi Template"}
            </Button>
          )}
        </div>
        {items.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{doneCount}/{items.length} selesai</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">Belum ada checklist. Klik "Inisialisasi Template" untuk memulai.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className={`flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 group transition-colors ${item.isDone ? "opacity-60" : ""}`}>
              <button
                className="shrink-0 focus:outline-none"
                onClick={() => toggleMut.mutate({ id: item.id, isDone: !item.isDone })}
                disabled={toggleMut.isPending}
              >
                {item.isDone
                  ? <CheckSquare className="h-4 w-4 text-primary" />
                  : <Square className="h-4 w-4 text-muted-foreground" />}
              </button>
              <span className={`flex-1 text-sm ${item.isDone ? "line-through text-muted-foreground" : ""}`}>{item.itemName}</span>
              {item.isDone && item.doneBy && <span className="text-xs text-muted-foreground hidden group-hover:block">{item.doneBy}</span>}
              <button className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => deleteMut.mutate(item.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive/60 hover:text-destructive" />
              </button>
            </div>
          ))
        )}
        <div className="flex gap-2 mt-3 pt-2 border-t">
          <Input className="h-7 text-xs" placeholder="Tambah item baru..." value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newItem.trim() && addMut.mutate(newItem.trim())} />
          <Button size="sm" className="h-7 text-xs px-2" variant="outline" onClick={() => newItem.trim() && addMut.mutate(newItem.trim())} disabled={!newItem.trim() || addMut.isPending}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
