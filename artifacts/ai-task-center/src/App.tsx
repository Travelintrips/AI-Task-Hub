import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";
import { ErrorBoundary } from "@/components/error-boundary";
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
      <ErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/tasks" component={Tasks} />
          <Route path="/tasks/:id" component={TaskDetail} />
          <Route path="/ai-tasks" component={AiTaskBoard} />
          <Route path="/ai-tasks/:id" component={AiTaskDetail} />
          <Route path="/messages" component={Messages} />
          <Route path="/documents" component={Documents} />
          <Route path="/team" component={Team} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
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
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  return (
    <ErrorBoundary>
      <Switch>
        <Route path="/mini-task/:taskId/:token" component={MiniTaskForm} />
        <Route path="/customer-data/:taskId/:token" component={CustomerDataForm} />
        <Route>
          {() => <AppRouter />}
        </Route>
      </Switch>
    </ErrorBoundary>
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
