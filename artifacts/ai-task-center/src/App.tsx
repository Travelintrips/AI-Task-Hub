import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";

import Dashboard from "@/pages/dashboard";
import Tasks from "@/pages/tasks";
import TaskDetail from "@/pages/task-detail";
import AiTaskBoard from "@/pages/ai-task-board";
import AiTaskDetail from "@/pages/ai-task-detail";
import Messages from "@/pages/messages";
import Documents from "@/pages/documents";
import Team from "@/pages/team";

const queryClient = new QueryClient();

function Router() {
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
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
