'use client';

import {
  APPLICATION_STAGE_LABELS,
  applicationStageChangeSchema,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  interviewCreateSchema,
  OPENING_STATUS_LABELS,
  type OpeningStatusCode,
  offerCreateSchema,
  PIPELINE_STAGES,
  REJECTION_REASON_LABELS,
  REJECTION_REASONS,
} from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRightLeft,
  BadgeIndianRupee,
  CalendarPlus,
  Eye,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { ErrorState } from '@/components/error-state';
import { Field } from '@/components/field';
import {
  FormDatePicker,
  FormInput,
  FormSelect,
  FormTextarea,
  FormTimePicker,
} from '@/components/form';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import {
  fullName,
  type OpeningDetail,
  recruitmentApi,
  recruitmentKeys,
} from '@/features/recruitment/api';
import {
  OfferStatusBadge,
  OpeningStatusBadge,
  StageBadge,
} from '@/features/recruitment/components/recruitment-badges';
import { useJobOptions } from '@/features/recruitment/use-job-options';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

type Application = OpeningDetail['applications'][number];

/**
 * The stages a move dialog offers.
 *
 * HIRED is missing on purpose: it is not something you choose here, it is what
 * converting an accepted offer produces. Listing it would put a button on the
 * screen whose only outcome is a refusal.
 */
const MOVABLE = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'] as const;

/** Statuses somebody can set by hand. FILLED and CLOSED both check for live applications. */
const SETTABLE: OpeningStatusCode[] = ['DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED'];

/**
 * An interview happens at a moment, and people think of a moment as a day and
 * a time. The API wants one ISO instant, so the form asks the two questions a
 * person can answer and joins them — in the browser's own zone, which is where
 * the interviewer is.
 */
const interviewFormSchema = interviewCreateSchema
  .omit({ scheduledFor: true })
  .extend({ date: z.string().min(1, 'Which day?'), time: z.string().min(1, 'What time?') });

