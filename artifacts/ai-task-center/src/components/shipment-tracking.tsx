import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ship, Plus, MapPin, Calendar, Anchor, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getStoredToken } from "@/lib/auth-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { id } from "date-fns/locale";

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

interface ShipmentTracking {
  id: number;
  trackingType: string;
  trackingNumber: string | null;
  carrierName: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  etd: string | null;
  eta: string | null;
  currentStatus: string | null;
  currentLocation: string | null;
}

interface ShipmentEvent {
  id: number;
  eventTime: string;
  eventCode: string | null;
  eventDescription: string;
  location: string | null;
}

const emptyTrackingForm = { trackingType: "container", trackingNumber: "", carrierName: "", vesselName: "", voyageNumber: "", portOfLoading: "", portOfDischarge: "", etd: "", eta: "" };
const emptyEventForm = { eventDescription: "", location: "", eventTime: "" };

export function ShipmentTrackingPanel({ taskId }: { taskId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [selectedTrackingId, setSelectedTrackingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyTrackingForm);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [showEvents, setShowEvents] = useState(false);

  const qKey = ["shipments", taskId];
  const { data, isLoading } = useQuery<{ trackings: ShipmentTracking[]; events: ShipmentEvent[] }>({
    queryKey: qKey,
    queryFn: () => apiFetch(`/shipments/${taskId}`),
  });

  const addTracking = useMutation({
    mutationFn: (data: typeof emptyTrackingForm) => apiFetch("/shipments", { method: "POST", body: JSON.stringify({ ...data, taskId }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setShowDialog(false); toast({ title: "Tracking ditambahkan" }); },
  });

  const addEvent = useMutation({
    mutationFn: (data: typeof emptyEventForm) => apiFetch(`/shipments/${selectedTrackingId}/events`, { method: "POST", body: JSON.stringify({ ...data, taskId }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setShowEventDialog(false); toast({ title: "Event ditambahkan" }); },
  });

  const f = (k: keyof typeof emptyTrackingForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const ef = (k: keyof typeof emptyEventForm) => (e: React.ChangeEvent<HTMLInputElement>) => setEventForm((p) => ({ ...p, [k]: e.target.value }));

  const trackings = data?.trackings ?? [];
  const events = data?.events ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Ship className="h-4 w-4 text-primary" />Shipment Tracking</CardTitle>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setForm(emptyTrackingForm); setShowDialog(true); }}>
            <Plus className="h-3 w-3 mr-1" />Tambah Tracking
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {isLoading ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        : trackings.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">Belum ada data tracking. Tambahkan nomor container/AWB untuk mulai tracking.</p>
        ) : trackings.map((tr) => (
          <div key={tr.id} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                {tr.trackingNumber && <p className="font-mono font-semibold text-sm">{tr.trackingNumber}</p>}
                <p className="text-xs text-muted-foreground capitalize">{tr.trackingType}{tr.carrierName ? ` — ${tr.carrierName}` : ""}</p>
              </div>
              {tr.currentStatus && <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">{tr.currentStatus}</span>}
            </div>
            {(tr.portOfLoading || tr.portOfDischarge) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Anchor className="h-3 w-3" />
                <span>{tr.portOfLoading ?? "—"} → {tr.portOfDischarge ?? "—"}</span>
              </div>
            )}
            {tr.vesselName && <p className="text-xs text-muted-foreground"><Ship className="inline h-3 w-3 mr-1" />{tr.vesselName}{tr.voyageNumber ? ` / ${tr.voyageNumber}` : ""}</p>}
            <div className="flex gap-4 text-xs text-muted-foreground">
              {tr.etd && <span><Calendar className="inline h-3 w-3 mr-1" />ETD: {format(new Date(tr.etd), "dd MMM yyyy", { locale: id })}</span>}
              {tr.eta && <span><MapPin className="inline h-3 w-3 mr-1" />ETA: {format(new Date(tr.eta), "dd MMM yyyy", { locale: id })}</span>}
            </div>
            <Button size="sm" variant="ghost" className="h-6 text-xs p-0 text-primary" onClick={() => { setSelectedTrackingId(tr.id); setEventForm({ ...emptyEventForm, eventTime: new Date().toISOString().slice(0, 16) }); setShowEventDialog(true); }}>
              <Plus className="h-3 w-3 mr-1" />Tambah Event
            </Button>
          </div>
        ))}

        {events.length > 0 && (
          <div>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1" onClick={() => setShowEvents((p) => !p)}>
              {showEvents ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Timeline ({events.length} event)
            </button>
            {showEvents && (
              <div className="mt-2 space-y-2 pl-3 border-l-2 border-primary/20">
                {events.map((ev) => (
                  <div key={ev.id} className="relative">
                    <div className="absolute -left-[17px] top-1 h-2.5 w-2.5 rounded-full bg-primary/60 border-2 border-white" />
                    <p className="text-xs font-medium">{ev.eventDescription}</p>
                    {ev.location && <p className="text-xs text-muted-foreground"><MapPin className="inline h-3 w-3 mr-0.5" />{ev.location}</p>}
                    <p className="text-xs text-muted-foreground">{format(new Date(ev.eventTime), "dd MMM yyyy HH:mm", { locale: id })}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={showDialog} onOpenChange={(v) => !v && setShowDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Tambah Tracking Baru</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>No. Container / AWB</Label><Input className="mt-1" placeholder="CAIU1234567" value={form.trackingNumber} onChange={f("trackingNumber")} /></div>
            <div><Label>Carrier</Label><Input className="mt-1" placeholder="MSC, Maersk..." value={form.carrierName} onChange={f("carrierName")} /></div>
            <div><Label>Nama Kapal</Label><Input className="mt-1" value={form.vesselName} onChange={f("vesselName")} /></div>
            <div><Label>Port Muat</Label><Input className="mt-1" placeholder="CNSHA" value={form.portOfLoading} onChange={f("portOfLoading")} /></div>
            <div><Label>Port Bongkar</Label><Input className="mt-1" placeholder="IDJKT" value={form.portOfDischarge} onChange={f("portOfDischarge")} /></div>
            <div><Label>ETD</Label><Input className="mt-1" type="date" value={form.etd} onChange={f("etd")} /></div>
            <div><Label>ETA</Label><Input className="mt-1" type="date" value={form.eta} onChange={f("eta")} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
            <Button onClick={() => addTracking.mutate(form)} disabled={addTracking.isPending}>Tambah</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEventDialog} onOpenChange={(v) => !v && setShowEventDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Tambah Event Tracking</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Deskripsi Event *</Label><Input className="mt-1" placeholder="Container Loaded at Port" value={eventForm.eventDescription} onChange={ef("eventDescription")} /></div>
            <div><Label>Lokasi</Label><Input className="mt-1" placeholder="Port Shanghai" value={eventForm.location} onChange={ef("location")} /></div>
            <div><Label>Waktu</Label><Input className="mt-1" type="datetime-local" value={eventForm.eventTime} onChange={ef("eventTime")} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEventDialog(false)}>Batal</Button>
            <Button onClick={() => addEvent.mutate(eventForm)} disabled={!eventForm.eventDescription || addEvent.isPending}>Tambah</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
