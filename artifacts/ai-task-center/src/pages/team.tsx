import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerEvents } from "@/hooks/use-server-events";
import {
  useListTeamMembers, getListTeamMembersQueryKey,
  useCreateTeamMember,
  useUpdateTeamMember,
  useDeleteTeamMember
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Phone, Mail, Trash2, UserPlus, Building2, Pencil, PhoneOff } from "lucide-react";

// ─── Daftar Divisi (sesuai CATEGORY_DIVISION_MAP di dispatcher) ───────────────
const DIVISIONS = [
  { value: "PPJK",             label: "PPJK",                        color: "bg-purple-100 text-purple-800" },
  { value: "Customs",          label: "Customs / Bea Cukai",         color: "bg-orange-100 text-orange-800" },
  { value: "Import",           label: "Import",                      color: "bg-blue-100 text-blue-800"   },
  { value: "CS Import",        label: "CS Import",                   color: "bg-sky-100 text-sky-800"     },
  { value: "Export",           label: "Export",                      color: "bg-green-100 text-green-800" },
  { value: "CS Export",        label: "CS Export",                   color: "bg-emerald-100 text-emerald-800" },
  { value: "Trucking",         label: "Trucking",                    color: "bg-yellow-100 text-yellow-800" },
  { value: "Driver",           label: "Driver",                      color: "bg-amber-100 text-amber-800" },
  { value: "Air Freight",      label: "Air Freight",                 color: "bg-indigo-100 text-indigo-800" },
  { value: "Forwarding",       label: "Forwarding",                  color: "bg-teal-100 text-teal-800"   },
  { value: "Freight",          label: "Freight",                     color: "bg-cyan-100 text-cyan-800"   },
  { value: "Operasional",      label: "Operasional",                 color: "bg-slate-100 text-slate-800" },
  { value: "CS",               label: "Customer Service",            color: "bg-pink-100 text-pink-800"   },
  { value: "Finance",          label: "Finance",                     color: "bg-rose-100 text-rose-800"   },
] as const;

// ─── Daftar Role / Jabatan ────────────────────────────────────────────────────
const ROLES = [
  "Operations Specialist",
  "Customs Clearance Officer",
  "PPJK Officer",
  "Import Coordinator",
  "Export Coordinator",
  "Trucking Coordinator",
  "Air Freight Coordinator",
  "Freight Forwarder",
  "Customer Service",
  "Finance Officer",
  "Driver",
  "General Staff",
  "Supervisor",
  "Manager",
] as const;

const memberSchema = z.object({
  name:     z.string().min(1, "Nama wajib diisi"),
  role:     z.string().min(1, "Jabatan wajib dipilih"),
  division: z.string().min(1, "Divisi wajib dipilih"),
  phone:    z.string().optional(),
  email:    z.string().email("Email tidak valid").optional().or(z.literal("")),
});

type MemberFormValues = z.infer<typeof memberSchema>;

function getDivisionStyle(division: string | null): string {
  return DIVISIONS.find(d => d.value === division)?.color ?? "bg-gray-100 text-gray-700";
}

