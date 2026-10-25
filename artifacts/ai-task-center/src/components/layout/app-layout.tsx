import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  Activity,
  BarChart2,
  Bell,
  Bot,
  CalendarDays,
  Database,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Network,
  Settings2,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Link as WouterLink } from "wouter";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Chat & AI", href: "/ai-core-chat", icon: MessageSquare },
    { name: "WhatsApp Inbox", href: "/messages", icon: Bell },
    { name: "Proyek", href: "/ai-tasks", icon: FolderKanban },
    { name: "Job", href: "/ai-tasks", icon: Network },
    { name: "Timeline Job & SOP", href: "/execution-timeline", icon: Activity },
    { name: "Kalender", href: "/notifications", icon: CalendarDays },
    { name: "File & Dokumen", href: "/documents", icon: FileText },
    { name: "Database", href: "/knowledge-base", icon: Database },
    { name: "Tim & Worker", href: "/team", icon: Users },
    { name: "Laporan", href: "/reports", icon: BarChart2 },
    { name: "Integrasi", href: "/ai-operations", icon: Bot },
    { name: "Pengaturan", href: "/settings", icon: Settings2 },
  ];

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-[#07101d] text-slate-100">
        <Sidebar className="border-r border-slate-800 bg-[#08111f]">
          <SidebarHeader className="border-b border-slate-800 bg-[#08111f] px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-blue-900/20">
                <Activity className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-base font-bold tracking-tight text-white">AI Task</div>
                <div className="text-[10px] text-slate-500">All Projects in One Place</div>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="bg-[#08111f]">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {navigation.map((item) => {
                    const isActive =
                      location === item.href ||
                      (item.href !== "/" && location.startsWith(item.href));
                    return (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.name}
                          className={
                            isActive
                              ? "bg-blue-600/20 text-blue-300 hover:bg-blue-600/25"
                              : "text-slate-400 hover:bg-slate-800/70 hover:text-white"
                          }
                        >
                          <Link
                            href={item.href}
                            className="flex w-full items-center gap-3 px-2 py-2"
                            data-testid={`nav-${item.name.toLowerCase()}`}
                          >
                            <item.icon className="h-4 w-4" />
                            <span>{item.name}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <div className="border-t border-slate-800 bg-[#08111f] p-3">
            <div className="mb-3 rounded-xl border border-slate-800 bg-[#0d1827] p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                AI Core DEV
              </div>
              <div className="mt-1 text-[10px] text-emerald-400">Online</div>
              <div className="mt-3 space-y-2">
                {[
                  ["CPU", 28],
                  ["Memory", 55],
                  ["Storage", 41],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <div className="flex justify-between text-[9px] text-slate-500">
                      <span>{label}</span>
                      <span>{value}%</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {user && (
              <div className="space-y-2">
                <WouterLink href="/profile">
                  <div className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/60">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
                      {user.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .substring(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-300">{user.name}</p>
                      <p className="truncate text-[10px] text-slate-600">{user.role.replace(/_/g, " ")}</p>
                    </div>
                    <Bell className="h-3.5 w-3.5 text-slate-600" />
                  </div>
                </WouterLink>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                  onClick={logout}
                >
                  <LogOut className="mr-2 h-3.5 w-3.5" />
                  Keluar
                </Button>
              </div>
            )}
          </div>
        </Sidebar>

        <main className="flex flex-1 flex-col overflow-auto bg-[#07101d]">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
