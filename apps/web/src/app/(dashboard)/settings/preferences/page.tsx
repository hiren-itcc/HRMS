'use client';

import type { OrgSettings, OrgSettingsPatch } from '@hrms/shared';
import { WEEKDAYS } from '@hrms/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@hrms/ui/components/alert-dialog';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Checkbox } from '@hrms/ui/components/checkbox';
import { Label } from '@hrms/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { SETTINGS_KEY, settingsApi, useOrgSettings } from '@/features/settings/api';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MODULE_LABELS: { key: keyof OrgSettings['modules']; label: string; hint: string }[] = [
  { key: 'attendance', label: 'Attendance', hint: 'Clock in/out, calendar, corrections' },
  { key: 'leave', label: 'Leave', hint: 'Requests, balances, approvals' },
  { key: 'documents', label: 'Documents', hint: 'Folders and employee documents' },
  { key: 'announcements', label: 'Announcements', hint: 'Company-wide posts' },
  { key: 'reports', label: 'Reports', hint: 'Analytics and exports' },
];

export default function PreferencesPage() {
  const { can } = useSession();
  const canManage = can('settings.manage');
  const queryClient = useQueryClient();
  const query = useOrgSettings();

  // Local draft: preferences are four independent forms, and a single
  // react-hook-form across all of them would make "which group is dirty"
  // harder than just tracking the object.
  const [draft, setDraft] = useState<OrgSettings | null>(null);
  const [confirmWeek, setConfirmWeek] = useState(false);

  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (patch: OrgSettingsPatch) => settingsApi.patch(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data);
      setDraft(data);
      toast.success('Settings saved');
    },
    onError: () => toast.error('Could not save settings. Try again.'),
  });

  if (query.isLoading || !draft) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56 w-full max-w-2xl rounded-2xl" />
        ))}
      </div>
    );
  }

  const server = query.data as OrgSettings;
  const dirty = (group: keyof OrgSettings) =>
    JSON.stringify(draft[group]) !== JSON.stringify(server[group]);

  const set = <K extends keyof OrgSettings>(group: K, value: Partial<OrgSettings[K]>) =>
    setDraft((d) => (d ? { ...d, [group]: { ...d[group], ...value } } : d));

  const toggleDay = (day: number) => {
    const current = draft.workingWeek.weekOffDays;
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    if (next.length === 7) {
      toast.error('At least one day must be a working day');
      return;
    }
    set('workingWeek', { weekOffDays: next.sort((a, b) => a - b) });
  };

  // Defined here rather than as a nested component so React does not remount
  // the buttons on every keystroke.
  const saveBar = (group: keyof OrgSettings, label: string) =>
    canManage ? (
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          disabled={!dirty(group) || save.isPending}
          onClick={() => {
            if (group === 'workingWeek') setConfirmWeek(true);
            else save.mutate({ [group]: draft[group] } as OrgSettingsPatch);
          }}
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {label}
        </Button>
        {dirty(group) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDraft({ ...draft, [group]: server[group] })}
          >
            Discard
          </Button>
        )}
      </div>
    ) : null;

  return (
    <Stagger className="max-w-2xl space-y-5">
      {/* ── Working week ─────────────────────────────────────────────── */}
      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Working week</CardTitle>
            <CardDescription>
              Which days are non-working. This drives week-offs in attendance and the days a leave
              request skips — one setting so the two can never disagree.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset>
              <legend className="mb-2 font-medium text-sm">Week-off days</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const off = draft.workingWeek.weekOffDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      disabled={!canManage}
                      aria-pressed={off}
                      onClick={() => toggleDay(day.value)}
                      className={cn(
                        'min-w-13 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2',
                        off
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                        !canManage && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-muted-foreground text-xs">
                Selected days are non-working. A six-day week means selecting Sunday only.
              </p>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="week-start">Calendars start on</Label>
              <Select
                value={String(draft.workingWeek.weekStartsOn)}
                disabled={!canManage}
                onValueChange={(v) => set('workingWeek', { weekStartsOn: Number(v) })}
              >
                <SelectTrigger id="week-start" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Which day is the first column of the attendance calendar.
              </p>
            </div>

            {saveBar('workingWeek', 'Save working week')}
          </CardContent>
        </Card>
      </FadeInItem>

      {/* ── Leave policy ─────────────────────────────────────────────── */}
      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Leave policy</CardTitle>
            <CardDescription>How the leave year runs and how balances behave</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="year-start">Leave year starts in</Label>
              <Select
                value={String(draft.leave.yearStartMonth)}
                disabled={!canManage}
                onValueChange={(v) => set('leave', { yearStartMonth: Number(v) })}
              >
                <SelectTrigger id="year-start" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((month, i) => (
                    <SelectItem key={month} value={String(i + 1)}>
                      {month}
                      {i === 0 && ' (calendar year)'}
                      {i === 3 && ' (financial year)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                An April start means a request dated March books against the previous leave year.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="negative-balance"
                checked={draft.leave.allowNegativeBalance}
                disabled={!canManage}
                onCheckedChange={(v) => set('leave', { allowNegativeBalance: v === true })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="negative-balance">Allow negative balance</Label>
                <p className="text-muted-foreground text-xs">
                  Let employees book leave they have not accrued yet.
                </p>
              </div>
            </div>

            {saveBar('leave', 'Save leave policy')}
          </CardContent>
        </Card>
      </FadeInItem>

      {/* ── Modules ──────────────────────────────────────────────────── */}
      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Modules</CardTitle>
            <CardDescription>
              Hide sections this workspace doesn't use. This controls navigation only — it is not a
              security control, so permissions still decide who can reach what.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {MODULE_LABELS.map((module) => (
              <div key={module.key} className="flex items-start gap-2.5">
                <Checkbox
                  id={`module-${module.key}`}
                  checked={draft.modules[module.key]}
                  disabled={!canManage}
                  onCheckedChange={(v) => set('modules', { [module.key]: v === true })}
                />
                <div className="space-y-0.5">
                  <Label htmlFor={`module-${module.key}`}>{module.label}</Label>
                  <p className="text-muted-foreground text-xs">{module.hint}</p>
                </div>
              </div>
            ))}
            {saveBar('modules', 'Save modules')}
          </CardContent>
        </Card>
      </FadeInItem>

      {/* Attendance and leave statuses are derived when read, never stored, so
          a working-week change rewrites how *past* days are reported. */}
      <AlertDialog open={confirmWeek} onOpenChange={setConfirmWeek}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-amber-500" aria-hidden />
              This changes past records too
            </AlertDialogTitle>
            <AlertDialogDescription>
              Attendance is worked out when it is read, not stored day by day. Changing the working
              week re-reads history: days that showed as week-offs will become absences, and
              attendance rates for past months will move. Leave balances keep the days they were
              booked with, but the leave report recounts past requests under the new week, so the
              two can disagree for leave taken before this change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => save.mutate({ workingWeek: draft.workingWeek })}>
              Change working week
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Stagger>
  );
}
