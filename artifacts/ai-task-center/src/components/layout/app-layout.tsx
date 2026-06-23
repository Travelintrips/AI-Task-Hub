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
  LayoutDashboard,
  CheckSquare,
  Kanban,
  MessageSquare,
  FileText,
  Users,
  Activity,
  ShieldCheck,
  LogOut,
  UserCircle,
  BellRing,
  FileSpreadsheet,
  Webhook,
  BarChart2,
  Settings2,
  Bell,
  Building2,
  DollarSign,
  Globe,
  TrendingUp,
  Brain,
  BookOpen,
  Shield,
  FlaskConical,
  ShoppingCart,
  Sparkles,
  Truck,
  Droplets,
  Package,
  Navigation,
  Zap,
  Layers,
  FileCheck,
} from "lucide-react";
import { NotificationsBell } from "@/components/notifications-bell";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Link as WouterLink } from "wouter";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const navigation = [
    { name: "Dashboard",    href: "/",          icon: LayoutDashboard },
    { name: "AI Tasks",     href: "/ai-tasks",  icon: Kanban },
    { name: "Messages",     href: "/messages",  icon: MessageSquare },
    { name: "Documents",    href: "/documents", icon: FileText },
    { name: "Team",         href: "/team",      icon: Users },
    { name: "AI Intake",       href: "/intake-sessions",      icon: MessageSquare },
    { name: "Conv. Intake",    href: "/conversation-intake",  icon: MessageSquare },
    { name: "Doc Validation",  href: "/document-intake",      icon: FileCheck },
    { name: "Mini Form Config",     href: "/mini-form-config",     icon: Layers },
    { name: "Mini Form Analytics",  href: "/mini-form-analytics",  icon: BarChart2 },
    { name: "Test Suite AI", href: "/conversation-tests", icon: FlaskConical },
    { name: "AI Dispatcher", href: "/dispatcher",        icon: Brain },
    { name: "Knowledge Base", href: "/knowledge-base",  icon: BookOpen },
    { name: "Governance",    href: "/governance",        icon: Shield },
    { name: "AI Training",   href: "/training",          icon: FlaskConical },
    { name: "AI Observability", href: "/ai-observability", icon: Activity },
    { name: "CRM",          href: "/crm",               icon: Building2 },
    { name: "Vendors",     href: "/vendors",           icon: TrendingUp },
    { name: "Vendor Review",  href: "/admin/vendor-review", icon: TrendingUp },
    { name: "Fleet Dashboard", href: "/fleet/dashboard",       icon: BarChart2 },
    { name: "Fleet Risk",      href: "/fleet/risk",            icon: Shield },
    { name: "Fleet Cost/KM",   href: "/fleet/cost",            icon: TrendingUp },
    { name: "Route Profit",    href: "/fleet/route-profitability", icon: Navigation },
    { name: "Fleet Units",     href: "/fleet/units",           icon: Truck },
    { name: "Fleet Drivers",   href: "/fleet/drivers",         icon: Users },
    { name: "Driver Admin",    href: "/driver-admin",          icon: ShieldCheck },
    { name: "Fleet BBM",       href: "/fleet/fuel",            icon: Droplets },
    { name: "Fleet Ban",       href: "/fleet/tires",           icon: Package },
    { name: "Utilisasi",       href: "/fleet/utilization",     icon: Navigation },
    { name: "Purchasing",  href: "/purchasing-intelligence", icon: ShoppingCart },
    { name: "Exec Intelligence", href: "/executive-intelligence", icon: Sparkles },
    ...(user?.role === "super_admin" || user?.role === "company_admin" || user?.role === "owner"
      ? [{ name: "Command Center", href: "/executive-command", icon: Zap }]
      : []),
    { name: "Quotation",   href: "/quotations",        icon: DollarSign },
    { name: "Laporan",     href: "/reports",           icon: TrendingUp },
    { name: "Notifikasi",  href: "/notifications",     icon: Bell },
    { name: "Portal",      href: "/portal",            icon: Globe },
    { name: "Audit Log",   href: "/audit-log",         icon: ShieldCheck },
    { name: "Analitik",    href: "/analytics",         icon: BarChart2 },
    { name: "Notif WA",    href: "/wa-notifications",  icon: BellRing },
    { name: "Export",      href: "/export",            icon: FileSpreadsheet },
    { name: "Webhook",     href: "/webhook-setup",     icon: Webhook },
    ...(user?.role === "super_admin" || user?.role === "company_admin"
      ? [
          { name: "Users",      href: "/users",    icon: Users },
          { name: "Pengaturan", href: "/settings", icon: Settings2 },
        ]
      : []),
    ...(user?.role === "super_admin" || user?.role === "company_admin" || user?.role === "owner" || user?.role === "supervisor"
      ? [{ name: "Onboarding Setup", href: "/onboarding", icon: CheckSquare }]
      : []),
    ...(user?.role === "super_admin" || user?.role === "company_admin"
      ? [{ name: "Company Governance", href: "/company-governance", icon: Shield }]
      : []),
  ];

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar>
          <SidebarHeader className="h-14 flex items-center border-b">
            <div className="flex items-center justify-between w-full px-4">
              <div className="flex items-center gap-2 font-bold text-primary">
                <Activity className="h-5 w-5" />
                <span>AI Task Center</span>
              </div>
              <NotificationsBell />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigation.map((item) => {
                    const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                    return (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.name}>
                          <Link href={item.href} className="flex items-center gap-2 w-full" data-testid={`nav-${item.name.toLowerCase()}`}>
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

          {user && (
            <div className="border-t p-3 space-y-1">
              <WouterLink href="/profile">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer transition-colors">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                    {user.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-none truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.role.replace(/_/g, " ")}</p>
                  </div>
                  <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              </WouterLink>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8"
                onClick={logout}
              >
                <LogOut className="h-3.5 w-3.5 mr-2" />
                Keluar
              </Button>
            </div>
          )}
        </Sidebar>

        <main className="flex-1 overflow-auto flex flex-col">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
