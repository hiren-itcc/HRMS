'use client';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Info, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { FormDatePicker, FormField, FormInput, FormSelect } from '@/components/form';
import { FadeInItem, Stagger } from '@/components/motion';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/components/session-provider';
import { DocumentsBrowser } from '@/features/documents/documents-browser';
import { onboardingApi, onboardingKeys } from '@/features/onboarding/api';
import { OnboardingDocuments } from '@/features/onboarding/components/onboarding-documents';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

/**
 * The new hire's own intake.
 *
 * Everything here is refused by the API once HR has the record, so the page
 * mirrors that: submitted and approved states are read-only, and the
 * outstanding list comes from the server rather than being re-derived here.
 */
export default function OnboardingPage() {
  const _queryClient = useQueryClient();
  const { user, reload } = useSession();

  const record = useQuery({ queryKey: onboardingKeys.mine(), queryFn: onboardingApi.mine });

  const profileForm = useZodForm<OnboardingProfileInput>(onboardingProfileSchema);
  const bankForm = useZodForm<BankDetailInput>(bankDetailSchema);

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

  const saveProfile = useApiMutation({
    mutationFn: onboardingApi.updateProfile,
    invalidate: [onboardingKeys.all()],
    success: 'Details saved',
    error: 'Could not save',
  });

  const saveBank = useApiMutation({
    mutationFn: onboardingApi.setBank,
    invalidate: [onboardingKeys.all()],
    success: 'Bank details saved',
    error: 'Could not save',
  });

  const submit = useApiMutation({
    mutationFn: onboardingApi.submit,
    invalidate: [onboardingKeys.all()],
    success: 'Sent to HR for review',
    error: 'Could not submit — check the list',
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
              <FormDatePicker
                control={profileForm.control}
                name="dateOfBirth"
                label="Date of birth"
                disabled={!open}
                placeholder="Select date of birth"
              />
              <FormSelect
                control={profileForm.control}
                name="gender"
                label="Gender"
                disabled={!open}
                placeholder="Select"
              >
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
                <SelectItem value="PREFER_NOT_TO_SAY">Prefer not to say</SelectItem>
              </FormSelect>
              <FormInput
                control={profileForm.control}
                name="phone"
                placeholder="+91 98765 43210"
                label="Phone"
                type="tel"
                disabled={!open}
              />
              <FormInput
                control={profileForm.control}
                name="addressLine"
                placeholder="12 Satellite Road"
                label="Address"
                disabled={!open}
              />
              <FormInput
                control={profileForm.control}
                name="city"
                label="City"
                disabled={!open}
                placeholder="Ahmedabad"
              />
              <FormInput
                control={profileForm.control}
                name="country"
                placeholder="India"
                label="Country"
                disabled={!open}
              />

              {/*
                The escape hatch, and the clearest case for keeping one. The
                field stores a boolean, offers three states and inverts the
                sense — "no" means hasPreviousEmployment is true. FormSelect
                writes back the item's own string, so a parse/format pair would
                have to live in everyone's component to serve this one caller.
              */}
              <FormField
                control={profileForm.control}
                name="hasPreviousEmployment"
                label="Is this your first job?"
              >
                {({ field, a11y }) => (
                  <Select
                    value={field.value === undefined ? null : field.value ? 'no' : 'yes'}
                    onValueChange={(v) => field.onChange(v === 'no')}
                    disabled={!open}
                  >
                    <SelectTrigger {...a11y} onBlur={field.onBlur} className="w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes — this is my first job</SelectItem>
                      <SelectItem value="no">No — I have worked before</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>

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
              <FormInput
                control={bankForm.control}
                name="accountHolderName"
                placeholder="Exactly as the bank has it"
                label="Account holder"
                disabled={!open}
              />
              <FormInput
                control={bankForm.control}
                name="bankName"
                label="Bank"
                disabled={!open}
                placeholder="HDFC Bank"
              />
              <FormInput
                control={bankForm.control}
                name="accountNumber"
                placeholder="50100123456789"
                label="Account number"
                inputMode="numeric"
                disabled={!open}
              />
              <FormInput
                control={bankForm.control}
                name="ifscCode"
                label="IFSC"
                disabled={!open}
                placeholder="HDFC0001234"
              />
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
