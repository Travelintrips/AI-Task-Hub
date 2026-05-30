import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerEvents } from "@/hooks/use-server-events";
import { 
  useListTeamMembers, getListTeamMembersQueryKey,
  useCreateTeamMember,
  useUpdateTeamMember,
  useDeleteTeamMember
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Phone, Mail, Trash2, Edit } from "lucide-react";

const memberSchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.string().min(1, "Role is required"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

export default function Team() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useServerEvents({
    team_updated: () => { void queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() }); },
  });

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: members, isLoading } = useListTeamMembers({ 
    query: { queryKey: getListTeamMembersQueryKey() } 
  });

  const createMember = useCreateTeamMember();
  const deleteMember = useDeleteTeamMember();

  const form = useForm<z.infer<typeof memberSchema>>({
    resolver: zodResolver(memberSchema),
    defaultValues: {
      name: "",
      role: "",
      phone: "",
      email: "",
    },
  });

  const onSubmit = (values: z.infer<typeof memberSchema>) => {
    createMember.mutate(
      { data: values as any },
      {
        onSuccess: () => {
          toast({ title: "Team member added" });
          queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
          setIsCreateOpen(false);
          form.reset();
        },
        onError: () => toast({ title: "Failed to add team member", variant: "destructive" })
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to remove this team member?")) {
      deleteMember.mutate(
        { id },
        {
          onSuccess: () => {
            toast({ title: "Team member removed" });
            queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
          },
          onError: () => toast({ title: "Failed to remove team member", variant: "destructive" })
        }
      );
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Team Members</h1>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-member">Add Member</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Team Member</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" {...field} data-testid="input-member-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <FormControl>
                        <Input placeholder="Operations Specialist" {...field} data-testid="input-member-role" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input placeholder="john@example.com" type="email" {...field} data-testid="input-member-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="+1 (555) 000-0000" {...field} data-testid="input-member-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createMember.isPending}>
                  {createMember.isPending ? "Adding..." : "Add Member"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : members?.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
            No team members found.
          </div>
        ) : (
          members?.map((member) => (
            <Card key={member.id} data-testid={`card-member-${member.id}`}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12 border">
                      <AvatarImage src={member.avatarUrl || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary font-medium">
                        {member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold text-lg leading-none">{member.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{member.role}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(member.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="mt-6 space-y-2 text-sm">
                  {member.email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      <span>{member.email}</span>
                    </div>
                  )}
                  {member.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
