'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITIONS,
  ASSET_MANUAL_STATUSES,
  ASSET_STATUS_LABELS,
  assetIssueSchema,
  assetReturnSchema,
  assetStatusChangeSchema,
} from '@hrms/shared';
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
import { ArrowLeft, PackageCheck, PackageOpen, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ActivityTimeline } from '@/components/activity-timeline';
import { FormDialog } from '@/components/crud/form-dialog';
import { ErrorState } from '@/components/error-state';
import { FormDatePicker, FormSelect, FormTextarea } from '@/components/form';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { assetKeys, assetsApi, holderOf } from '@/features/assets/api';
import { AssetStatusBadge } from '@/features/assets/components/asset-status-badge';
import { employeesApi } from '@/features/employees/api';
import { useApiMutation } from '@/hooks/use-crud';

type IssueValues = z.input<typeof assetIssueSchema>;
type ReturnValues = z.input<typeof assetReturnSchema>;
type StatusValues = z.input<typeof assetStatusChangeSchema>;

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

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const canAssign = can('asset.assign');
  const canManage = can('asset.manage');

  const query = useQuery({ queryKey: assetKeys.detail(id), queryFn: () => assetsApi.detail(id) });
  const activity = useQuery({
    queryKey: assetKeys.activity(id),
    queryFn: () => assetsApi.activity(id),
  });
  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => employeesApi.options(),
  });

  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState(false);
  const [changing, setChanging] = useState(false);

  const issueForm = useForm<IssueValues>({ resolver: zodResolver(assetIssueSchema) });
  const returnForm = useForm<ReturnValues>({ resolver: zodResolver(assetReturnSchema) });
  const statusForm = useForm<StatusValues>({ resolver: zodResolver(assetStatusChangeSchema) });

  const invalidate = [assetKeys.all()];

  const issue = useApiMutation({
    mutationFn: (values: IssueValues) => assetsApi.issue(id, assetIssueSchema.parse(values)),
    invalidate,
    success: 'Issued',
    onSuccess: () => setIssuing(false),
  });
  const takeBack = useApiMutation({
    mutationFn: (values: ReturnValues) => assetsApi.return(id, assetReturnSchema.parse(values)),
    invalidate,
    success: 'Taken back',
    onSuccess: () => setReturning(false),
  });
  const setStatus = useApiMutation({
    mutationFn: (values: StatusValues) =>
      assetsApi.setStatus(id, assetStatusChangeSchema.parse(values)),
    invalidate,
    success: 'Status changed',
    onSuccess: () => setChanging(false),
  });

  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (!query.data) return <Skeleton className="h-96 w-full rounded-xl" />;
  const asset = query.data;
  const holder = holderOf(asset);

  return (
    <Stagger className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/assets" />}>
          <ArrowLeft className="size-4" aria-hidden /> Back to the register
        </Button>

        <div className="flex flex-wrap gap-2">
          {canAssign && asset.status === 'IN_STOCK' && (
            <Button
              size="sm"
              onClick={() => {
                issueForm.reset({
                  employeeId: '',
                  issuedOn: today(),
                  conditionOut: asset.condition,
                });
                setIssuing(true);
              }}
            >
              <PackageOpen className="size-4" aria-hidden /> Issue it
            </Button>
          )}
          {canAssign && asset.status === 'ASSIGNED' && (
            <Button
              size="sm"
              onClick={() => {
                returnForm.reset({ returnedOn: today(), conditionIn: asset.condition });
                setReturning(true);
              }}
            >
              <PackageCheck className="size-4" aria-hidden /> Take it back
            </Button>
          )}
          {canManage && asset.status !== 'RETIRED' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                statusForm.reset({
                  status:
                    asset.status === 'ASSIGNED'
                      ? 'LOST'
                      : asset.status === 'IN_REPAIR'
                        ? 'IN_STOCK'
                        : 'IN_REPAIR',
                  reason: '',
                });
                setChanging(true);
              }}
            >
              <Wrench className="size-4" aria-hidden /> Change status
            </Button>
          )}
        </div>
      </div>

      <FadeInItem>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{asset.assetTag}</CardTitle>
                <CardDescription>
                  {asset.name}
                  {asset.category ? ` · ${asset.category.name}` : ''}
                </CardDescription>
              </div>
              <AssetStatusBadge status={asset.status} />
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Row label="Serial number" value={asset.serialNumber ?? '—'} />
              <Row
                label="Make and model"
                value={[asset.make, asset.model].filter(Boolean).join(' ') || '—'}
              />
              <Row label="Condition" value={ASSET_CONDITION_LABELS[asset.condition]} />
              <Row
                label="Held by"
                value={
                  holder ? (
                    <Link href={`/employees/${holder.id}`} className="hover:underline">
                      {holder.firstName} {holder.lastName}
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <Row
                label="Purchased"
                value={asset.purchaseDate ? showDate(asset.purchaseDate) : '—'}
              />
              <Row
                label="Warranty until"
                value={asset.warrantyEnd ? showDate(asset.warrantyEnd) : '—'}
              />
              <Row label="Vendor" value={asset.vendor ?? '—'} />
              <Row label="Location" value={asset.location?.name ?? '—'} />
            </dl>
            {asset.notes && <p className="mt-4 text-muted-foreground text-sm">{asset.notes}</p>}
          </CardContent>
        </Card>
      </FadeInItem>

      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Who has had it</CardTitle>
            <CardDescription>
              Every spell somebody held this, newest first. Returned rows stay, so the register can
              answer who had it in March.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {asset.assignments.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody has been issued this yet.</p>
            ) : (
              <ul className="space-y-3">
                {asset.assignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-start justify-between gap-2 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {a.employee ? (
                          <Link href={`/employees/${a.employee.id}`} className="hover:underline">
                            {a.employee.firstName} {a.employee.lastName}
                          </Link>
                        ) : (
                          'Somebody who has since been removed'
                        )}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {showDate(a.issuedOn)} →{' '}
                        {a.returnedOn ? showDate(a.returnedOn) : 'still out'}
                      </p>
                      {a.notes && <p className="mt-1 text-muted-foreground text-xs">{a.notes}</p>}
                    </div>
                    <p className="shrink-0 text-muted-foreground text-xs">
                      Out {ASSET_CONDITION_LABELS[a.conditionOut].toLowerCase()}
                      {a.conditionIn
                        ? ` · back ${ASSET_CONDITION_LABELS[a.conditionIn].toLowerCase()}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </FadeInItem>

      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Everything recorded against this asset</CardDescription>
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
      </FadeInItem>

      {/* ── issue ── */}
      <FormDialog
        open={issuing}
        onOpenChange={setIssuing}
        title={`Issue ${asset.assetTag}`}
        description="Recorded against them until it comes back — including on their exit clearance."
        submitting={issue.isPending}
        submitLabel="Issue"
        onSubmit={issueForm.handleSubmit((values) => issue.mutate(values))}
      >
        <FormSelect
          control={issueForm.control}
          name="employeeId"
          label="Issue to"
          busy={employees.isPending}
        >
          {(employees.data ?? []).map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.firstName} {e.lastName} · {e.employeeCode}
            </SelectItem>
          ))}
        </FormSelect>
        <FormDatePicker
          control={issueForm.control}
          name="issuedOn"
          label="Issued on"
          placeholder="Select the date"
        />
        <FormSelect
          control={issueForm.control}
          name="conditionOut"
          label="Condition going out"
          hint="What it comes back in is compared against this."
        >
          {ASSET_CONDITIONS.map((c) => (
            <SelectItem key={c} value={c}>
              {ASSET_CONDITION_LABELS[c]}
            </SelectItem>
          ))}
        </FormSelect>
        <FormTextarea
          control={issueForm.control}
          name="notes"
          label="Notes"
          placeholder="Charger and sleeve included"
        />
      </FormDialog>

      {/* ── return ── */}
      <FormDialog
        open={returning}
        onOpenChange={setReturning}
        title={`Take back ${asset.assetTag}`}
        description={
          holder ? `${holder.firstName} ${holder.lastName} has had it since it was issued.` : ''
        }
        submitting={takeBack.isPending}
        submitLabel="Take it back"
        onSubmit={returnForm.handleSubmit((values) => takeBack.mutate(values))}
      >
        <FormDatePicker
          control={returnForm.control}
          name="returnedOn"
          label="Returned on"
          placeholder="Select the date"
        />
        <FormSelect
          control={returnForm.control}
          name="conditionIn"
          label="Condition coming back"
          hint="Recorded, so a disagreement later has a fact to point at."
        >
          {ASSET_CONDITIONS.map((c) => (
            <SelectItem key={c} value={c}>
              {ASSET_CONDITION_LABELS[c]}
            </SelectItem>
          ))}
        </FormSelect>
        <FormTextarea
          control={returnForm.control}
          name="notes"
          label="Notes"
          placeholder="Charger missing"
        />
      </FormDialog>

      {/* ── status ── */}
      <FormDialog
        open={changing}
        onOpenChange={setChanging}
        title={`Change what ${asset.assetTag} is`}
        description={
          asset.status === 'ASSIGNED'
            ? 'Somebody is still holding this, so only "lost" applies — and it closes their assignment.'
            : 'Back in stock, in repair, lost or retired. Retiring is final.'
        }
        submitting={setStatus.isPending}
        submitLabel="Change it"
        onSubmit={statusForm.handleSubmit((values) => setStatus.mutate(values))}
      >
        <FormSelect control={statusForm.control} name="status" label="Mark it">
          {/* Mirrors the service rule, so a choice is never a guaranteed error:
              never the status it already has, and only "lost" while somebody
              is holding it. */}
          {ASSET_MANUAL_STATUSES.filter(
            (s) => s !== asset.status && (asset.status !== 'ASSIGNED' || s === 'LOST'),
          ).map((s) => (
            <SelectItem key={s} value={s}>
              {ASSET_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </FormSelect>
        <FormTextarea
          control={statusForm.control}
          name="reason"
          label="Why"
          placeholder="Screen flickers — sent to the vendor"
        />
      </FormDialog>
    </Stagger>
  );
}
