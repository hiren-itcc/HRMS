'use client';

import { type RoleCreateInput, roleCreateSchema } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Checkbox } from '@hrms/ui/components/checkbox';
import { Skeleton } from '@hrms/ui/components/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@hrms/ui/components/tooltip';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Info, Loader2, Lock, Plus } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { FormInput } from '@/components/form';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { actionTitle, type Role, rbacApi, rbacKeys } from '@/features/settings/rbac-api';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

const BLANK: RoleCreateInput = { code: '', name: '', description: null, permissions: [] };

export default function RolesPage() {
  const _queryClient = useQueryClient();
  const { user } = useSession();
  const roles = useQuery({ queryKey: rbacKeys.roles(), queryFn: rbacApi.roles });
  const groups = useQuery({
    queryKey: ['rbac-permissions'],
    queryFn: rbacApi.permissions,
    staleTime: Number.POSITIVE_INFINITY,
  });

  /** roleId → granted codes. Edits stay local until Save. */
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    if (!roles.data) return;
    setDraft(Object.fromEntries(roles.data.map((r) => [r.id, new Set(r.permissions)])));
  }, [roles.data]);

  /** `'new'` composes one; a Role renames it. `code` is immutable either way. */
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const form = useZodForm<RoleCreateInput>(roleCreateSchema, { defaultValues: BLANK });
  const renaming = editing !== 'new' ? editing : null;

  const invalidate = [rbacKeys.roles(), rbacKeys.assignable()];

  const compose = useApiMutation({
    mutationFn: (input: RoleCreateInput) =>
      renaming
        ? // `code` and `permissions` are absent from the update schema: the code
          // is permanent, and grants are edited in the matrix below rather than
          // in a dialog that cannot show what they mean.
          rbacApi.updateRole(renaming.id, { name: input.name, description: input.description })
        : rbacApi.createRole(input),
    invalidate,
    success: 'Role saved',
    onSuccess: () => setEditing(null),
  });

  // A refusal — a system role, or one people still hold — arrives as a ready
  // -made sentence from the API, and `useApiMutation` renders an ApiError's
  // message verbatim as the toast.
  const remove = useApiMutation({
    mutationFn: (roleId: string) => rbacApi.deleteRole(roleId),
    invalidate,
    success: 'Role deleted',
  });

  const save = useApiMutation({
    mutationFn: ({ role, permissions }: { role: Role; permissions: string[] }) =>
      rbacApi.setPermissions(role.id, permissions),
    invalidate,
    error: 'Could not save permissions. Try again.',
    onSuccess: (result, { role }) => {
      if (result.blocked.length > 0) {
        toast.warning(`${role.name} saved, but some permissions are protected`, {
          description: `${result.blocked.join(', ')} cannot be removed from ${role.name}.`,
        });
      } else {
        toast.success(`${role.name} updated`, {
          description: 'Affected people pick this up within 15 minutes.',
        });
      }
    },
  });

  if (roles.isLoading || groups.isLoading || !roles.data || !groups.data) {
    return <Skeleton className="h-[520px] w-full rounded-2xl" />;
  }

  const list = roles.data;
  const dirtyRoles = list.filter((role) => {
    const next = draft[role.id];
    if (!next) return false;
    return next.size !== role.permissions.length || role.permissions.some((p) => !next.has(p));
  });

  const toggle = (roleId: string, code: string) =>
    setDraft((d) => {
      const next = new Set(d[roleId] ?? []);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { ...d, [roleId]: next };
    });

  return (
    <TooltipProvider delay={200}>
      <Stagger className="space-y-4">
        <FadeInItem>
          <p className="flex items-start gap-2 rounded-2xl border bg-muted/40 p-4 text-muted-foreground text-xs">
            <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Permissions are read from the database when someone signs in or their session
              refreshes, so a change here reaches people already signed in{' '}
              <strong className="font-medium text-foreground">within 15 minutes</strong>. Their
              screen may offer an action the server still refuses until then.
            </span>
          </p>
        </FadeInItem>

        {list.some((role) => role.code === user?.roleCode) && (
          <FadeInItem>
            <p className="flex items-start gap-2 rounded-2xl border bg-muted/40 p-4 text-muted-foreground text-xs">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Your own role is read-only here. Rewriting the permissions that authorise you is
                never a legitimate edit — it is how a stripped permission gets handed straight back
                before the removal has reached your session. Ask another administrator, or grant{' '}
                <span className="font-mono">role.manage</span> to a second role first.
              </span>
            </p>
          </FadeInItem>
        )}

        <FadeInItem>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                form.reset(BLANK);
                setEditing('new');
              }}
            >
              <Plus className="size-4" aria-hidden /> Compose a role
            </Button>
          </div>
        </FadeInItem>

        <FadeInItem>
          <div className="overflow-x-auto rounded-2xl border bg-card shadow-xs">
            <table className="w-full min-w-4xl border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-muted/40 px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider backdrop-blur"
                  >
                    Permission
                  </th>
                  {list.map((role) => (
                    <th key={role.id} scope="col" className="px-3 py-3 text-center">
                      <span className="block font-medium text-foreground text-sm">{role.name}</span>
                      <span className="block text-muted-foreground text-xs">
                        {role.userCount} {role.userCount === 1 ? 'person' : 'people'}
                      </span>
                      {role.code === user?.roleCode && (
                        <Badge variant="outline" className="mt-1 font-normal">
                          Your role
                        </Badge>
                      )}
                      {/* Only custom roles. A system role's rename and delete
                          are refused server-side by `editBlockedReason`, so
                          offering the buttons would only produce a toast. */}
                      {!role.isSystem && (
                        <span className="mt-1 flex justify-center">
                          <RowActions
                            name={role.name}
                            editPerm="role.manage"
                            deleting={remove.isPending}
                            onEdit={() => {
                              form.reset({
                                code: role.code,
                                name: role.name,
                                description: role.description,
                                permissions: [],
                              });
                              setEditing(role);
                            }}
                            onDelete={() => remove.mutate(role.id)}
                          />
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.data.map((group) => (
                  <Fragment key={group.resource}>
                    <tr className="border-b bg-muted/20">
                      <th
                        scope="colgroup"
                        colSpan={list.length + 1}
                        className="sticky left-0 px-4 py-1.5 text-left font-semibold text-xs capitalize tracking-wide"
                      >
                        {group.resource}
                      </th>
                    </tr>
                    {group.permissions.map((perm) => (
                      <tr key={perm.code} className="border-b last:border-0 hover:bg-muted/30">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-normal"
                        >
                          <span className="block">{actionTitle(perm.action)}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">
                            {perm.code}
                          </span>
                        </th>
                        {list.map((role) => {
                          const mine = role.code === user?.roleCode;
                          const locked = role.locked.includes(perm.code);
                          const checked = draft[role.id]?.has(perm.code) ?? false;
                          const cell = (
                            <Checkbox
                              checked={checked}
                              disabled={locked || mine}
                              aria-label={`${perm.code} for ${role.name}`}
                              onCheckedChange={() => toggle(role.id, perm.code)}
                            />
                          );
                          return (
                            <td key={role.id} className="px-3 py-2 text-center">
                              <span className="inline-flex items-center justify-center gap-1">
                                {locked || mine ? (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={<span className="inline-flex items-center gap-1" />}
                                    >
                                      {cell}
                                      <Lock className="size-3 text-muted-foreground" aria-hidden />
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-56">
                                      {mine
                                        ? 'This is your own role. The server refuses the edit, so the cells are disabled rather than failing on save.'
                                        : 'Admin must keep this — removing it would lock everyone out of settings.'}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  cell
                                )}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </FadeInItem>

        {/* One bar for all pending edits — saving per checkbox would fire a
            request per click and make a half-applied matrix easy to leave. */}
        {dirtyRoles.length > 0 && (
          <div className="sticky bottom-4 z-20">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card/95 p-3 shadow-lg backdrop-blur">
              <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-sm">
                Unsaved changes to{' '}
                {dirtyRoles.map((r) => (
                  <Badge key={r.id} variant="secondary" className="mr-1">
                    {r.name}
                  </Badge>
                ))}
              </span>
              <span className="ml-auto flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft(Object.fromEntries(list.map((r) => [r.id, new Set(r.permissions)])))
                  }
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  disabled={save.isPending}
                  onClick={async () => {
                    for (const role of dirtyRoles) {
                      await save.mutateAsync({
                        role,
                        permissions: [...(draft[role.id] ?? [])],
                      });
                    }
                  }}
                >
                  {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Save {dirtyRoles.length === 1 ? 'change' : 'changes'}
                </Button>
              </span>
            </div>
          </div>
        )}
        <FormDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          title={renaming ? 'Rename the role' : 'Compose a role'}
          submitting={compose.isPending}
          submitLabel="Save"
          onSubmit={form.handleSubmit((values) => compose.mutate(values))}
        >
          <FormInput
            control={form.control}
            name="name"
            label="Name"
            placeholder="IT Admin"
            required
          />
          <FormInput
            control={form.control}
            name="code"
            label="Code"
            placeholder="IT_ADMIN"
            disabled={renaming !== null}
            hint={
              renaming
                ? 'Locked. A sign-in token carries the role code, so changing it would leave everyone already signed in naming a role that no longer exists.'
                : 'Capitals, digits and underscores. Permanent once saved, for the same reason.'
            }
            required
          />
          <FormInput
            control={form.control}
            name="description"
            label="Description"
            placeholder="Manages devices and access, no people data"
          />
          {!renaming && (
            <p className="text-muted-foreground text-xs">
              The role is created with no permissions. Grant them in the matrix once it appears —
              you can only grant what you hold yourself.
            </p>
          )}
        </FormDialog>
      </Stagger>
    </TooltipProvider>
  );
}
