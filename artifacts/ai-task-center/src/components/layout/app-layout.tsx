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
  Activity
} from "lucide-react";
import { NotificationsBell } from "@/components/notifications-bell";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navigation = [
    { name: "Dashboard",    href: "/",          icon: LayoutDashboard },
    { name: "AI Tasks",     href: "/ai-tasks",  icon: Kanban },
    { name: "Tasks",        href: "/tasks",     icon: CheckSquare },
    { name: "Messages",     href: "/messages",  icon: MessageSquare },
    { name: "Documents",    href: "/documents", icon: FileText },
    { name: "Team",         href: "/team",      icon: Users },
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
        </Sidebar>

        <main className="flex-1 overflow-auto flex flex-col">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
