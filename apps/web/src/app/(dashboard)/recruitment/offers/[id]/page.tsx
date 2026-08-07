'use client';

import { hireSchema, offerRespondSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { SelectItem } from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MailCheck, Send, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { ErrorState } from '@/components/error-state';
import { FormInput, FormSelect, FormTextarea } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import { recruitmentApi, recruitmentKeys } from '@/features/recruitment/api';
import { OfferStatusBadge } from '@/features/recruitment/components/recruitment-badges';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

type RespondValues = z.input<typeof offerRespondSchema>;
type HireValues = z.input<typeof hireSchema>;

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export default function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const canManage = can('recruitment.offer.manage');
  const canHire = can('recruitment.hire');

  const query = useQuery({
    queryKey: recruitmentKeys.offer(id),
    queryFn: () => recruitmentApi.offer(id),
  });

  const [responding, setResponding] = useState(false);
  const [hiring, setHiring] = useState(false);

  const invalidate = [recruitmentKeys.all()];

  const send = useApiMutation({
    mutationFn: () => recruitmentApi.sendOffer(id),
    invalidate,
    success: 'Marked as sent',
  });

  const respondForm = useZodForm<RespondValues>(offerRespondSchema);
  const respond = useApiMutation({
    mutationFn: (values: RespondValues) =>
      recruitmentApi.respondToOffer(id, offerRespondSchema.parse(values)),
    invalidate,
    success: 'Recorded',
    onSuccess: () => setResponding(false),
  });

  const hireForm = useZodForm<HireValues>(hireSchema);
  const hire = useApiMutation({
    mutationFn: (values: HireValues) => recruitmentApi.hire(id, hireSchema.parse(values)),
    invalidate,
    onSuccess: (result) => {
      setHiring(false);
      // The invite is deliberately not allowed to fail the hire — the employee
      // record exists either way, and HR can resend from the onboarding screen.
      // Saying which happened is the difference between "done" and "done, and
      // go and chase this".
      if (result.inviteSent) {
        toast.success(`Hired as ${result.employee.employeeCode} — invite sent`);
      } else {
        toast.warning(
          `Hired as ${result.employee.employeeCode}, but the invite did not send. Resend it from Onboarding.`,
        );
      }
    },
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  const offer = query.data;
  const candidate = offer.application.candidate;
  const alreadyHired = offer.hiredEmployeeId !== null;

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        render={<Link href={`/recruitment/openings/${offer.application.opening.id}`} />}
      >
        <ArrowLeft className="size-4" aria-hidden /> {offer.application.opening.title}
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Link href={`/recruitment/candidates/${candidate.id}`} className="hover:underline">
                  {candidate.firstName} {candidate.lastName}
                </Link>
                <OfferStatusBadge status={offer.status} />
              </CardTitle>
              <CardDescription>
                {offer.application.opening.title}
                {offer.designation ? ` · ${offer.designation.title}` : ''}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canManage && offer.status === 'DRAFT' && (
                <Button size="sm" disabled={send.isPending} onClick={() => send.mutate()}>
                  <Send className="size-4" aria-hidden /> Mark as sent
                </Button>
              )}
              {canManage && offer.status === 'SENT' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    respondForm.reset({ status: 'ACCEPTED', notes: undefined });
                    setResponding(true);
                  }}
                >
                  <MailCheck className="size-4" aria-hidden /> Record their answer
                </Button>
              )}
              {canHire && offer.status === 'ACCEPTED' && !alreadyHired && (
                <Button
                  size="sm"
                  onClick={() => {
                    hireForm.reset({ workEmail: '', employeeCode: undefined });
                    setHiring(true);
                  }}
                >
                  <UserCheck className="size-4" aria-hidden /> Hire them
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Row
              label="Monthly cost to company"
              value={<span className="tabular-nums">{formatMoney(offer.monthlyCtc)}</span>}
            />
            <Row label="Start date" value={showDate(offer.joinDate)} />
            <Row label="Open until" value={offer.expiresOn ? showDate(offer.expiresOn) : '—'} />
            <Row label="Department" value={offer.department?.name ?? '—'} />
            <Row label="Location" value={offer.location?.name ?? '—'} />
            <Row label="Employment type" value={offer.employmentType?.name ?? '—'} />
            <Row label="Sent" value={offer.sentAt ? showDate(offer.sentAt) : 'Not yet'} />
            <Row
              label="Answered"
              value={offer.respondedAt ? showDate(offer.respondedAt) : 'Not yet'}
            />
          </dl>

          {offer.notes && (
            <p className="mt-4 whitespace-pre-wrap text-muted-foreground text-sm">{offer.notes}</p>
          )}
        </CardContent>
      </Card>

      {alreadyHired && offer.hiredEmployee && (
        <Card>
          <CardHeader>
            <CardTitle>Hired</CardTitle>
            <CardDescription>
              They are now {offer.hiredEmployee.employeeCode} and waiting on their onboarding
              checklist. The invite went to their personal address — their work mailbox did not
              exist when it was sent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/employees/${offer.hiredEmployee.id}`} />}
            >
              Open their record
            </Button>
          </CardContent>
        </Card>
      )}

      <FormDialog
        open={responding}
        onOpenChange={setResponding}
        title="What did they say?"
        description="Declining or withdrawing closes the application. Accepting does not — the hire is a separate, deliberate step."
        submitting={respond.isPending}
        submitLabel="Record"
        onSubmit={respondForm.handleSubmit((values) => respond.mutate(values))}
      >
        <FormSelect control={respondForm.control} name="status" label="Their answer">
          <SelectItem value="ACCEPTED">They accepted</SelectItem>
          <SelectItem value="DECLINED">They declined</SelectItem>
          <SelectItem value="WITHDRAWN">We withdrew it</SelectItem>
        </FormSelect>
        <FormTextarea
          control={respondForm.control}
          name="notes"
          label="Notes"
          placeholder="Optional — what they said, or why it was withdrawn."
          rows={3}
        />
      </FormDialog>

      <FormDialog
        open={hiring}
        onOpenChange={setHiring}
        title={`Hire ${candidate.firstName} ${candidate.lastName}`}
        description="This creates their employee record and emails a sign-in invite. It runs through the same onboarding as any other new starter."
        submitting={hire.isPending}
        submitLabel="Hire"
        onSubmit={hireForm.handleSubmit((values) => hire.mutate(values))}
      >
        <FormInput
          control={hireForm.control}
          name="workEmail"
          placeholder="nadia.rahman@acme.com"
          label="Work email"
          type="email"
          hint={`The only thing that has to be typed — everything else comes from the offer. The invite itself goes to ${candidate.email}.`}
        />
        <FormInput
          control={hireForm.control}
          name="employeeCode"
          label="Employee code"
          placeholder="Leave blank to generate the next one"
        />
        <p className="rounded-md bg-muted p-3 text-muted-foreground text-sm">
          Starting {showDate(offer.joinDate)} on {formatMoney(offer.monthlyCtc)} a month
          {offer.department ? `, in ${offer.department.name}` : ''}.
        </p>
      </FormDialog>
    </div>
  );
}
