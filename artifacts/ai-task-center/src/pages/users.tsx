import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiListUsers, apiCreateUser, apiUpdateUser, apiDeleteUser,
  type AuthUser,
} from "@/lib/auth-api";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Plus, Edit, Trash2, UserCheck, UserX, Mail, Phone,
  Building2, ShieldCheck, KeyRound,
} from "lucide-react";

const ROLES = ["super_admin", "company_admin", "supervisor", "staff", "vendor", "customer"] as const;
type Role = typeof ROLES[number];

const ROLE_LABELS: Record<Role, string> = {
  super_admin:    "Super Admin",
  company_admin:  "Company Admin",
  supervisor:     "Supervisor",
  staff:          "Staff",
  vendor:         "Vendor",
  customer:       "Customer",
};

const ROLE_COLORS: Record<Role, string> = {
  super_admin:   "bg-red-100 text-red-700 border-red-200",
  company_admin: "bg-purple-100 text-purple-700 border-purple-200",
  supervisor:    "bg-blue-100 text-blue-700 border-blue-200",
  staff:         "bg-green-100 text-green-700 border-green-200",
  vendor:        "bg-orange-100 text-orange-700 border-orange-200",
  customer:      "bg-gray-100 text-gray-700 border-gray-200",
};

const createSchema = z.object({
  name:      z.string().min(1, "Nama wajib diisi"),
  email:     z.string().email("Email tidak valid"),
  password:  z.string().min(8, "Password minimal 8 karakter"),
  role:      z.enum(ROLES),
  division:  z.string().optional(),
  phone:     z.string().optional(),
});

const editSchema = z.object({
  name:     z.string().min(1, "Nama wajib diisi"),
  role:     z.enum(ROLES),
  division: z.string().optional(),
  phone:    z.string().optional(),
});

type CreateForm = z.infer<typeof createSchema>;
type EditForm   = z.infer<typeof editSchema>;

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
}