// ─── Shared form fields ────────────────────────────────────────────────────────
function MemberFormFields({ form }: { form: ReturnType<typeof useForm<MemberFormValues>> }) {
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nama</FormLabel>
            <FormControl>
              <Input placeholder="contoh: Budi Santoso" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="division"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Divisi</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih divisi..." />
                </SelectTrigger>
              </FormControl>
              <SelectContent className="max-h-60 overflow-y-auto">
                {DIVISIONS.map(d => (
                  <SelectItem key={d.value} value={d.value}>
                    <span className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {d.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Divisi menentukan jenis task yang diterima dari AI Dispatcher
            </p>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="role"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Jabatan</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih jabatan..." />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {ROLES.map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input placeholder="budi@perusahaan.com" type="email" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>No. HP (WhatsApp)</FormLabel>
            <FormControl>
              <Input placeholder="08123456789" {...field} />
            </FormControl>
            <p className="text-xs text-muted-foreground">
              Digunakan untuk notifikasi WA saat task baru di-assign
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

export default function Team() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useServerEvents({
    team_updated: () => { void queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() }); },
  });

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);

  const { data: members, isLoading } = useListTeamMembers({
    query: { queryKey: getListTeamMembersQueryKey() }
  });

  const createMember = useCreateTeamMember();
  const updateMember = useUpdateTeamMember();
  const deleteMember = useDeleteTeamMember();

  // ─── Create form ────────────────────────────────────────────────────────────
  const createForm = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: { name: "", role: "", division: "", phone: "", email: "" },
  });

  // ─── Edit form ──────────────────────────────────────────────────────────────
  const editForm = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: { name: "", role: "", division: "", phone: "", email: "" },
  });

  const onCreateSubmit = (values: MemberFormValues) => {
    createMember.mutate(
      { data: values as any },
      {
        onSuccess: () => {
          toast({ title: "Anggota tim berhasil ditambahkan" });
          queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
          setIsCreateOpen(false);
          createForm.reset();
        },
        onError: () => toast({ title: "Gagal menambahkan anggota tim", variant: "destructive" }),
      }
    );
  };

  const onEditSubmit = (values: MemberFormValues) => {
    if (editingMemberId === null) return;
    updateMember.mutate(
      { id: editingMemberId, data: values as any },
      {
        onSuccess: () => {
          toast({ title: "Data anggota tim berhasil diperbarui" });
          queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
          setEditingMemberId(null);
          editForm.reset();
        },
        onError: () => toast({ title: "Gagal memperbarui data anggota tim", variant: "destructive" }),
      }
    );
  };

  const handleEditOpen = (member: NonNullable<typeof members>[number]) => {
    editForm.reset({
      name:     member.name,
      role:     member.role ?? "",
      division: member.division ?? "",
      phone:    member.phone ?? "",
      email:    member.email ?? "",
    });
    setEditingMemberId(member.id);
  };

  const handleDelete = (id: number) => {
    if (confirm("Hapus anggota tim ini?")) {
      deleteMember.mutate(
        { id },
        {
          onSuccess: () => {
            toast({ title: "Anggota tim dihapus" });
            queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
          },
          onError: () => toast({ title: "Gagal menghapus anggota tim", variant: "destructive" }),
        }
      );
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team Members</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Anggota tim yang dapat menerima assignment dari AI Dispatcher
          </p>
        </div>

        {/* ─── Dialog Tambah Anggota ─── */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-member" className="gap-2">
              <UserPlus className="h-4 w-4" />
              Tambah Anggota
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Tambah Anggota Tim</DialogTitle>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                <MemberFormFields form={createForm} />
                <Button type="submit" className="w-full" disabled={createMember.isPending}>
                  {createMember.isPending ? "Menyimpan..." : "Tambah Anggota"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* ─── Dialog Edit Anggota ─── */}
      <Dialog open={editingMemberId !== null} onOpenChange={(open) => { if (!open) setEditingMemberId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Anggota Tim</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <MemberFormFields form={editForm} />
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditingMemberId(null)}>
                  Batal
                </Button>
                <Button type="submit" className="flex-1" disabled={updateMember.isPending}>
                  {updateMember.isPending ? "Menyimpan..." : "Simpan Perubahan"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Grid Kartu Anggota */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : members?.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <p className="font-medium text-foreground/70">Belum ada anggota tim</p>
            <p className="text-sm mt-1">Tambahkan supervisor atau staff agar AI dapat mengassign task secara otomatis.</p>
            <p className="text-xs mt-2">Klik <strong>"Tambah Anggota"</strong> di pojok kanan atas untuk mulai.</p>
          </div>
        ) : (
          members?.map((member) => (
            <Card key={member.id} data-testid={`card-member-${member.id}`} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-11 w-11 border">
                      <AvatarImage src={member.avatarUrl || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                        {member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold leading-none">{member.name}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">{member.role}</p>
                    </div>
                  </div>

                  {/* Tombol Edit & Hapus */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                      onClick={() => handleEditOpen(member)}
                      title="Edit anggota"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(member.id)}
                      title="Hapus anggota"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Badge Divisi + warning No HP */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {member.division && (
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${getDivisionStyle(member.division)}`}>
                      <Building2 className="h-3 w-3" />
                      {DIVISIONS.find(d => d.value === member.division)?.label ?? member.division}
                    </span>
                  )}
                  {!member.phone && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                      <PhoneOff className="h-3 w-3" />
                      No HP — WA nonaktif
                    </span>
                  )}
                </div>

                {/* Kontak */}
                <div className="mt-4 space-y-1.5 text-sm">
                  {member.email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{member.email}</span>
                    </div>
                  )}
                  {member.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
