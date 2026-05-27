import { useGetDashboardStats, getGetDashboardStatsQueryKey, useGetRecentActivity, getGetRecentActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckSquare, MessageSquare, FileText, AlertCircle, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const { data: activities, isLoading: activitiesLoading } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Mission Control</h1>
      </div>

      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StatCard title="Open Tasks" value={stats.openTasks} icon={CheckSquare} description={`${stats.totalTasks} total tasks`} />
          <StatCard title="Urgent Tasks" value={stats.urgentTasks} icon={AlertCircle} description="Requires immediate attention" valueClass="text-destructive" />
          <StatCard title="Pending Messages" value={stats.pendingMessages} icon={MessageSquare} description={`${stats.totalMessages} total received`} />
          <StatCard title="Completed Tasks" value={stats.completedTasks} icon={CheckSquare} description="All time" />
          <StatCard title="Audited Documents" value={stats.auditedDocuments} icon={FileText} description={`${stats.totalDocuments} total documents`} />
          <StatCard title="Team Members" value={stats.teamSize} icon={Users} description="Active on platform" />
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="col-span-2 md:col-span-1">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activitiesLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : activities && activities.length > 0 ? (
              <div className="space-y-4">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex items-center gap-4 text-sm border-b pb-4 last:border-0 last:pb-0">
                    <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">{activity.description}</p>
                      <p className="text-muted-foreground text-xs">{format(new Date(activity.createdAt), "PPp")}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No recent activity</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, description, valueClass = "" }: any) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