function RoleBadge({ role }: { role: string }) {
  const r = role as Role;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[r] ?? "bg-muted text-muted-foreground"}`}>
      {ROLE_LABELS[r] ?? role}
    </span>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AuthUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["auth-users"],
    queryFn: apiListUsers,
  });

  const createMutation = useMutation({
    mutationFn: apiCreateUser,
    onSuccess: () => {
      toast({ title: "Pengguna berhasil dibuat" });
      qc.invalidateQueries({ queryKey: ["auth-users"] });
      setCreateOpen(false);
    },
    onError: (e: Error) => toast({ title: "Gagal membuat pengguna", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditForm }) =>
      apiUpdateUser(id, data),
    onSuccess: () => {
      toast({ title: "Pengguna diperbarui" });
      qc.invalidateQueries({ queryKey: ["auth-users"] });
      setEditTarget(null);
    },
    onError: (e: Error) => toast({ title: "Gagal memperbarui", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiUpdateUser(id, { isActive }),
    onSuccess: (_, vars) => {
      toast({ title: vars.isActive ? "Pengguna diaktifkan" : "Pengguna dinonaktifkan" });
      qc.invalidateQueries({ queryKey: ["auth-users"] });
    },
    onError: (e: Error) => toast({ title: "Gagal mengubah status", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDeleteUser(id),
    onSuccess: () => {
      toast({ title: "Pengguna dihapus" });
      qc.invalidateQueries({ queryKey: ["auth-users"] });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: "Gagal menghapus", description: e.message, variant: "destructive" }),
  });

  const createForm = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", email: "", password: "", role: "staff", division: "", phone: "" },
  });

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: "", role: "staff", division: "", phone: "" },
  });

  const openEdit = (u: AuthUser) => {
    setEditTarget(u);
    editForm.reset({
      name:     u.name,
      role:     u.role as Role,
      division: u.division ?? "",
      phone:    u.phone ?? "",
    });
  };

  const isSuperAdmin = me?.role === "super_admin";

  const availableRoles = isSuperAdmin
    ? ROLES
    : ROLES.filter(r => r !== "super_admin" && r !== "company_admin");

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Manajemen Pengguna</h1>
          <p className="text-muted-foreground mt-1">Kelola akun dan hak akses pengguna sistem</p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Tambah Pengguna
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Tambah Pengguna Baru</DialogTitle>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(d => createMutation.mutate(d))} className="space-y-4">
                <FormField control={createForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Lengkap</FormLabel>
                    <FormControl><Input placeholder="Budi Santoso" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="budi@perusahaan.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" placeholder="Min. 8 karakter" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Pilih role" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableRoles.map(r => (
                          <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={createForm.control} name="division" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Divisi</FormLabel>
                      <FormControl><Input placeholder="Import Team" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={createForm.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>No. HP</FormLabel>
                      <FormControl><Input placeholder="+62..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Menyimpan..." : "Buat Pengguna"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      {users && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-primary p-1.5 rounded-lg bg-primary/10" />
              <div>
                <p className="text-2xl font-bold">{users.length}</p>
                <p className="text-xs text-muted-foreground">Total Pengguna</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <UserCheck className="h-8 w-8 text-green-600 p-1.5 rounded-lg bg-green-50" />
              <div>
                <p className="text-2xl font-bold">{users.filter(u => u.isActive).length}</p>
                <p className="text-xs text-muted-foreground">Aktif</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <UserX className="h-8 w-8 text-orange-500 p-1.5 rounded-lg bg-orange-50" />
              <div>
                <p className="text-2xl font-bold">{users.filter(u => !u.isActive).length}</p>
                <p className="text-xs text-muted-foreground">Nonaktif</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <KeyRound className="h-8 w-8 text-purple-600 p-1.5 rounded-lg bg-purple-50" />
              <div>
                <p className="text-2xl font-bold">
                  {users.filter(u => u.role === "super_admin" || u.role === "company_admin").length}
                </p>
                <p className="text-xs text-muted-foreground">Admin</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* User List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : users?.length === 0 ? (
          <div className="col-span-full text-center py-16 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
            <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Belum ada pengguna terdaftar.</p>
          </div>
        ) : (
          users?.map((u) => (
            <Card key={u.id} className={!u.isActive ? "opacity-60" : ""}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-10 w-10 shrink-0 border">
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                        {initials(u.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold leading-tight truncate">{u.name}</span>
                        {u.id === me?.id && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">Saya</Badge>
                        )}
                      </div>
                      <RoleBadge role={u.role} />
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7"
                      title="Edit"
                      onClick={() => openEdit(u)}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    {u.id !== me?.id && (
                      <>
                        <Button
                          variant="ghost" size="icon"
                          className={`h-7 w-7 ${u.isActive ? "text-orange-500 hover:bg-orange-50" : "text-green-600 hover:bg-green-50"}`}
                          title={u.isActive ? "Nonaktifkan" : "Aktifkan"}
                          onClick={() => toggleMutation.mutate({ id: u.id, isActive: !u.isActive })}
                        >
                          {u.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                        </Button>
                        {isSuperAdmin && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            title="Hapus"
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{u.email}</span>
                  </div>
                  {u.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{u.phone}</span>
                    </div>
                  )}
                  {u.division && (
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{u.division}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                  <span className={`inline-flex items-center gap-1 ${u.isActive ? "text-green-600" : "text-orange-500"}`}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${u.isActive ? "bg-green-500" : "bg-orange-400"}`} />
                    {u.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                  {u.lastLoginAt && (
                    <span>Login: {new Date(u.lastLoginAt).toLocaleDateString("id-ID")}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Pengguna — {editTarget?.name}</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(d => editTarget && editMutation.mutate({ id: editTarget.id, data: d }))} className="space-y-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nama Lengkap</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableRoles.map(r => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="division" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Divisi</FormLabel>
                    <FormControl><Input placeholder="Import Team" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>No. HP</FormLabel>
                    <FormControl><Input placeholder="+62..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <Button type="submit" className="w-full" disabled={editMutation.isPending}>
                {editMutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pengguna ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Akun <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}) akan dihapus permanen dan tidak bisa dikembalikan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
