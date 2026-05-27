import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListMessages, getListMessagesQueryKey,
  useProcessMessage,
  useSendWhatsAppMessage
} from "@workspace/api-client-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Bot, Send, CheckCircle2, Clock } from "lucide-react";
import { Link } from "wouter";

export default function Messages() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replyMessage, setReplyMessage] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [isReplyOpen, setIsReplyOpen] = useState(false);

  const { data: messages, isLoading } = useListMessages(
    {},
    { query: { queryKey: getListMessagesQueryKey({}) } }
  );

  const processMessage = useProcessMessage();
  const sendMessage = useSendWhatsAppMessage();

  const handleProcess = (id: number) => {
    processMessage.mutate(
      { id },
      {
        onSuccess: (result) => {
          toast({ 
            title: "Message processed", 
            description: `Intent: ${result.intent}. ${result.taskCreated ? 'Task created.' : ''}` 
          });
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey({}) });
        },
        onError: () => toast({ title: "Failed to process message", variant: "destructive" })
      }
    );
  };

  const handleSendReply = () => {
    if (!selectedMessage || !replyMessage.trim()) return;

    sendMessage.mutate(
      { data: { to: selectedMessage.from, message: replyMessage } },
      {
        onSuccess: () => {
          toast({ title: "Reply sent" });
          setIsReplyOpen(false);
          setReplyMessage("");
        },
        onError: () => toast({ title: "Failed to send reply", variant: "destructive" })
      }
    );
  };

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">WhatsApp Inbox</h1>
        <Button variant="outline" data-testid="button-refresh-messages" onClick={() => queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey({}) })}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6 flex gap-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : messages?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
            No messages found.
          </div>
        ) : (
          messages?.map((msg) => (
            <Card key={msg.id} className={!msg.processed ? "border-l-4 border-l-primary" : ""} data-testid={`card-message-${msg.id}`}>
              <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {msg.senderName || msg.from}
                    {!msg.processed && <Badge variant="secondary" className="text-xs font-normal">New</Badge>}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground font-mono mt-1">{msg.from}</p>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {format(new Date(msg.timestamp), "PPp")}
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                <p className="whitespace-pre-wrap text-sm">{msg.body}</p>
                
                {msg.detectedIntent && (
                  <div className="mt-4 flex items-center gap-2 text-sm bg-muted/50 p-2 rounded-md border">
                    <Bot className="h-4 w-4 text-primary" />
                    <span className="font-medium">Detected Intent:</span> 
                    <Badge variant="outline">{msg.detectedIntent}</Badge>
                    {msg.taskId && (
                      <Link href={`/tasks/${msg.taskId}`} className="ml-auto text-primary hover:underline" data-testid={`link-message-task-${msg.taskId}`}>
                        View Task #{msg.taskId}
                      </Link>
                    )}
                  </div>
                )}
              </CardContent>
              <CardFooter className="pt-0 flex gap-2">
                {!msg.processed ? (
                  <Button 
                    size="sm" 
                    onClick={() => handleProcess(msg.id)} 
                    disabled={processMessage.isPending}
                    data-testid={`button-process-message-${msg.id}`}
                  >
                    <Bot className="h-4 w-4 mr-2" /> 
                    {processMessage.isPending ? "Processing..." : "Process with AI"}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled className="text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Processed
                  </Button>
                )}
                
                <Dialog open={isReplyOpen && selectedMessage?.id === msg.id} onOpenChange={(open) => {
                  setIsReplyOpen(open);
                  if (open) setSelectedMessage(msg);
                  else setSelectedMessage(null);
                }}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" data-testid={`button-reply-message-${msg.id}`}>
                      <Send className="h-4 w-4 mr-2" /> Reply
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reply to {msg.senderName || msg.from}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="bg-muted p-3 rounded-md text-sm whitespace-pre-wrap opacity-70">
                        {msg.body}
                      </div>
                      <Input 
                        placeholder="Type your message..." 
                        value={replyMessage}
                        onChange={(e) => setReplyMessage(e.target.value)}
                        data-testid="input-reply-message"
                      />
                      <Button onClick={handleSendReply} disabled={sendMessage.isPending || !replyMessage.trim()} className="w-full">
                        {sendMessage.isPending ? "Sending..." : "Send Message"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
