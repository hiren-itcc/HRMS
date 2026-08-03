'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type BankDetailInput,
  bankDetailSchema,
  type EmployeeRoleChangeInput,
  employeeRoleChangeSchema,
} from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@hrms/ui/components/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@hrms/ui/components/avatar';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Landmark, Pencil, ShieldAlert, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/components/field';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { DocumentsBrowser } from '@/features/documents/documents-browser';
import { employeesApi } from '@/features/employees/api';
import { EmployeeStatusBadge } from '@/features/employees/components/status-badge';
import { ROLE_LABEL, ROLE_OPTIONS } from '@/features/employees/role-options';
import { type EmployeeDetail, fullName, initials } from '@/features/employees/types';
import { LettersPanel } from '@/features/letters/components/letters-panel';
import { InviteCard } from '@/features/onboarding/components/invite-card';
import { ApiError } from '@/lib/api-client';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:justify-between">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-medium text-sm sm:text-right">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * The Role row, with a Change action for admins.
 *
 * Mirrors the server's guards rather than duplicating policy: the action is
 * hidden without `role.manage`, when the person has no login (nothing to
 * change), and on your own record — the server refuses that last one, and a
 * button whose only outcome is a 403 is worse than no button.
 */
function RoleRow({ employee }: { employee: EmployeeDetail }) {
  const { can, user: me } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<EmployeeRoleChangeInput>({
    resolver: zodResolver(employeeRoleChangeSchema),
  });

  const save = useMutation({
    mutationFn: (input: EmployeeRoleChangeInput) => employeesApi.setRole(employee.id, input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success(`Role changed to ${ROLE_LABEL[result.roleCode]}`, {
        description: result.sessionsRevoked
          ? 'They have been signed out and pick up the new role next time they sign in.'
          : undefined,
      });
      setOpen(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not change role'),
  });

  const current = employee.user?.role?.code;
  const canChange = can('role.manage') && !!employee.user && employee.user.id !== me?.id;

  return (
    <>
      <Row
        label="Role"
        value={
          employee.user ? (
            <span className="inline-flex items-center gap-2">
              {current ? ROLE_LABEL[current] : '—'}
              {canChange && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => {
                    form.reset({ roleCode: current ?? 'EMPLOYEE' });
                    setOpen(true);
                  }}
                >
                  Change
                </Button>
              )}
            </span>
          ) : null
        }
      />

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Change role for ${fullName(employee)}`}
        onSubmit={form.handleSubmit((input) => save.mutate(input))}
        submitting={save.isPending}
        submitLabel="Change role"
      >
        <Field label="Role" error={form.formState.errors.roleCode?.message}>
          {(a11y) => (
            <Select
              value={form.watch('roleCode')}
              onValueChange={(value) =>
                form.setValue('roleCode', value as EmployeeRoleChangeInput['roleCode'])
              }
            >
              <SelectTrigger id={a11y.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        {form.watch('roleCode') === 'ADMIN' && (
          <Alert variant="info">
            <ShieldAlert aria-hidden />
            <AlertTitle>Admin can do everything</AlertTitle>
            <AlertDescription>
              Including editing roles, reading every salary and changing settings.
            </AlertDescription>
          </Alert>
        )}
        <p className="text-muted-foreground text-sm">
          Changing this signs them out. They pick up the new permissions when they sign in again.
        </p>
      </FormDialog>
    </>
  );
}

function BankCard({ employee }: { employee: EmployeeDetail }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<BankDetailInput>({ resolver: zodResolver(bankDetailSchema) });
  const bank = employee.bankDetail;

  const save = useMutation({
    mutationFn: (input: BankDetailInput) => employeesApi.upsertBank(employee.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Bank details saved');
      setOpen(false);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not save bank details'),
  });

  // undefined = hidden by the API (no permission); null = none stored yet
  if (bank === undefined && !can('employee.update')) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="size-4 text-muted-foreground" aria-hidden /> Bank details
            </CardTitle>
            <CardDescription>Visible to HR, Admin and the employee</CardDescription>
          </div>
          {can('employee.update') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                form.reset({
                  accountHolderName: bank?.accountHolderName ?? fullName(employee),
                  bankName: bank?.bankName ?? '',
                  accountNumber: bank?.accountNumber ?? '',
                  ifscCode: bank?.ifscCode ?? '',
                  branch: bank?.branch ?? '',
                });
                setOpen(true);
              }}
            >
              <Pencil className="size-3.5" aria-hidden /> {bank ? 'Edit' : 'Add'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {bank ? (
          <dl className="divide-y">
            <Row label="Account holder" value={bank.accountHolderName} />
            <Row label="Bank" value={bank.bankName} />
            <Row
              label="Account number"
              value={<span className="font-mono">{bank.accountNumber}</span>}
            />
            <Row label="IFSC" value={bank.ifscCode} />
            <Row label="Branch" value={bank.branch} />
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">No bank details on file.</p>
        )}
      </CardContent>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={bank ? 'Edit bank details' : 'Add bank details'}
        onSubmit={form.handleSubmit((input) => save.mutate(input))}
        submitting={save.isPending}
        submitLabel="Save"
      >
        <Field label="Account holder" error={form.formState.errors.accountHolderName?.message}>
          {(a11y) => <Input {...a11y} {...form.register('accountHolderName')} />}
        </Field>
        <Field label="Bank name" error={form.formState.errors.bankName?.message}>
          {(a11y) => <Input {...a11y} {...form.register('bankName')} />}
        </Field>
        <Field label="Account number" error={form.formState.errors.accountNumber?.message}>
          {(a11y) => <Input {...a11y} inputMode="numeric" {...form.register('accountNumber')} />}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="IFSC code" error={form.formState.errors.ifscCode?.message}>
            {(a11y) => <Input {...a11y} {...form.register('ifscCode')} />}
          </Field>
          <Field label="Branch" error={form.formState.errors.branch?.message}>
            {(a11y) => <Input {...a11y} {...form.register('branch')} />}
          </Field>
        </div>
      </FormDialog>
    </Card>
  );
}

function EmployeeDetailView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const queryClient = useQueryClient();

  const employee = useQuery({
    queryKey: ['employees', 'detail', id],
    queryFn: () => employeesApi.detail(id),
    retry: false,
  });

  const remove = useMutation({
    mutationFn: () => employeesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Employee removed');
      router.replace('/employees');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not delete'),
  });

  if (employee.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (employee.isError || !employee.data) {
    /*
     * This page is the HR record. Someone who cannot open it usually just
     * wanted to find a colleague, so send them to the directory rather than
     * back to a roster they also cannot read.
     */
    const toDirectory = !can('employee.read') && !can('employee.read.team');
    return (
      <div className="py-24 text-center">
        <p className="font-medium">
          {toDirectory
            ? 'This is the HR record, which your role does not cover'
            : 'Employee not found or not visible to you'}
        </p>
        {toDirectory && (
          <p className="mt-1 text-muted-foreground text-sm">
            Their work contact details are in the directory.
          </p>
        )}
        <Button
          variant="outline"
          className="mt-4"
          render={<Link href={toDirectory ? `/directory/${id}` : '/employees'} />}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {toDirectory ? 'Open in the directory' : 'Back to employees'}
        </Button>
      </div>
    );
  }
  const e = employee.data;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/employees" />}>
        <ArrowLeft className="size-4" aria-hidden /> Employees
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="size-14">
            {e.avatarUrl && <AvatarImage src={e.avatarUrl} alt="" />}
            <AvatarFallback className="text-lg">{initials(e)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="flex flex-wrap items-center gap-2">
              {fullName(e)} <EmployeeStatusBadge status={e.status} />
            </h1>
            <p className="text-muted-foreground text-sm">
              {e.designation?.title ?? 'No designation'} ·{' '}
              <span className="font-mono text-xs">{e.employeeCode}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {can('employee.update') && (
            <Button variant="outline" render={<Link href={`/employees/${e.id}/edit`} />}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
          )}
          {can('employee.delete') && (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="outline" className="text-destructive hover:text-destructive" />
                }
              >
                <Trash2 className="size-4" aria-hidden /> Delete
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {fullName(e)}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The record is archived (soft delete): history is kept for audits, any login is
                    suspended, and the employee disappears from lists. This can only be reversed by
                    an administrator in the database.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground [background-image:none] hover:bg-destructive/90"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    Delete employee
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <Stagger className="grid items-start gap-6 lg:grid-cols-2">
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row
                  label="Work email"
                  value={
                    <a href={`mailto:${e.workEmail}`} className="hover:underline">
                      {e.workEmail}
                    </a>
                  }
                />
                <Row label="Personal email" value={e.personalEmail} />
                <Row label="Phone" value={e.phone} />
                <Row
                  label="Address"
                  value={[e.addressLine, e.city, e.country].filter(Boolean).join(', ') || null}
                />
              </dl>
            </CardContent>
          </Card>
        </FadeInItem>

        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Job</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Department" value={e.department?.name} />
                <Row label="Location" value={e.location?.name} />
                <Row label="Employment type" value={e.employmentType?.name} />
                <Row label="Shift" value={e.shift?.name} />
                <Row
                  label="Reporting manager"
                  value={
                    e.manager ? (
                      <Link href={`/employees/${e.manager.id}`} className="hover:underline">
                        {fullName(e.manager)}
                      </Link>
                    ) : null
                  }
                />
                <Row label="Joining date" value={dateFmt.format(new Date(e.joinDate))} />
                <Row
                  label="Login"
                  value={e.user ? `${e.user.email} (${e.user.status.toLowerCase()})` : 'No account'}
                />
                <RoleRow employee={e} />
              </dl>
            </CardContent>
          </Card>
        </FadeInItem>

        {/* Renders nothing unless this person is mid-onboarding. */}
        <FadeInItem>
          <InviteCard employeeId={e.id} />
        </FadeInItem>

        <FadeInItem>
          <BankCard employee={e} />
        </FadeInItem>

        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>Contracts, ID proofs and certificates on file</CardDescription>
            </CardHeader>
            <CardContent>
              <DocumentsBrowser employeeId={e.id} compact />
            </CardContent>
          </Card>
        </FadeInItem>

        {(can('letter.read') || can('letter.issue')) && (
          <FadeInItem>
            <Card>
              <CardHeader>
                <CardTitle>Letters</CardTitle>
                <CardDescription>
                  Offer, appointment, experience and salary letters issued to this employee
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LettersPanel employeeId={e.id} employeeName={fullName(e)} />
              </CardContent>
            </Card>
          </FadeInItem>
        )}

        {e.reports.length > 0 && (
          <FadeInItem>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" aria-hidden /> Direct reports (
                  {e.reports.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {e.reports.map((r) => (
                  <Link
                    key={r.id}
                    href={`/employees/${r.id}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{fullName(r)}</span>
                    <span className="text-muted-foreground text-xs">
                      {r.designation?.title ?? r.employeeCode}
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </FadeInItem>
        )}
      </Stagger>
    </div>
  );
}

export default function EmployeeDetailPage() {
  return <EmployeeDetailView />;
}
