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
import VendorRegisterPage from "@/pages/vendor-register";
import VendorStatusPage from "@/pages/vendor-status";
import VendorDocumentsPage from "@/pages/vendor-documents";
import VendorReviewAdmin from "@/pages/vendor-review-admin";
import ExecutiveIntelligencePage from "@/pages/executive-intelligence";
import ExecutiveCommandPage from "@/pages/executive-command";
import PurchasingIntelligencePage from "@/pages/purchasing-intelligence";
import SportCenterPage from "@/pages/sport-center";
import ScMyBookings from "@/pages/sc-my-bookings";
import ScBookingStatus from "@/pages/sc-booking-status";
import ScBukti from "@/pages/sc-bukti";
import FleetUnitsPage from "@/pages/fleet-units";
import FleetUnitDetailPage from "@/pages/fleet-unit-detail";
import FleetDriversPage from "@/pages/fleet-drivers";
import FleetDriverDetailPage from "@/pages/fleet-driver-detail";
import FleetDocumentsPage from "@/pages/fleet-documents";
import FleetMaintenancePage from "@/pages/fleet-maintenance";
import FleetFuelPage from "@/pages/fleet-fuel";
import FleetTiresPage from "@/pages/fleet-tires";
import FleetUtilizationPage from "@/pages/fleet-utilization";
import FleetDashboardPage from "@/pages/fleet-dashboard";
import FleetRiskPage from "@/pages/fleet-risk";
import FleetCostPage from "@/pages/fleet-cost";
import FleetRouteProfitabilityPage from "@/pages/fleet-route-profitability";
import IntakeSessionsPage from "@/pages/intake-sessions";
import ConversationIntakePage from "@/pages/conversation-intake";
import DocumentIntakePage from "@/pages/document-intake";
import MiniFormPage from "@/pages/mini-form-page";
import MiniFormConfigPage from "@/pages/mini-form-config";
import MiniFormAnalyticsPage from "@/pages/mini-form-analytics";
import ConversationTestsPage from "@/pages/conversation-tests";
import QualityGatePage from "@/pages/quality-gate";
import OnboardingPage from "@/pages/onboarding";
import DriverHomePage from "@/pages/driver-home";
import DriverProfilePage from "@/pages/driver-profile";
import DriverDocumentsPage from "@/pages/driver-documents";
import DriverTripsPage from "@/pages/driver-trips";
import DriverHistoryPage from "@/pages/driver-history";
import DriverAdminPage from "@/pages/driver-admin";
import CompanyGovernancePage from "@/pages/company-governance";
import CompanyOnboardingFactoryPage from "@/pages/company-onboarding-factory";
import HoldingDashboardPage from "@/pages/holding-dashboard";
import AiOperationsPage from "@/pages/ai-operations";
import NotificationReceiversPage from "@/pages/notification-receivers";

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
        <Route path="/tasks">{() => { window.location.replace("/ai-tasks"); return null; }}</Route>
        <Route path="/tasks/:id">{(params) => { window.location.replace(`/ai-tasks/${params.id}`); return null; }}</Route>
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
        <Route path="/admin/vendor-review" component={VendorReviewAdmin} />
        <Route path="/purchasing-intelligence" component={PurchasingIntelligencePage} />
        <Route path="/executive-intelligence" component={ExecutiveIntelligencePage} />
        <Route path="/executive-command" component={ExecutiveCommandPage} />
        <Route path="/fleet/dashboard" component={FleetDashboardPage} />
        <Route path="/fleet/risk" component={FleetRiskPage} />
        <Route path="/fleet/cost" component={FleetCostPage} />
        <Route path="/fleet/route-profitability" component={FleetRouteProfitabilityPage} />
        <Route path="/intake-sessions" component={IntakeSessionsPage} />
        <Route path="/conversation-intake" component={ConversationIntakePage} />
        <Route path="/document-intake" component={DocumentIntakePage} />
        <Route path="/mini-form-config" component={MiniFormConfigPage} />
        <Route path="/mini-form-analytics" component={MiniFormAnalyticsPage} />
        <Route path="/fleet/units/:id" component={FleetUnitDetailPage} />
        <Route path="/fleet/units" component={FleetUnitsPage} />
        <Route path="/fleet/drivers/:id" component={FleetDriverDetailPage} />
        <Route path="/fleet/drivers" component={FleetDriversPage} />
        <Route path="/fleet/documents" component={FleetDocumentsPage} />
        <Route path="/fleet/maintenance" component={FleetMaintenancePage} />
        <Route path="/fleet/fuel" component={FleetFuelPage} />
        <Route path="/fleet/tires" component={FleetTiresPage} />
        <Route path="/fleet/utilization" component={FleetUtilizationPage} />
        <Route path="/conversation-tests" component={ConversationTestsPage} />
        <Route path="/quality-gate/report" component={QualityGatePage} />
        <Route path="/onboarding" component={OnboardingPage} />
        <Route path="/onboarding/:step" component={OnboardingPage} />
        <Route path="/driver-admin" component={DriverAdminPage} />
        <Route path="/company-governance" component={CompanyGovernancePage} />
        <Route path="/company-onboarding" component={CompanyOnboardingFactoryPage} />
        <Route path="/holding-dashboard" component={HoldingDashboardPage} />
        <Route path="/ai-operations" component={AiOperationsPage} />
        <Route path="/notification-receivers" component={NotificationReceiversPage} />
        <Route path="/sport-center" component={SportCenterPage} />
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
      <Route path="/mini-form/preview/:templateId" component={MiniFormPage} />
      <Route path="/mini-form/:type/:token" component={MiniFormPage} />
      <Route path="/vendor/register/:token" component={VendorRegisterPage} />
      <Route path="/vendor/status/:token" component={VendorStatusPage} />
      <Route path="/vendor/documents/:token" component={VendorDocumentsPage} />
      <Route path="/driver/home/:token" component={DriverHomePage} />
      <Route path="/driver/profile/:token" component={DriverProfilePage} />
      <Route path="/driver/documents/:token" component={DriverDocumentsPage} />
      <Route path="/driver/trips/:token" component={DriverTripsPage} />
      <Route path="/driver/history/:token" component={DriverHistoryPage} />
      <Route path="/sc/my-bookings" component={ScMyBookings} />
      <Route path="/sc/status/:token" component={ScBookingStatus} />
      <Route path="/sc/bukti/:token" component={ScBukti} />
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
