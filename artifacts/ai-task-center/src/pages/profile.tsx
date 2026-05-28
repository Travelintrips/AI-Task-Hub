import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiUpdateUser, apiChangePassword } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { User, Lock, Building2, Phone, Mail, ShieldCheck } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  super_admin:   "Super Admin",
  company_admin: "Company Admin",
  supervisor:    "Supervisor",
  staff:         "Staff",
  vendor:        "Vendor",
  customer:      "Customer",
};

const profileSchema = z.object({
  name:  z.string().min(1, "Nama wajib diisi"),
  phone: z.string().optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Password saat ini wajib diisi"),
    newPassword:     z.string().min(8, "Password baru minimal 8 karakter"),
    confirmPassword: z.string().min(1, "Konfirmasi password wajib diisi"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

type ProfileForm  = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
}

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [savingProfile,  setSavingProfile]  = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name:  user?.name  ?? "",
      phone: user?.phone ?? "",
    },
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSaveProfile = async (values: ProfileForm) => {
    if (!user) return;
    setSavingProfile(true);
    try {
      await apiUpdateUser(user.id, { name: values.name, phone: values.phone || "" });
      await refreshUser();
      toast({ title: "Profil berhasil diperbarui" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Gagal menyimpan profil";
      toast({ title: "Gagal menyimpan profil", description: msg, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async (values: PasswordForm) => {
    setSavingPassword(true);
    try {
      await apiChangePassword(values.currentPassword, values.newPassword);
      toast({ title: "Password berhasil diubah" });
      passwordForm.reset();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Gagal mengubah password";
      toast({ title: "Gagal mengubah password", description: msg, variant: "destructive" });
    } finally {
      setSavingPassword(false);
    }
  };

  if (!user) return null;

  return (
    <div className="p-8 max-w-2xl mx-auto w-full space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profil Saya</h1>
        <p className="text-muted-foreground mt-1">Kelola informasi akun dan keamanan Anda</p>
      </div>

      {/* Avatar + summary */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-5">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl font-bold border-2 border-primary/20 shrink-0">
              {initials(user.name)}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold truncate">{user.name}</h2>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {ROLE_LABELS[user.role] ?? user.role}
                </span>
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  {user.email}
                </span>
                {user.division && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    {user.division}
                  </span>
                )}
                {user.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    {user.phone}
                  </span>
                )}
              </div>
              {user.lastLoginAt && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Login terakhir: {new Date(user.lastLoginAt).toLocaleString("id-ID")}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Informasi Pribadi
          </CardTitle>
          <CardDescription>Perbarui nama dan nomor telepon Anda</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="space-y-4">
              <div className="space-y-2">
                <FormLabel className="text-sm font-medium text-muted-foreground">Email</FormLabel>
                <Input value={user.email} disabled className="bg-muted/50" />
                <p className="text-xs text-muted-foreground">Email tidak dapat diubah</p>
              </div>

              <FormField
                control={profileForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Lengkap</FormLabel>
                    <FormControl>
                      <Input placeholder="Nama lengkap Anda" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={profileForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nomor Telepon</FormLabel>
                    <FormControl>
                      <Input placeholder="+62 8xx xxxx xxxx" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? "Menyimpan..." : "Simpan Perubahan"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Separator />

      {/* Change password */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            Ubah Password
          </CardTitle>
          <CardDescription>Gunakan password yang kuat dan belum pernah dipakai di tempat lain</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...passwordForm}>
            <form onSubmit={passwordForm.handleSubmit(onChangePassword)} className="space-y-4">
              <FormField
                control={passwordForm.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password Saat Ini</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={passwordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password Baru</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Min. 8 karakter" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={passwordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Konfirmasi Password Baru</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Ulangi password baru" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={savingPassword}>
                {savingPassword ? "Mengubah..." : "Ubah Password"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
