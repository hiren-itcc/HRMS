'use client';

import type { OrgSettings, OrgSettingsPatch } from '@hrms/shared';
import { PER_DAY_BASES, PER_DAY_BASIS_LABELS, WEEKDAYS } from '@hrms/shared';
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
import { Input } from '@hrms/ui/components/input';
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
import { Field } from '@/components/field';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { ExitChecklistEditor } from '@/features/lifecycle/components/exit-checklist-editor';
import { LifecycleRunPanel } from '@/features/lifecycle/components/lifecycle-run-panel';
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

/**
 * Every switchable module, and it has to stay every one.
 *
 * This list had five of the nine keys in `modulesSchema`. `payroll`, `assets`,
 * `wfh` and `expenses` were all switchable in the schema and honoured by the
 * sidebar, and reachable from no screen at all — so an organization that did
 * not want them had no way to say so. Each was added when its module shipped
 * and none of them was added here.
 *
 * The type is `keyof OrgSettings['modules']`, so a new key does not force an
 * entry — nothing breaks, it just quietly cannot be turned off. Worth checking
 * this file whenever `modulesSchema` grows.
 */
const MODULE_LABELS: { key: keyof OrgSettings['modules']; label: string; hint: string }[] = [
  { key: 'attendance', label: 'Attendance', hint: 'Clock in/out, calendar, corrections' },
  { key: 'leave', label: 'Leave', hint: 'Requests, balances, approvals' },
  { key: 'wfh', label: 'Remote work', hint: 'Working-from-home requests and the weekly cap' },
  { key: 'documents', label: 'Documents', hint: 'Folders and employee documents' },
  { key: 'payroll', label: 'Payroll', hint: 'Runs, payslips and salary structures' },
  { key: 'expenses', label: 'Expenses', hint: 'Claims, approvals and reimbursement categories' },
  { key: 'assets', label: 'Assets', hint: 'The register of equipment issued to people' },
  { key: 'performance', label: 'Performance', hint: 'Goals, review cycles and ratings' },
  { key: 'helpdesk', label: 'Helpdesk', hint: 'Tickets, the desk queue and its categories' },
  { key: 'announcements', label: 'Announcements', hint: 'Company-wide posts' },
  { key: 'reports', label: 'Reports', hint: 'Analytics and exports' },
];

/**
 * A number input hands back a string, and an empty one hands back `''`.
 * `Number('')` is 0, which would silently save "no notice period" the moment
 * somebody cleared the field to retype it — so an unparseable value keeps the
 * low end of the range instead.
 */
