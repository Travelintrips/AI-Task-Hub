import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListDocuments, getListDocumentsQueryKey,
  useUploadDocument,
  useAuditDocument,
  useDeleteDocument
} from "@workspace/api-client-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, FileText, Activity, AlertCircle, Trash2 } from "lucide-react";
import { Link } from "wouter";

export default function Documents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [filename, setFilename] = useState("");

  const { data: documents, isLoading } = useListDocuments(
    { query: { queryKey: getListDocumentsQueryKey() } }
  );

  const uploadDocument = useUploadDocument();
  const auditDocument = useAuditDocument();
  const deleteDocument = useDeleteDocument();

  const handleUploadMock = () => {
    if (!filename.trim()) return;
    
    uploadDocument.mutate(
      { 
        data: { 
          filename, 
          fileUrl: `https://example.com/docs/${filename}`, 
          mimeType: "application/pdf",
          uploadedBy: "Current User"
        } 
      },
      {
        onSuccess: () => {
          toast({ title: "Document uploaded" });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          setIsUploadOpen(false);
          setFilename("");
        },
        onError: () => toast({ title: "Failed to upload document", variant: "destructive" })
      }
    );
  };

  const handleAudit = (id: number) => {
    auditDocument.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Audit completed" });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        },
        onError: () => toast({ title: "Failed to audit document", variant: "destructive" })
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this document?")) {
      deleteDocument.mutate(
        { id },
        {
          onSuccess: () => {
            toast({ title: "Document deleted" });
            queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          },
          onError: () => toast({ title: "Failed to delete document", variant: "destructive" })
        }
      );
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Document Audit</h1>
        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-upload-doc">
              <Upload className="h-4 w-4 mr-2" /> Upload Document
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Document</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Filename</label>
                <Input 
                  placeholder="e.g. invoice-123.pdf" 
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  data-testid="input-doc-filename"
                />
              </div>
              <Button onClick={handleUploadMock} disabled={uploadDocument.isPending || !filename.trim()} className="w-full">
                {uploadDocument.isPending ? "Uploading..." : "Simulate Upload"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filename</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : documents?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No documents found.
                </TableCell>
              </TableRow>
            ) : (
              documents?.map((doc) => (
                <TableRow key={doc.id} data-testid={`row-doc-${doc.id}`}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {doc.filename}
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      doc.status === 'audited' ? 'default' : 
                      doc.status === 'error' ? 'destructive' : 
                      doc.status === 'auditing' ? 'secondary' : 'outline'
                    }>
                      {doc.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {doc.auditScore !== null ? (
                      <span className={`font-mono font-medium ${(doc.auditScore ?? 0) < 70 ? 'text-destructive' : 'text-primary'}`}>
                        {doc.auditScore}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(doc.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {doc.status === "pending" && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleAudit(doc.id)}
                        disabled={auditDocument.isPending}
                        data-testid={`button-audit-doc-${doc.id}`}
                      >
                        <Activity className="h-4 w-4 mr-2" /> Audit
                      </Button>
                    )}
                    {doc.taskId && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/tasks/${doc.taskId}`}>Task #{doc.taskId}</Link>
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(doc.id)} className="text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
