'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type BankDetailInput,
  bankDetailSchema,
  type OnboardingProfileInput,
  onboardingProfileSchema,
} from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { DatePicker } from '@hrms/ui/components/date-picker';
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
import { CheckCircle2, Circle, Info, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Field } from '@/components/field';
import { FadeInItem, Stagger } from '@/components/motion';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/components/session-provider';
import { DocumentsBrowser } from '@/features/documents/documents-browser';
import { onboardingApi, onboardingKeys } from '@/features/onboarding/api';
import { OnboardingDocuments } from '@/features/onboarding/components/onboarding-documents';
import { ApiError } from '@/lib/api-client';

/**
 * The new hire's own intake.
 *
 * Everything here is refused by the API once HR has the record, so the page
 * mirrors that: submitted and approved states are read-only, and the
 * outstanding list comes from the server rather than being re-derived here.
 */
export default function OnboardingPage() {
  const queryClient = useQueryClient();
  const { user, reload } = useSession();

  const record = useQuery({ queryKey: onboardingKeys.mine(), queryFn: onboardingApi.mine });

  const profileForm = useForm<OnboardingProfileInput>({
    resolver: zodResolver(onboardingProfileSchema),
  });
  const bankForm = useForm<BankDetailInput>({ resolver: zodResolver(bankDetailSchema) });

  const employee = record.data?.employee;
  useEffect(() => {
    if (!employee) return;
    profileForm.reset({
      dateOfBirth: employee.dateOfBirth?.slice(0, 10) ?? '',
      gender: (employee.gender as OnboardingProfileInput['gender']) ?? undefined,
      phone: employee.phone ?? '',
      addressLine: employee.addressLine ?? '',
      city: employee.city ?? '',
      country: employee.country ?? '',
      hasPreviousEmployment: record.data?.hasPreviousEmployment ?? undefined,
    });
    if (employee.bankDetail) {
      bankForm.reset({
        ...employee.bankDetail,
        ifscCode: employee.bankDetail.ifscCode ?? '',
        branch: employee.bankDetail.branch ?? '',
      });
    }
  }, [employee, record.data?.hasPreviousEmployment, profileForm, bankForm]);

  const saveProfile = useMutation({
    mutationFn: onboardingApi.updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all() });
      toast.success('Details saved');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save'),
  });

  const saveBank = useMutation({
    mutationFn: onboardingApi.setBank,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all() });
      toast.success('Bank details saved');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save'),
  });

  const submit = useMutation({
    mutationFn: onboardingApi.submit,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all() });
      toast.success('Sent to HR for review');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not submit — check the list'),
  });

  const approvedJustNow = record.data?.status === 'APPROVED';
  useEffect(() => {
    // Approval revoked their sessions, so a reload picks up a token without
    // the onboarding claim and the rest of the app opens up.
    if (approvedJustNow) void reload();
  }, [approvedJustNow, reload]);

  if (record.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!record.data) return null;

  const open = record.data.status === 'IN_PROGRESS';
  const missing = record.data.missing ?? [];

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <PageHeader
          title={`Welcome, ${employee?.firstName ?? ''}`}
          description="A few details before your first day. Your HR team checks them once you submit."
        />
      </FadeInItem>

      {record.data.status === 'SUBMITTED' && (
        <FadeInItem>
          <Alert variant="info">
            <Info aria-hidden />
            <AlertTitle>With HR</AlertTitle>
            <AlertDescription>
              Nothing more to do — you will hear back once it has been checked.
            </AlertDescription>
          </Alert>
        </FadeInItem>
      )}

      {record.data.reviewNote && open && (
        <FadeInItem>
          <Alert variant="warning">
            <Info aria-hidden />
            <AlertTitle>HR asked for a change</AlertTitle>
            <AlertDescription>{record.data.reviewNote}</AlertDescription>
          </Alert>
        </FadeInItem>
      )}

      {open && missing.length > 0 && (
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle>Still needed</CardTitle>
              <CardDescription>You can submit once these are done</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {missing.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-muted-foreground">
                    <Circle className="size-4 shrink-0" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </FadeInItem>
      )}

      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>About you</CardTitle>
            <CardDescription>Your sign-in is {employee?.workEmail}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={profileForm.handleSubmit((v) => saveProfile.mutate(v))}
            >
              <Field
                label="Date of birth"
                error={profileForm.formState.errors.dateOfBirth?.message}
              >
                {(a11y) => (
                  <DatePicker
                    {...a11y}
                    disabled={!open}
                    value={profileForm.watch('dateOfBirth')}
                    onValueChange={(value) =>
                      profileForm.setValue('dateOfBirth', value, { shouldDirty: true })
                    }
                    placeholder="Select date of birth"
                  />
                )}
              </Field>
              <Field label="Gender">
                {(a11y) => (
                  <Select
                    value={profileForm.watch('gender') ?? ''}
                    onValueChange={(v) =>
                      profileForm.setValue('gender', v as OnboardingProfileInput['gender'])
                    }
                    disabled={!open}
                  >
                    <SelectTrigger {...a11y} className="w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MALE">Male</SelectItem>
                      <SelectItem value="FEMALE">Female</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                      <SelectItem value="PREFER_NOT_TO_SAY">Prefer not to say</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Phone">
                {(a11y) => <Input {...a11y} disabled={!open} {...profileForm.register('phone')} />}
              </Field>
              <Field label="Address">
                {(a11y) => (
                  <Input {...a11y} disabled={!open} {...profileForm.register('addressLine')} />
                )}
              </Field>
              <Field label="City">
                {(a11y) => <Input {...a11y} disabled={!open} {...profileForm.register('city')} />}
              </Field>
              <Field label="Country">
                {(a11y) => (
                  <Input {...a11y} disabled={!open} {...profileForm.register('country')} />
                )}
              </Field>

              <Field label="Is this your first job?">
                {(a11y) => (
                  <Select
                    value={
                      profileForm.watch('hasPreviousEmployment') === undefined
                        ? ''
                        : profileForm.watch('hasPreviousEmployment')
                          ? 'no'
                          : 'yes'
                    }
                    onValueChange={(v) => profileForm.setValue('hasPreviousEmployment', v === 'no')}
                    disabled={!open}
                  >
                    <SelectTrigger {...a11y} className="w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes — this is my first job</SelectItem>
                      <SelectItem value="no">No — I have worked before</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>

              {open && (
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={saveProfile.isPending}>
                    {saveProfile.isPending && (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    )}
                    Save details
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </FadeInItem>

      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Bank account</CardTitle>
            <CardDescription>Where your salary will be paid</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={bankForm.handleSubmit((v) => saveBank.mutate(v))}
            >
              <Field
                label="Account holder"
                error={bankForm.formState.errors.accountHolderName?.message}
              >
                {(a11y) => (
                  <Input {...a11y} disabled={!open} {...bankForm.register('accountHolderName')} />
                )}
              </Field>
              <Field label="Bank" error={bankForm.formState.errors.bankName?.message}>
                {(a11y) => <Input {...a11y} disabled={!open} {...bankForm.register('bankName')} />}
              </Field>
              <Field
                label="Account number"
                error={bankForm.formState.errors.accountNumber?.message}
              >
                {(a11y) => (
                  <Input {...a11y} disabled={!open} {...bankForm.register('accountNumber')} />
                )}
              </Field>
              <Field label="IFSC">
                {(a11y) => <Input {...a11y} disabled={!open} {...bankForm.register('ifscCode')} />}
              </Field>
              {open && (
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={saveBank.isPending}>
                    {saveBank.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    Save bank details
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </FadeInItem>

      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>
              Upload against each item — a file on its own cannot tell us which requirement it
              answers
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {user?.employee?.id && (
              <OnboardingDocuments
                record={record.data}
                employeeId={user.employee.id}
                disabled={!open}
              />
            )}

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                All my uploaded files
              </summary>
              <div className="pt-3">
                {user?.employee?.id && <DocumentsBrowser employeeId={user.employee.id} compact />}
              </div>
            </details>
          </CardContent>
        </Card>
      </FadeInItem>

      {open && (
        <FadeInItem>
          <Button
            size="lg"
            disabled={submit.isPending || missing.length > 0}
            onClick={() => submit.mutate()}
          >
            {submit.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {missing.length > 0 ? `${missing.length} still to do` : 'Submit to HR'}
          </Button>
        </FadeInItem>
      )}

      {record.data.status === 'APPROVED' && (
        <FadeInItem>
          <Alert variant="success">
            <CheckCircle2 aria-hidden />
            <AlertTitle>All done</AlertTitle>
            <AlertDescription>
              Your onboarding was approved. The rest of the app is open to you now.
            </AlertDescription>
          </Alert>
        </FadeInItem>
      )}
    </Stagger>
  );
}
