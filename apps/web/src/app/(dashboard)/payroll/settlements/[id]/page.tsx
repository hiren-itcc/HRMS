'use client';

import {
  SETTLEMENT_STATUS_LABELS,
  type SettlementLineKindCode,
  type SettlementStatusCode,
} from '@hrms/shared';
import { Alert, AlertDescription } from '@hrms/ui/components/alert';
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
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Info, Pencil, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActivityTimeline } from '@/components/activity-timeline';
import { FormDialog } from '@/components/crud/form-dialog';
import { ErrorState } from '@/components/error-state';
import { Field } from '@/components/field';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import type { SettlementLine } from '@/features/settlements/api';
import { settlementKeys, settlementsApi } from '@/features/settlements/api';
import { useApiMutation } from '@/hooks/use-crud';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));

const TONE: Record<SettlementStatusCode, string> = {
  DRAFT: 'bg-warning/15 text-warning-text',
  APPROVED: 'bg-info/15 text-info-text',
  PAID: 'bg-success/15 text-success-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

/**
 * The statement.
 *
 * Printable rather than self-service, and that is forced by the domain: the
 * leaver's sign-in is suspended the moment their exit completes, so the one
 * person this document concerns cannot log in to read it. It has to stand on
 * its own on paper — which is why every figure prints the working underneath
 * it, and why an overridden line says so.
 */
function LineRows({
  title,
  lines,
  total,
  editable,
  onEdit,
  onRemove,
}: {
  title: string;
  lines: SettlementLine[];
  total: number;
  editable: boolean;
  onEdit: (line: SettlementLine) => void;
  onRemove: (line: SettlementLine) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
        {title}
      </h3>
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">None</p>
      ) : (
        <dl className="space-y-2.5 text-sm">
          {lines.map((line) => (
            <div key={line.id} className="flex items-start justify-between gap-3">
              <dt className="min-w-0">
                <span className="block">{line.label}</span>
                {line.basis && (
                  <span className="block text-muted-foreground text-xs">{line.basis}</span>
                )}
                {line.overridden && (
                  <span className="block text-warning-text text-xs">
                    Changed from the computed figure
                  </span>
                )}
              </dt>
              <dd className="flex shrink-0 items-center gap-1">
                <span className="tabular-nums">{formatMoney(line.amount)}</span>
                {editable && (
                  <span className="flex print:hidden">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Change ${line.label}`}
                      onClick={() => onEdit(line)}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${line.label}`}
                      onClick={() => onRemove(line)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-2 flex justify-between gap-4 border-t pt-2 font-medium text-sm">
        <span>Total</span>
        <span className="tabular-nums">{formatMoney(total)}</span>
      </div>
    </div>
  );
}

export default function SettlementPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const canProcess = can('payroll.process');
  const canApprove = can('payroll.approve');
  const canPay = can('payroll.pay');

  const query = useQuery({
    queryKey: settlementKeys.detail(id),
    queryFn: () => settlementsApi.detail(id),
  });
  const activity = useQuery({
    queryKey: settlementKeys.activity(id),
    queryFn: () => settlementsApi.activity(id),
  });

  const [editing, setEditing] = useState<SettlementLine | null>(null);
  const [removing, setRemoving] = useState<SettlementLine | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<SettlementLineKindCode>('DEDUCTION');
  const [paymentRef, setPaymentRef] = useState('');

  const invalidate = [settlementKeys.detail(id), settlementKeys.activity(id), settlementKeys.all()];

  const editLine = useApiMutation({
    mutationFn: (input: { lineId: string; amount: number }) =>
      settlementsApi.updateLine(id, input.lineId, { amount: input.amount }),
    invalidate,
    success: 'Figure changed',
    onSuccess: () => setEditing(null),
  });
  const addLine = useApiMutation({
    mutationFn: (input: { kind: SettlementLineKindCode; label: string; amount: number }) =>
      settlementsApi.addLine(id, input),
    invalidate,
    success: 'Line added',
    onSuccess: () => setAdding(false),
  });
  const removeLine = useApiMutation({
    mutationFn: (lineId: string) => settlementsApi.removeLine(id, lineId),
    invalidate,
    success: 'Line removed',
    onSuccess: () => setRemoving(null),
  });
  const recompute = useApiMutation({
    mutationFn: () => settlementsApi.recompute(id),
    invalidate,
    success: 'Figures worked out again',
    onSuccess: () => setRecomputing(false),
  });
  const approve = useApiMutation({
    mutationFn: () => settlementsApi.approve(id, {}),
    invalidate,
    success: 'Settlement approved',
    onSuccess: () => setConfirmApprove(false),
  });
  const pay = useApiMutation({
    mutationFn: (ref: string) => settlementsApi.pay(id, { paymentRef: ref }),
    invalidate,
    success: 'Payment recorded',
    onSuccess: () => setPaying(false),
  });

  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (!query.data) return <Skeleton className="h-96 w-full rounded-xl" />;
  const s = query.data;

  const editable = s.status === 'DRAFT' && canProcess;
  const earnings = s.lines.filter((l) => l.kind === 'EARNING');
  const deductions = s.lines.filter((l) => l.kind === 'DEDUCTION');
  const who = `${s.employee.firstName} ${s.employee.lastName}`;

  const openEdit = (line: SettlementLine) => {
    setAmount(String(line.amount));
    setEditing(line);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/payroll/settlements" />}
        >
          <ArrowLeft className="size-4" aria-hidden /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <>
              <Button variant="outline" size="sm" onClick={() => setRecomputing(true)}>
                <RefreshCw className="size-4" aria-hidden /> Recompute
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden /> Add a line
              </Button>
            </>
          )}
          {s.status === 'DRAFT' && canApprove && (
            <Button size="sm" onClick={() => setConfirmApprove(true)}>
              Approve
            </Button>
          )}
          {s.status === 'APPROVED' && canPay && (
            <Button size="sm" onClick={() => setPaying(true)}>
              Record payment
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print / save as PDF
          </Button>
        </div>
      </div>

      <article className="rounded-xl border bg-card p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <h2 className="text-xl">Full &amp; final settlement</h2>
            <p className="mt-0.5 text-muted-foreground text-sm">
              {who} · {s.employee.employeeCode}
            </p>
          </div>
          <Badge className={cn('border-transparent', TONE[s.status])}>
            {SETTLEMENT_STATUS_LABELS[s.status]}
          </Badge>
        </header>

        <dl className="grid gap-x-8 gap-y-2 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Joined', showDate(s.joinDate)],
            ['Last working day', showDate(s.lastWorkingDate)],
            ['Monthly pay', formatMoney(s.monthlyPay)],
            ['A day of pay', formatMoney(s.perDayRate)],
          ].map(([labelText, value]) => (
            <div key={labelText}>
              <dt className="text-muted-foreground text-xs">{labelText}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-6 border-t py-4 sm:flex-row sm:gap-10">
          <LineRows
            title="Earnings"
            lines={earnings}
            total={s.totalEarnings}
            editable={editable}
            onEdit={openEdit}
            onRemove={setRemoving}
          />
          <LineRows
            title="Deductions"
            lines={deductions}
            total={s.totalDeductions}
            editable={editable}
            onEdit={openEdit}
            onRemove={setRemoving}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3">
          <span className="font-medium">
            {s.netPayable < 0 ? 'Due back from the employee' : 'Net payable'}
          </span>
          <span
            className={cn(
              'font-bold text-xl tabular-nums',
              s.netPayable < 0 && 'text-destructive-text',
            )}
          >
            {formatMoney(Math.abs(s.netPayable))}
          </span>
        </div>

        {s.netPayable < 0 && (
          <p className="mt-3 text-muted-foreground text-xs">
            The recovery comes to more than what is owed, so this settlement is a balance due back
            rather than a payment out.
          </p>
        )}

        {s.paymentRef && (
          <p className="mt-3 text-muted-foreground text-xs">
            Paid{s.paidAt ? ` on ${showDate(s.paidAt)}` : ''} · reference {s.paymentRef}
          </p>
        )}
        {s.cancelReason && (
          <p className="mt-3 text-muted-foreground text-xs">Cancelled — {s.cancelReason}</p>
        )}

        <p className="mt-6 text-muted-foreground text-xs">
          This is a computer-generated statement and does not require a signature. Tax on these
          amounts is not withheld here.
        </p>
      </article>

      {s.status === 'DRAFT' && (
        <Alert className="print:hidden">
          <Info className="size-4" aria-hidden />
          <AlertDescription>
            Nothing is owed until this is approved. Recomputing rebuilds the computed figures and
            keeps any line added by hand.
          </AlertDescription>
        </Alert>
      )}

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Who computed, changed, approved and paid it</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityTimeline
            entries={activity.data}
            loading={activity.isPending}
            error={activity.isError}
            onRetry={() => activity.refetch()}
          />
        </CardContent>
      </Card>

      {/* ── change one figure ── */}
      <FormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `Change ${editing.label}` : 'Change the figure'}
        description="The statement will say this figure was changed from the computed one."
        submitting={editLine.isPending}
        submitLabel="Save"
        submitDisabled={!Number.isFinite(Number(amount)) || Number(amount) < 0}
        onSubmit={(e) => {
          e.preventDefault();
          if (editing) editLine.mutate({ lineId: editing.id, amount: Number(amount) });
        }}
      >
        <Field label="Amount">
          {(field) => (
            <Input
              {...field}
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
      </FormDialog>

      {/* ── add a line ── */}
      <FormDialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (open) {
            setLabel('');
            setAmount('');
            setKind('DEDUCTION');
          }
        }}
        title="Add a line"
        description="For anything the calculator cannot know: a retention bonus, tax withheld, an asset nobody returned."
        submitting={addLine.isPending}
        submitLabel="Add"
        submitDisabled={!label.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0}
        onSubmit={(e) => {
          e.preventDefault();
          addLine.mutate({ kind, label: label.trim(), amount: Number(amount) });
        }}
      >
        <Field label="Side">
          {(field) => (
            <Select value={kind} onValueChange={(v) => setKind(v as SettlementLineKindCode)}>
              <SelectTrigger {...field}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EARNING">Earning — paid to them</SelectItem>
                <SelectItem value="DEDUCTION">Deduction — held back</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Description">
          {(field) => (
            <Input
              {...field}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Retention bonus"
            />
          )}
        </Field>
        <Field label="Amount">
          {(field) => (
            <Input
              {...field}
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
      </FormDialog>

      {/* ── record the payment ── */}
      <FormDialog
        open={paying}
        onOpenChange={(open) => {
          setPaying(open);
          if (open) setPaymentRef('');
        }}
        title="Record the payment"
        description={`${formatMoney(Math.abs(s.netPayable))} for ${who}. This closes the settlement — it cannot be edited afterwards.`}
        submitting={pay.isPending}
        submitLabel="Record payment"
        submitDisabled={!paymentRef.trim()}
        onSubmit={(e) => {
          e.preventDefault();
          pay.mutate(paymentRef.trim());
        }}
      >
        <Field
          label="Payment reference"
          hint="The bank reference, so this can be tied to a statement line."
        >
          {(field) => (
            <Input
              {...field}
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="NEFT-20261005-0042"
            />
          )}
        </Field>
      </FormDialog>

      {/* ── approve ── */}
      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {formatMoney(Math.abs(s.netPayable))}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing on this statement can be changed afterwards. Whoever can release the payment
              will be told it is ready.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction disabled={approve.isPending} onClick={() => approve.mutate()}>
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── recompute ── */}
      <AlertDialog open={recomputing} onOpenChange={setRecomputing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Work the figures out again?</AlertDialogTitle>
            <AlertDialogDescription>
              Every computed figure is thrown away and rebuilt from today's leave balance and
              salary, including any you changed by hand. Lines you added yourself are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={recompute.isPending} onClick={() => recompute.mutate()}>
              Recompute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── remove a line ── */}
      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.source === 'MANUAL'
                ? 'It was added by hand, so it cannot be brought back by recomputing.'
                : 'A recompute will put this line back.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeLine.isPending}
              onClick={() => removing && removeLine.mutate(removing.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
