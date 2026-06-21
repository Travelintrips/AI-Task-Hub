import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";
import { AuthProvider, useAuth } from "@/contexts/auth-context";

import Dashboard from "@/pages/dashboard";
import Tasks from "@/pages/tasks";
import TaskDetail from "@/pages/task-detail";
import AiTaskBoard from "@/pages/ai-task-board";
import AiTaskDetail from "@/pages/ai-task-detail";
import Messages from "@/pages/messages";
import Documents from "@/pages/documents";
import Team from "@/pages/team";
import Users from "@/pages/users";
import Profile from "@/pages/profile";
import Login from "@/pages/login";
import Setup from "@/pages/setup";
import MiniTaskForm from "@/pages/mini-task-form";
import CustomerDataForm from "@/pages/customer-data-form";
import WaNotifications from "@/pages/wa-notifications";
import ExportPage from "@/pages/export";
import WebhookSetup from "@/pages/webhook-setup";
import Analytics from "@/pages/analytics";
import SettingsPage from "@/pages/settings";
import NotificationsPage from "@/pages/notifications";
import CustomersCrm from "@/pages/customers-crm";
import ReportsPage from "@/pages/reports";
import QuotationsPage from "@/pages/quotations";
import PortalPage from "@/pages/portal";
import AuditLogPage from "@/pages/audit-log";
import AiDispatcherPage from "@/pages/ai-dispatcher";
import KnowledgeBasePage from "@/pages/knowledge-base";
import GovernancePage from "@/pages/governance";
import TrainingPage from "@/pages/training";
import AiObservabilityPage from "@/pages/ai-observability";
import CustomerMemoryPage from "@/pages/customer-memory";
import VendorsPage from "@/pages/vendors";
import VendorMemoryPage from "@/pages/vendor-memory";

const queryClient = new QueryClient();

function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm">Memuat...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/tasks/:id" component={TaskDetail} />
        <Route path="/ai-tasks" component={AiTaskBoard} />
        <Route path="/ai-tasks/:id" component={AiTaskDetail} />
        <Route path="/messages" component={Messages} />
        <Route path="/documents" component={Documents} />
        <Route path="/team" component={Team} />
        <Route path="/users" component={Users} />
        <Route path="/profile" component={Profile} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/wa-notifications" component={WaNotifications} />
        <Route path="/export" component={ExportPage} />
        <Route path="/webhook-setup" component={WebhookSetup} />
        <Route path="/notifications" component={NotificationsPage} />
        <Route path="/crm" component={CustomersCrm} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/quotations" component={QuotationsPage} />
        <Route path="/portal" component={PortalPage} />
        <Route path="/audit-log" component={AuditLogPage} />
        <Route path="/dispatcher" component={AiDispatcherPage} />
        <Route path="/knowledge-base" component={KnowledgeBasePage} />
        <Route path="/governance" component={GovernancePage} />
        <Route path="/training" component={TrainingPage} />
        <Route path="/ai-observability" component={AiObservabilityPage} />
        <Route path="/crm/customers/:id/memory" component={CustomerMemoryPage} />
        <Route path="/vendors" component={VendorsPage} />
        <Route path="/vendors/:id/memory" component={VendorMemoryPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/mini-task/:taskId/:token" component={MiniTaskForm} />
      <Route path="/customer-data/:taskId/:token" component={CustomerDataForm} />
      <Route path="/setup" component={Setup} />
      <Route>
        {() => <AppRouter />}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
