'use client';

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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Info, Loader2, Lock } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FadeInItem, Stagger } from '@/components/motion';
import { actionTitle, type Role, rbacApi } from '@/features/settings/rbac-api';

const ROLES_KEY = ['rbac-roles'] as const;

export default function RolesPage() {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ROLES_KEY, queryFn: rbacApi.roles });
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

  const save = useMutation({
    mutationFn: ({ role, permissions }: { role: Role; permissions: string[] }) =>
      rbacApi.setPermissions(role.id, permissions),
    onSuccess: (result, { role }) => {
      queryClient.invalidateQueries({ queryKey: ROLES_KEY });
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
    onError: () => toast.error('Could not save permissions. Try again.'),
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
                          const locked = role.locked.includes(perm.code);
                          const checked = draft[role.id]?.has(perm.code) ?? false;
                          const cell = (
                            <Checkbox
                              checked={checked}
                              disabled={locked}
                              aria-label={`${perm.code} for ${role.name}`}
                              onCheckedChange={() => toggle(role.id, perm.code)}
                            />
                          );
                          return (
                            <td key={role.id} className="px-3 py-2 text-center">
                              <span className="inline-flex items-center justify-center gap-1">
                                {locked ? (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={<span className="inline-flex items-center gap-1" />}
                                    >
                                      {cell}
                                      <Lock className="size-3 text-muted-foreground" aria-hidden />
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-56">
                                      Admin must keep this — removing it would lock everyone out of
                                      settings.
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
      </Stagger>
    </TooltipProvider>
  );
}
