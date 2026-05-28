import { useState } from "react";
import { useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetTask, getGetTaskQueryKey,
  useUpdateTask,
  useDeleteTask,
  useListTeamMembers,
  getListTeamMembersQueryKey,
  getListTasksQueryKey,
  useGenerateTaskAiSummary,
} from "@workspace/api-client-react";
import { TaskUpdateStatus, TaskUpdatePriority } from "@workspace/api-zod/src/generated/types";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Clock, User, Tag, AlertCircle, Trash2, Activity, MessageSquare, Sparkles, TriangleAlert, Lightbulb, RefreshCw } from "lucide-react";
import { Link, useLocation } from "wouter";

interface AiSummaryResult {
  summary: string;
  missingData: string[];
  recommendation: string;
}

function AiSummaryCard({ taskId }: { taskId: number }) {
  const [result, setResult] = useState<AiSummaryResult | null>(null);
  const generateSummary = useGenerateTaskAiSummary();

  const handleGenerate = () => {
    generateSummary.mutate(
      { id: taskId },
      {
        onSuccess: (data) => setResult(data as AiSummaryResult),
        onError: () => {},
      }
    );
  };

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-blue-700 text-base">
            <Sparkles className="h-4 w-4" />
            Ringkasan AI Admin
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generateSummary.isPending}
            className="border-blue-300 text-blue-700 hover:bg-blue-100 hover:text-blue-800 gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generateSummary.isPending ? "animate-spin" : ""}`} />
            {generateSummary.isPending ? "Menganalisis..." : result ? "Perbarui" : "Generate Ringkasan"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {generateSummary.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full bg-blue-200/60" />
            <Skeleton className="h-4 w-5/6 bg-blue-200/60" />
            <Skeleton className="h-4 w-4/6 bg-blue-200/60" />
          </div>
        )}

        {!generateSummary.isPending && !result && (
          <p className="text-sm text-blue-600/70 italic">
            Klik "Generate Ringkasan" untuk membuat analisis operasional AI dari task ini.
          </p>
        )}

        {!generateSummary.isPending && result && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700 leading-relaxed">{result.summary}</p>

            {result.missingData.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Data / Dokumen yang Kurang
                </div>
                <ul className="space-y-1">
                  {result.missingData.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-amber-800">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.missingData.length === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Semua data tampaknya sudah lengkap
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                <Lightbulb className="h-3.5 w-3.5" />
                Rekomendasi
              </div>
              <p className="text-sm text-blue-800 leading-relaxed">{result.recommendation}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
          toast({ title: "Status diperbarui" });
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Gagal memperbarui status", variant: "destructive" })
      }
    );
  };

  const handleAssigneeChange = (newAssigneeId: string) => {
    const assigneeId = newAssigneeId === "unassigned" ? null : parseInt(newAssigneeId, 10);
    updateTask.mutate(
      { id, data: { assigneeId: assigneeId as number | undefined } },
      {
        onSuccess: () => {
          toast({ title: "Penugasan diperbarui" });
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Gagal memperbarui penugasan", variant: "destructive" })
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Apakah Anda yakin ingin menghapus task ini?")) {
      deleteTask.mutate(
        { id },
        {
          onSuccess: () => {
            toast({ title: "Task dihapus" });
            queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
            setLocation("/tasks");
          },
          onError: () => toast({ title: "Gagal menghapus task", variant: "destructive" })
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
              <Trash2 className="h-4 w-4 mr-2" /> Hapus
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-6">
              <Skeleton className="h-48 w-full" />
            </div>
            <div className="space-y-6">
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        </div>
      ) : task ? (
        <div className="space-y-6">
          <AiSummaryCard taskId={id} />

          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Deskripsi</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{task.description || "Tidak ada deskripsi."}</p>
                </CardContent>
              </Card>

              {task.sourceMessageId && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" /> Pesan Sumber
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/messages`}>Lihat pesan terkait #{task.sourceMessageId}</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Detail</CardTitle>
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
                      <AlertCircle className="h-4 w-4" /> Prioritas
                    </div>
                    <Badge variant={task.priority === "urgent" ? "destructive" : "outline"} className="capitalize">
                      {task.priority}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                      <User className="h-4 w-4" /> Ditugaskan ke
                    </div>
                    <Select value={task.assigneeId?.toString() || "unassigned"} onValueChange={handleAssigneeChange} disabled={updateTask.isPending}>
                      <SelectTrigger data-testid="select-update-assignee">
                        <SelectValue placeholder="Belum ditugaskan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Belum ditugaskan</SelectItem>
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
                      <Clock className="h-4 w-4" /> Dibuat
                    </div>
                    <div className="text-sm">
                      {format(new Date(task.createdAt), "PPp")}
                    </div>
                  </div>

                  {task.tags && task.tags.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <Tag className="h-4 w-4" /> Tag
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
        </div>
      ) : null}
    </div>
  );
}
