'use client';

import {
  CLEARANCE_OWNER_LABELS,
  OFFBOARDING_TASK_STATUS_LABELS,
  type OffboardingTaskStatusCode,
} from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { cn } from '@hrms/ui/lib/utils';
import { Check, CircleDashed, MinusCircle, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { EmptyState } from '@/components/empty-state';
import { Field } from '@/components/field';
import { useSession } from '@/components/session-provider';
import { useApiMutation } from '@/hooks/use-crud';
import { type OffboardingTask, offboardingKeys, offboardingsApi } from '../api';

const STATUS_STYLE: Record<OffboardingTaskStatusCode, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  DONE: 'bg-success/15 text-success-text',
  NOT_APPLICABLE: 'bg-muted text-muted-foreground',
};

const STATUS_ICON: Record<OffboardingTaskStatusCode, typeof Check> = {
  PENDING: CircleDashed,
  DONE: Check,
  NOT_APPLICABLE: MinusCircle,
};

/** How many required items are settled, which is what the gate actually reads. */
export function clearanceProgress(tasks: OffboardingTask[]) {
  const required = tasks.filter((t) => t.required);
  const settled = required.filter((t) => t.status !== 'PENDING');
  return { done: settled.length, total: required.length };
}

interface ChecklistProps {
  tasks: OffboardingTask[];
  /** Sign-off is refused by the API once the exit is closed; the UI says so first. */
  editable: boolean;
  /** The leaver's manager, so a manager can tell which rows are theirs. */
  employeeManagerId: string | null;
}

/**
 * The exit clearance list.
 *
 * Each row states its owner in words as well as by position, because "who is
 * blocking this" is the question the screen exists to answer and the person
 * reading it is usually not the person who has to act.
 */
export function ClearanceChecklist({ tasks, editable, employeeManagerId }: ChecklistProps) {
  const { can, user } = useSession();
  const [waiving, setWaiving] = useState<OffboardingTask | null>(null);
  const [note, setNote] = useState('');

  const canSignAny = can('employee.offboard');
  const canSignSome = can('offboarding.clearance');
  const isTheirManager = employeeManagerId != null && employeeManagerId === user?.employee?.id;

  /** Mirrors the service rule exactly, so a button is never a 403. */
  const maySign = (task: OffboardingTask) => {
    if (!editable) return false;
    if (canSignAny) return true;
    if (!canSignSome) return false;
    return task.owner !== 'MANAGER' || isTheirManager;
  };

  const invalidate = [offboardingKeys.all()];
  const update = useApiMutation({
    mutationFn: ({
      id,
      status,
      note: text,
    }: {
      id: string;
      status: OffboardingTaskStatusCode;
      note: string | null;
    }) => offboardingsApi.updateTask(id, { status, note: text }),
    invalidate,
    error: 'Could not update that item',
    onSuccess: () => {
      setWaiving(null);
      setNote('');
    },
  });

  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No clearance items"
        hint="Add them under Settings → Preferences, and the next exit will carry them."
      />
    );
  }

  return (
    <>
      <ul className="divide-y">
        {tasks.map((task) => {
          const Icon = STATUS_ICON[task.status];
          const settled = task.status !== 'PENDING';
          return (
            <li key={task.id} className="flex flex-wrap items-start gap-3 py-3">
              <span
                className={cn(
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                  STATUS_STYLE[task.status],
                )}
                aria-hidden
              >
                <Icon className="size-3.5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className={cn('text-sm', settled && 'text-muted-foreground')}>
                  {task.label}
                  {/* Required is a word, not a colour or an asterisk. */}
                  {!task.required && (
                    <span className="ml-1.5 text-muted-foreground text-xs">(optional)</span>
                  )}
                </p>
                {task.description && (
                  <p className="mt-0.5 text-muted-foreground text-xs">{task.description}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                  <Badge className={cn('border-transparent', STATUS_STYLE[task.status])}>
                    {OFFBOARDING_TASK_STATUS_LABELS[task.status]}
                  </Badge>
                  <span>{CLEARANCE_OWNER_LABELS[task.owner]}</span>
                </p>
                {task.note && <p className="mt-1 break-words text-sm">{task.note}</p>}
              </div>

              {maySign(task) && (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {settled ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: task.id, status: 'PENDING', note: null })}
                    >
                      <Undo2 className="size-3.5" aria-hidden /> Reopen
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: task.id, status: 'DONE', note: null })}
                      >
                        Clear
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setWaiving(task)}>
                        Not applicable
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/*
       * A waiver takes a reason and a completion does not: "cleared" is the
       * expected outcome, "this one did not apply" is a judgement somebody
       * will ask about later. The API refuses it without one.
       */}
      <FormDialog
        open={waiving !== null}
        onOpenChange={(open) => !open && setWaiving(null)}
        title="Mark as not applicable"
        description={waiving?.label}
        onSubmit={(e) => {
          e.preventDefault();
          if (waiving) {
            update.mutate({ id: waiving.id, status: 'NOT_APPLICABLE', note: note.trim() });
          }
        }}
        submitting={update.isPending}
        submitLabel="Mark not applicable"
        submitDisabled={!note.trim()}
      >
        <Field
          label="Why does it not apply?"
          required
          hint="Kept on the exit record and the audit trail"
          error={note.trim() ? undefined : 'Say why — this is what somebody reads later'}
        >
          {(a11y) => (
            <Input
              {...a11y}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Contractor — no company laptop was ever issued"
            />
          )}
        </Field>
      </FormDialog>
    </>
  );
}