function clamp(raw: string, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

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

      {/* ── Employment lifecycle ─────────────────────────────────────── */}
      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Employment lifecycle</CardTitle>
            <CardDescription>
              Defaults for joining, confirming and leaving. Every number here can be overridden on
              an individual employee — this is what applies when theirs is left blank.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="notice-days">Notice period (days)</Label>
                <Input
                  id="notice-days"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={365}
                  className="w-32"
                  disabled={!canManage}
                  value={draft.lifecycle.defaultNoticeDays}
                  onChange={(e) =>
                    set('lifecycle', { defaultNoticeDays: clamp(e.target.value, 0, 365) })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  Calendar days from the day a resignation is filed.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="probation-months">Probation (months)</Label>
                <Input
                  id="probation-months"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={24}
                  className="w-32"
                  disabled={!canManage}
                  value={draft.lifecycle.defaultProbationMonths}
                  onChange={(e) =>
                    set('lifecycle', { defaultProbationMonths: clamp(e.target.value, 0, 24) })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  Zero means new hires start confirmed. Existing employees are unaffected.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="auto-confirm"
                checked={draft.lifecycle.autoConfirmOnProbationEnd}
                disabled={!canManage}
                onCheckedChange={(v) => set('lifecycle', { autoConfirmOnProbationEnd: v === true })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="auto-confirm">Confirm automatically at the end of probation</Label>
                <p className="text-muted-foreground text-xs">
                  Off means the date passes and the employee waits on the Probation ending list
                  until HR presses Confirm.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="auto-exit"
                checked={draft.lifecycle.autoExitOnLastWorkingDate}
                disabled={!canManage}
                onCheckedChange={(v) => set('lifecycle', { autoExitOnLastWorkingDate: v === true })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="auto-exit">Mark leavers exited after their last working day</Label>
                <p className="text-muted-foreground text-xs">
                  Suspends the sign-in and signs every device out. Off means somebody who has left
                  keeps working access until HR completes the offboarding by hand.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="manager-approval"
                checked={draft.lifecycle.requireManagerApproval}
                disabled={!canManage}
                onCheckedChange={(v) => set('lifecycle', { requireManagerApproval: v === true })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="manager-approval">
                  Route resignations past the manager before HR
                </Label>
                <p className="text-muted-foreground text-xs">
                  Skipped anyway for anyone with no reporting manager, who would otherwise have
                  nobody to review them.
                </p>
              </div>
            </div>

            {saveBar('lifecycle', 'Save lifecycle')}

            {canManage && <LifecycleRunPanel />}
          </CardContent>
        </Card>
      </FadeInItem>

      {/* ── Exit checklist ───────────────────────────────────────────── */}
      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Exit checklist</CardTitle>
            <CardDescription>
              What has to be cleared before somebody's exit can be closed. Each item is copied onto
              an exit when it starts, so this is a template rather than a live list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ExitChecklistEditor
              items={draft.exitChecklist.items}
              disabled={!canManage}
              onChange={(items) => set('exitChecklist', { items })}
            />
            {saveBar('exitChecklist', 'Save checklist')}
          </CardContent>
        </Card>
      </FadeInItem>

      {/* ── Work from home ───────────────────────────────────────────── */}
      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Work from home</CardTitle>
            <CardDescription>
              How many remote days people may book, and whether somebody has to agree first.
              Attendance records a remote day either way — this decides which ones were planned.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="wfh-enabled"
                checked={draft.wfh.enabled}
                disabled={!canManage}
                onCheckedChange={(v) => set('wfh', { enabled: v === true })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="wfh-enabled">Allow remote-work requests</Label>
                <p className="text-muted-foreground text-xs">
                  Off means nobody can ask. Days already agreed keep their approval.
                </p>
              </div>
            </div>

            {draft.wfh.enabled && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="wfh-cap">Remote days a week</Label>
                  <Input
                    id="wfh-cap"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={7}
                    className="w-32"
                    disabled={!canManage}
                    value={draft.wfh.maxDaysPerWeek}
                    onChange={(e) => set('wfh', { maxDaysPerWeek: clamp(e.target.value, 0, 7) })}
                  />
                  <p className="text-muted-foreground text-xs">
                    {draft.wfh.maxDaysPerWeek === 0
                      ? 'Nobody may book a remote day. This is a real setting, not "no limit".'
                      : draft.wfh.maxDaysPerWeek === 7
                        ? 'Seven is every day there is — effectively no limit.'
                        : 'An individual can be given their own allowance on their record.'}
                  </p>
                </div>

                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="wfh-approval"
                    checked={draft.wfh.requireApproval}
                    disabled={!canManage}
                    onCheckedChange={(v) => set('wfh', { requireApproval: v === true })}
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="wfh-approval">Route requests past the manager</Label>
                    <p className="text-muted-foreground text-xs">
                      Off means a request is agreed the moment it is filed — still worth recording,
                      because attendance can then say a day was planned.
                    </p>
                  </div>
                </div>
              </>
            )}

            {saveBar('wfh', 'Save remote work')}
          </CardContent>
        </Card>
      </FadeInItem>

      {/* ── Full & final settlement ──────────────────────────────────── */}
      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Full &amp; final settlement</CardTitle>
            <CardDescription>
              How a leaver's dues are priced. These are read when a settlement is prepared and
              frozen onto it — changing them will not rewrite a settlement that already exists.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="per-day-basis">A day's pay is</Label>
                <Select
                  value={draft.settlement.perDayBasis}
                  onValueChange={(v) =>
                    set('settlement', {
                      perDayBasis: v as OrgSettings['settlement']['perDayBasis'],
                    })
                  }
                  disabled={!canManage}
                >
                  <SelectTrigger id="per-day-basis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PER_DAY_BASES.map((basis) => (
                      <SelectItem key={basis} value={basis}>
                        {PER_DAY_BASIS_LABELS[basis]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Monthly pay is divided by this for both encashment and recovery.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rate-basis">Priced off</Label>
                <Select
                  value={draft.settlement.rateBasis}
                  onValueChange={(v) =>
                    set('settlement', { rateBasis: v as OrgSettings['settlement']['rateBasis'] })
                  }
                  disabled={!canManage}
                >
                  <SelectTrigger id="rate-basis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BASIC">Basic salary</SelectItem>
                    <SelectItem value="GROSS">Gross salary</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Basic is the common practice; gross is the more generous reading.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="recover-notice"
                checked={draft.settlement.recoverShortNotice}
                disabled={!canManage}
                onCheckedChange={(v) => set('settlement', { recoverShortNotice: v === true })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="recover-notice">Recover pay for notice that was not served</Label>
                <p className="text-muted-foreground text-xs">
                  Resignations only. Nothing is recovered when the company ended the employment — a
                  termination owes notice rather than collecting it.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="gratuity-enabled"
                checked={draft.settlement.gratuity.enabled}
                disabled={!canManage}
                onCheckedChange={(v) =>
                  set('settlement', {
                    gratuity: { ...draft.settlement.gratuity, enabled: v === true },
                  })
                }
              />
              <div className="space-y-0.5">
                <Label htmlFor="gratuity-enabled">Compute gratuity</Label>
                <p className="text-muted-foreground text-xs">
                  Off means it is left off the settlement entirely. HR can still add it by hand.
                </p>
              </div>
            </div>

            {draft.settlement.gratuity.enabled && (
              <div className="grid gap-4 border-border border-l-2 pl-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gratuity-min-years">Minimum service (years)</Label>
                  <Input
                    id="gratuity-min-years"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={20}
                    className="w-32"
                    disabled={!canManage}
                    value={draft.settlement.gratuity.minYears}
                    onChange={(e) =>
                      set('settlement', {
                        gratuity: {
                          ...draft.settlement.gratuity,
                          minYears: clamp(e.target.value, 0, 20),
                        },
                      })
                    }
                  />
                  <p className="text-muted-foreground text-xs">
                    Five is the statutory qualifying period.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="gratuity-cap">Ceiling (₹)</Label>
                  <Input
                    id="gratuity-cap"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={100_000}
                    className="w-40"
                    disabled={!canManage}
                    value={draft.settlement.gratuity.cap}
                    onChange={(e) =>
                      set('settlement', {
                        gratuity: {
                          ...draft.settlement.gratuity,
                          cap: clamp(e.target.value, 0, 100_000_000),
                        },
                      })
                    }
                  />
                  <p className="text-muted-foreground text-xs">
                    ₹20,00,000 is the statutory ceiling. Zero means no ceiling.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="gratuity-days">Days per year</Label>
                  <Input
                    id="gratuity-days"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={31}
                    className="w-32"
                    disabled={!canManage}
                    value={draft.settlement.gratuity.daysPerYear}
                    onChange={(e) =>
                      set('settlement', {
                        gratuity: {
                          ...draft.settlement.gratuity,
                          daysPerYear: clamp(e.target.value, 0, 31),
                        },
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="gratuity-divisor">Divisor</Label>
                  <Input
                    id="gratuity-divisor"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    className="w-32"
                    disabled={!canManage}
                    value={draft.settlement.gratuity.divisor}
                    onChange={(e) =>
                      set('settlement', {
                        gratuity: {
                          ...draft.settlement.gratuity,
                          divisor: clamp(e.target.value, 1, 31),
                        },
                      })
                    }
                  />
                </div>

                <p className="text-muted-foreground text-xs sm:col-span-2">
                  {draft.settlement.gratuity.daysPerYear}/{draft.settlement.gratuity.divisor} of a
                  month's pay for every completed year. A part year over six months counts as a
                  whole one.
                </p>
              </div>
            )}

            {saveBar('settlement', 'Save settlement')}
          </CardContent>
        </Card>
      </FadeInItem>

      {/* ── Modules ──────────────────────────────────────────────────── */}
      <FadeInItem>
        {/*
          Statutory identity. Not decoration: an ECR file cannot be written
          without the establishment code, and the filings screen refuses before
          a month can be chosen rather than at download time.
        */}
        <Card>
          <CardHeader>
            <CardTitle>Statutory</CardTitle>
            <CardDescription>
              Who this company is to the EPFO, ESIC and the tax department. A return cannot be
              generated until the code it is filed under is here.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ['pfEstablishmentCode', 'PF establishment code', 'Required for an ECR file'],
                ['esiEmployerCode', 'ESIC employer code', 'Required for a contribution return'],
                ['tan', 'TAN', 'Tax deduction account number'],
                ['pan', 'PAN', 'The company’s own PAN'],
                ['signatoryName', 'Signatory', 'Named on a return as responsible for it'],
                ['signatoryDesignation', 'Signatory designation', ''],
              ] as const
            ).map(([key, label, hint]) => (
              <Field key={key} label={label} hint={hint || undefined}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={draft.statutory[key]}
                    disabled={!canManage}
                    onChange={(e) => set('statutory', { [key]: e.target.value })}
                  />
                )}
              </Field>
            ))}
            <div className="sm:col-span-2">{saveBar('statutory', 'Save statutory details')}</div>
          </CardContent>
        </Card>

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