type InterviewValues = z.input<typeof interviewFormSchema>;
type MoveValues = z.input<typeof applicationStageChangeSchema>;
type OfferValues = z.input<typeof offerCreateSchema>;

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const showDate = (iso: string) => dateFmt.format(new Date(iso));
const today = () => new Date().toISOString().slice(0, 10);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export default function OpeningDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const canManageOpening = can('recruitment.opening.manage');
  const canManageCandidates = can('recruitment.candidate.manage');
  const canOffer = can('recruitment.offer.manage');
  const options = useJobOptions();

  const query = useQuery({
    queryKey: recruitmentKeys.opening(id),
    queryFn: () => recruitmentApi.opening(id),
  });

  // Only fetched once the dialog is open: a pool of candidates is a big list to
  // pull down for a screen most people are only reading.
  const [applying, setApplying] = useState(false);
  const candidates = useQuery({
    queryKey: recruitmentKeys.candidates({ page: 1, limit: 200 }),
    queryFn: () => recruitmentApi.candidates({ page: 1, limit: 200 }),
    enabled: applying,
  });

  const [moving, setMoving] = useState<Application | null>(null);
  const [interviewing, setInterviewing] = useState<Application | null>(null);
  const [offering, setOffering] = useState<Application | null>(null);
  const [candidateId, setCandidateId] = useState('');

  const invalidate = [recruitmentKeys.all()];

  const apply = useApiMutation({
    mutationFn: () => recruitmentApi.apply({ candidateId, openingId: id }),
    invalidate,
    success: 'Put forward',
    onSuccess: () => {
      setApplying(false);
      setCandidateId('');
    },
  });

  const setStatus = useApiMutation({
    mutationFn: (status: OpeningStatusCode) => recruitmentApi.setOpeningStatus(id, { status }),
    invalidate,
    success: (opening) => `Now ${OPENING_STATUS_LABELS[opening.status].toLowerCase()}`,
  });

  const moveForm = useZodForm<MoveValues>(applicationStageChangeSchema);
  const move = useApiMutation({
    mutationFn: (values: MoveValues) =>
      recruitmentApi.moveStage(
        // biome-ignore lint/style/noNonNullAssertion: the dialog only opens with a row
        moving!.id,
        applicationStageChangeSchema.parse(values),
      ),
    invalidate,
    success: 'Moved',
    onSuccess: () => setMoving(null),
  });

  const interviewForm = useZodForm<InterviewValues>(interviewFormSchema);
  const schedule = useApiMutation({
    mutationFn: (values: InterviewValues) => {
      const { date, time, ...rest } = interviewFormSchema.parse(values);
      return recruitmentApi.scheduleInterview({
        ...rest,
        // biome-ignore lint/style/noNonNullAssertion: the dialog only opens with a row
        applicationId: interviewing!.id,
        scheduledFor: new Date(`${date}T${time}`).toISOString(),
      });
    },
    invalidate,
    success: 'Interview booked',
    onSuccess: () => setInterviewing(null),
  });

  const offerForm = useZodForm<OfferValues>(offerCreateSchema);
  const makeOffer = useApiMutation({
    mutationFn: (values: OfferValues) =>
      recruitmentApi.createOffer({
        ...offerCreateSchema.parse(values),
        // biome-ignore lint/style/noNonNullAssertion: the dialog only opens with a row
        applicationId: offering!.id,
      }),
    invalidate,
    success: 'Offer drafted — send it when it is signed off',
    onSuccess: () => setOffering(null),
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState onRetry={() => query.refetch()} />;
  }

  const opening = query.data;
  const live = opening.applications.filter(
    (a) => !['HIRED', 'REJECTED', 'WITHDRAWN'].includes(a.stage),
  );
  const ended = opening.applications.filter((a) =>
    ['HIRED', 'REJECTED', 'WITHDRAWN'].includes(a.stage),
  );

  const stageMove = moveForm.watch('stage');
  const reason = moveForm.watch('rejectionReason');

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/recruitment" />}>
        <ArrowLeft className="size-4" aria-hidden /> All openings
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                {opening.title} <OpeningStatusBadge status={opening.status} />
              </CardTitle>
              <CardDescription>
                {opening.department?.name ?? 'No department'}
                {opening.location ? ` · ${opening.location.name}` : ''}
                {opening.employmentType ? ` · ${opening.employmentType.name}` : ''}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canManageCandidates && (
                <Button variant="outline" size="sm" onClick={() => setApplying(true)}>
                  <UserPlus className="size-4" aria-hidden /> Put someone forward
                </Button>
              )}
              {canManageOpening &&
                SETTABLE.filter((s) => s !== opening.status).map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate(s)}
                  >
                    {OPENING_STATUS_LABELS[s]}
                  </Button>
                ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Row label="To hire" value={opening.headcount} />
            <Row label="Live in pipeline" value={live.length} />
            <Row
              label="Band"
              value={
                opening.minMonthlyCtc === null && opening.maxMonthlyCtc === null ? (
                  <span className="text-muted-foreground">Not advertised</span>
                ) : (
                  <span className="tabular-nums">
                    {opening.minMonthlyCtc !== null ? formatMoney(opening.minMonthlyCtc) : '—'}
                    {' – '}
                    {opening.maxMonthlyCtc !== null ? formatMoney(opening.maxMonthlyCtc) : '—'}
                  </span>
                )
              }
            />
            <Row
              label="Hiring manager"
              value={
                opening.hiringManager ? (
                  <Link href={`/employees/${opening.hiringManager.id}`} className="hover:underline">
                    {fullName(opening.hiringManager)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Nobody yet</span>
                )
              }
            />
          </dl>
          {opening.description && (
            <p className="mt-4 whitespace-pre-wrap text-muted-foreground text-sm">
              {opening.description}
            </p>
          )}
        </CardContent>
      </Card>

      {/*
        Four columns, one per live stage. The endings are not columns — they are
        exits, and they get their own list below so a closed-out candidate does
        not sit in the board pretending to still be in play.
      */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_STAGES.map((stage) => {
          const inStage = live.filter((a) => a.stage === stage);
          return (
            <section key={stage} className="space-y-3 rounded-xl bg-muted/50 p-3">
              <h2 className="flex items-center justify-between font-medium text-sm">
                {APPLICATION_STAGE_LABELS[stage]}
                <span className="tabular-nums text-muted-foreground">{inStage.length}</span>
              </h2>

              {inStage.length === 0 && (
                <p className="text-muted-foreground text-xs">Nobody here.</p>
              )}

              {inStage.map((application) => (
                <article
                  key={application.id}
                  className="space-y-2 rounded-lg bg-card p-3 shadow-sm"
                >
                  <div>
                    <Link
                      href={`/recruitment/candidates/${application.candidate.id}`}
                      className="font-medium text-sm hover:underline"
                    >
                      {application.candidate.firstName} {application.candidate.lastName}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {application.candidate.currentTitle ?? 'No current title'}
                      {application.candidate.currentEmployer
                        ? ` at ${application.candidate.currentEmployer}`
                        : ''}
                    </p>
                  </div>

                  <dl className="space-y-0.5 text-xs">
                    {application.candidate.expectedMonthlyCtc !== null && (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Expects</dt>
                        <dd className="tabular-nums">
                          {formatMoney(application.candidate.expectedMonthlyCtc)}
                        </dd>
                      </div>
                    )}
                    {application.candidate.noticePeriodDays !== null && (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Notice</dt>
                        <dd className="tabular-nums">
                          {application.candidate.noticePeriodDays} days
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Interviews</dt>
                      <dd className="tabular-nums">{application._count.interviews}</dd>
                    </div>
                  </dl>

                  {application.offer && (
                    <Link
                      href={`/recruitment/offers/${application.offer.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs hover:bg-accent"
                    >
                      <span className="tabular-nums">
                        {formatMoney(application.offer.monthlyCtc)}
                      </span>
                      <OfferStatusBadge status={application.offer.status} />
                    </Link>
                  )}

                  <div className="flex items-center justify-end gap-0.5">
                    <IconAction
                      label={`View ${application.candidate.firstName} ${application.candidate.lastName}`}
                      icon={Eye}
                      size="icon-sm"
                      render={<Link href={`/recruitment/candidates/${application.candidate.id}`} />}
                    />
                    {canManageCandidates && (
                      <IconAction
                        label="Book an interview"
                        icon={CalendarPlus}
                        size="icon-sm"
                        onClick={() => {
                          interviewForm.reset({
                            applicationId: application.id,
                            date: today(),
                            time: '10:00',
                            durationMinutes: 45,
                            mode: 'VIDEO',
                          });
                          setInterviewing(application);
                        }}
                      />
                    )}
                    {canOffer && stage === 'OFFER' && !application.offer && (
                      <IconAction
                        label="Make an offer"
                        icon={BadgeIndianRupee}
                        size="icon-sm"
                        onClick={() => {
                          offerForm.reset({
                            applicationId: application.id,
                            departmentId: opening.departmentId ?? undefined,
                            designationId: opening.designationId ?? undefined,
                            locationId: opening.locationId ?? undefined,
                            employmentTypeId: opening.employmentTypeId ?? undefined,
                            monthlyCtc: application.candidate.expectedMonthlyCtc ?? undefined,
                            joinDate: '',
                          });
                          setOffering(application);
                        }}
                      />
                    )}
                    {canManageCandidates && (
                      <IconAction
                        label="Move to another stage"
                        icon={ArrowRightLeft}
                        size="icon-sm"
                        onClick={() => {
                          moveForm.reset({ stage: application.stage });
                          setMoving(application);
                        }}
                      />
                    )}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>

      {ended.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Closed out</CardTitle>
            <CardDescription>
              Kept, not deleted — a rejection is the record of a decision, and the reason is what
              tells a bad advert from a bad interview loop.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ended.map((application) => (
              <div
                key={application.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <Link
                  href={`/recruitment/candidates/${application.candidate.id}`}
                  className="font-medium hover:underline"
                >
                  {application.candidate.firstName} {application.candidate.lastName}
                </Link>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  {application.rejectionReason && (
                    <span>{REJECTION_REASON_LABELS[application.rejectionReason]}</span>
                  )}
                  {application.decidedAt && <span>{showDate(application.decidedAt)}</span>}
                  <StageBadge stage={application.stage} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <FormDialog
        open={applying}
        onOpenChange={setApplying}
        title="Put someone forward"
        description="Somebody already on file. Add them under Candidates first if they are not."
        submitting={apply.isPending}
        submitLabel="Put forward"
        submitDisabled={!candidateId}
        onSubmit={(e) => {
          e.preventDefault();
          if (candidateId) apply.mutate();
        }}
      >
        <Field label="Candidate" required>
          {(a11y) => (
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger {...a11y} aria-busy={candidates.isPending}>
                <SelectValue placeholder="Choose somebody" />
              </SelectTrigger>
              <SelectContent>
                {(candidates.data?.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} — {c.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={moving !== null}
        onOpenChange={(open) => !open && setMoving(null)}
        title={moving ? `Move ${moving.candidate.firstName} ${moving.candidate.lastName}` : 'Move'}
        description="Forwards, or back a step if a round is being redone. Rejecting asks why."
        submitting={move.isPending}
        submitLabel="Move"
        onSubmit={moveForm.handleSubmit((values) => move.mutate(values))}
      >
        <FormSelect control={moveForm.control} name="stage" label="Stage">
          {MOVABLE.map((s) => (
            <SelectItem key={s} value={s}>
              {APPLICATION_STAGE_LABELS[s]}
            </SelectItem>
          ))}
        </FormSelect>

        {stageMove === 'REJECTED' && (
          <FormSelect
            control={moveForm.control}
            name="rejectionReason"
            label="Why not"
            hint="Three months from now this is the only thing that explains the decision."
          >
            {REJECTION_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {REJECTION_REASON_LABELS[r]}
              </SelectItem>
            ))}
          </FormSelect>
        )}

        {stageMove === 'REJECTED' && (
          <FormTextarea
            control={moveForm.control}
            name="rejectionNote"
            label="Notes"
            placeholder={reason === 'OTHER' ? 'Required — say what happened' : 'Optional'}
            rows={3}
          />
        )}
      </FormDialog>

      <FormDialog
        open={interviewing !== null}
        onOpenChange={(open) => !open && setInterviewing(null)}
        title="Book an interview"
        description="The time is in your own timezone. Feedback is submitted afterwards, once."
        submitting={schedule.isPending}
        submitLabel="Book"
        onSubmit={interviewForm.handleSubmit((values) => schedule.mutate(values))}
      >
        <FormInput
          control={interviewForm.control}
          name="round"
          label="Round"
          placeholder="Technical, culture fit…"
        />
        <FormSelect
          control={interviewForm.control}
          name="interviewerId"
          label="Interviewer"
          emptyLabel="Not decided"
          emptyValue={undefined}
          busy={options.employees.isPending}
        >
          {(options.employees.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormDatePicker control={interviewForm.control} name="date" label="Day" min={today()} />
        <FormTimePicker control={interviewForm.control} name="time" label="Time" step={15} />
        <FormInput
          control={interviewForm.control}
          name="durationMinutes"
          label="Minutes"
          type="number"
          min={5}
        />
        <FormSelect control={interviewForm.control} name="mode" label="How">
          {INTERVIEW_MODES.map((m) => (
            <SelectItem key={m} value={m}>
              {INTERVIEW_MODE_LABELS[m]}
            </SelectItem>
          ))}
        </FormSelect>
      </FormDialog>

      <FormDialog
        open={offering !== null}
        onOpenChange={(open) => !open && setOffering(null)}
        title="Make an offer"
        description="Prefilled from the opening. It starts as a draft — nothing is sent yet."
        submitting={makeOffer.isPending}
        submitLabel="Draft the offer"
        onSubmit={offerForm.handleSubmit((values) => makeOffer.mutate(values))}
      >
        <FormInput
          control={offerForm.control}
          name="monthlyCtc"
          label="Monthly cost to company"
          type="number"
          min={1}
        />
        <FormDatePicker
          control={offerForm.control}
          name="joinDate"
          label="Start date"
          min={today()}
          hint="What the hire will use as their join date."
        />
        <FormDatePicker
          control={offerForm.control}
          name="expiresOn"
          label="Offer open until"
          min={today()}
        />
        <FormSelect
          control={offerForm.control}
          name="designationId"
          label="Designation"
          emptyLabel="As advertised"
          emptyValue={undefined}
          busy={options.designations.isPending}
        >
          {(options.designations.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect
          control={offerForm.control}
          name="departmentId"
          label="Department"
          emptyLabel="As advertised"
          emptyValue={undefined}
          busy={options.departments.isPending}
        >
          {(options.departments.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect
          control={offerForm.control}
          name="locationId"
          label="Location"
          emptyLabel="As advertised"
          emptyValue={undefined}
          busy={options.locations.isPending}
        >
          {(options.locations.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect
          control={offerForm.control}
          name="employmentTypeId"
          label="Employment type"
          emptyLabel="As advertised"
          emptyValue={undefined}
          busy={options.employmentTypes.isPending}
        >
          {(options.employmentTypes.options ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormTextarea
          control={offerForm.control}
          name="notes"
          label="Notes"
          placeholder="Optional — anything agreed that is not a field here."
          rows={3}
        />
      </FormDialog>
    </div>
  );
}
