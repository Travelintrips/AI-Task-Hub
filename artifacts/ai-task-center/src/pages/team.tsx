import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerEvents } from "@/hooks/use-server-events";
import {
  useListTeamMembers, getListTeamMembersQueryKey,
  useCreateTeamMember,
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
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Phone, Mail, Trash2, UserPlus, Building2 } from "lucide-react";

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

function getDivisionStyle(division: string | null): string {
  return DIVISIONS.find(d => d.value === division)?.color ?? "bg-gray-100 text-gray-700";
}

export default function Team() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useServerEvents({
    team_updated: () => { void queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() }); },
  });

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: members, isLoading } = useListTeamMembers({
    query: { queryKey: getListTeamMembersQueryKey() }
  });

  const createMember = useCreateTeamMember();
  const deleteMember = useDeleteTeamMember();

  const form = useForm<z.infer<typeof memberSchema>>({
    resolver: zodResolver(memberSchema),
    defaultValues: { name: "", role: "", division: "", phone: "", email: "" },
  });

  const onSubmit = (values: z.infer<typeof memberSchema>) => {
    createMember.mutate(
      { data: values as any },
      {
        onSuccess: () => {
          toast({ title: "Anggota tim berhasil ditambahkan" });
          queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
          setIsCreateOpen(false);
          form.reset();
        },
        onError: () => toast({ title: "Gagal menambahkan anggota tim", variant: "destructive" }),
      }
    );
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

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                {/* Nama */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nama</FormLabel>
                      <FormControl>
                        <Input placeholder="contoh: Budi Santoso" {...field} data-testid="input-member-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Divisi */}
                <FormField
                  control={form.control}
                  name="division"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Divisi</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-member-division">
                            <SelectValue placeholder="Pilih divisi..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
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

                {/* Jabatan */}
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Jabatan</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-member-role">
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

                {/* Email */}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input placeholder="budi@perusahaan.com" type="email" {...field} data-testid="input-member-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* No HP */}
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>No. HP (WhatsApp)</FormLabel>
                      <FormControl>
                        <Input placeholder="08123456789" {...field} data-testid="input-member-phone" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Digunakan untuk notifikasi WA saat task baru di-assign
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={createMember.isPending}>
                  {createMember.isPending ? "Menyimpan..." : "Tambah Anggota"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

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
            Belum ada anggota tim. Klik "Tambah Anggota" untuk mulai.
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => handleDelete(member.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Badge Divisi */}
                {member.division && (
                  <div className="mt-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${getDivisionStyle(member.division)}`}>
                      <Building2 className="h-3 w-3" />
                      {DIVISIONS.find(d => d.value === member.division)?.label ?? member.division}
                    </span>
                  </div>
                )}

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
