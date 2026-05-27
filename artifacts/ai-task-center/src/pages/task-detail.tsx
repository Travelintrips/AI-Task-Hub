import { useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetTask, getGetTaskQueryKey,
  useUpdateTask,
  useDeleteTask,
  useListTeamMembers,
  getListTeamMembersQueryKey,
  getListTasksQueryKey
} from "@workspace/api-client-react";
import { TaskUpdateStatus, TaskUpdatePriority } from "@workspace/api-zod/src/generated/types";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Clock, User, Tag, FileText, AlertCircle, Trash2, Activity, MessageSquare } from "lucide-react";
import { Link, useLocation } from "wouter";

export default function TaskDetail() {
  const [match, params] = useRoute("/tasks/:id");
  const [, setLocation] = useLocation();
  const id = match && params?.id ? parseInt(params.id, 10) : 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: task, isLoading } = useGetTask(id, { 
    query: { enabled: !!id, queryKey: getGetTaskQueryKey(id) } 
  });
  
  const { data: teamMembers } = useListTeamMembers({ 
    query: { queryKey: getListTeamMembersQueryKey() } 
  });

  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  if (!match || (!isLoading && !task)) {
    return <div className="p-8">Task not found</div>;
  }

  const handleStatusChange = (newStatus: string) => {
    updateTask.mutate(
      { id, data: { status: newStatus as TaskUpdateStatus } },
      {
        onSuccess: () => {
          toast({ title: "Status updated" });
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Failed to update status", variant: "destructive" })
      }
    );
  };

  const handleAssigneeChange = (newAssigneeId: string) => {
    const assigneeId = newAssigneeId === "unassigned" ? null : parseInt(newAssigneeId, 10);
    // Use updateTask instead of assignTask for simplicity here, as assigneeId is part of TaskUpdate
    updateTask.mutate(
      { id, data: { assigneeId: assigneeId as number | undefined } },
      {
        onSuccess: () => {
          toast({ title: "Assignee updated" });
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Failed to update assignee", variant: "destructive" })
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTask.mutate(
        { id },
        {
          onSuccess: () => {
            toast({ title: "Task deleted" });
            queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
            setLocation("/tasks");
          },
          onError: () => toast({ title: "Failed to delete task", variant: "destructive" })
        }
      );
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto w-full space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/tasks"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          {isLoading ? (
            <Skeleton className="h-8 w-64" />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && task && (
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteTask.isPending} data-testid="button-delete-task">
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      ) : task ? (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{task.description || "No description provided."}</p>
              </CardContent>
            </Card>

            {task.sourceMessageId && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" /> Source Message
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/messages`}>View linked message #{task.sourceMessageId}</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Activity className="h-4 w-4" /> Status
                  </div>
                  <Select value={task.status} onValueChange={handleStatusChange} disabled={updateTask.isPending}>
                    <SelectTrigger data-testid="select-update-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <AlertCircle className="h-4 w-4" /> Priority
                  </div>
                  <Badge variant={task.priority === "urgent" ? "destructive" : "outline"} className="capitalize">
                    {task.priority}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <User className="h-4 w-4" /> Assignee
                  </div>
                  <Select value={task.assigneeId?.toString() || "unassigned"} onValueChange={handleAssigneeChange} disabled={updateTask.isPending}>
                    <SelectTrigger data-testid="select-update-assignee">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {teamMembers?.map((member) => (
                        <SelectItem key={member.id} value={member.id.toString()}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" /> Created
                  </div>
                  <div className="text-sm">
                    {format(new Date(task.createdAt), "PPp")}
                  </div>
                </div>

                {task.tags && task.tags.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <Tag className="h-4 w-4" /> Tags
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {task.tags.map(tag => (
                        <Badge key={tag} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
