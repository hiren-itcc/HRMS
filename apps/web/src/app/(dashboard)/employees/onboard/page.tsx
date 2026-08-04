'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type EmployeeOnboardInput, employeeOnboardSchema } from '@hrms/shared';
import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormDatePicker, FormInput } from '@/components/form';
import { FadeInItem, Stagger } from '@/components/motion';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/components/session-provider';
import { onboardingApi } from '@/features/onboarding/api';
import { ApiError } from '@/lib/api-client';

/**
 * Inviting a new hire.
 *
 * Deliberately short: a name, where to reach them, what their login will be
 * and when they start. Department, shift and the rest are filled in on the
 * employee record before approval — asking HR for all of it on day one is why
 * people put placeholders in.
 */
function OnboardForm() {
  const router = useRouter();
  const form = useForm<EmployeeOnboardInput>({
    resolver: zodResolver(employeeOnboardSchema),
    defaultValues: { joinDate: new Date().toISOString().slice(0, 10) },
  });

  const onboard = useMutation({
    mutationFn: onboardingApi.onboard,
    onSuccess: (result) => {
      if (result.inviteSent) {
        toast.success('Invitation sent to their personal email');
      } else {
        /*
         * The reason, not just the fact. The commonest cause by far is the
         * mail provider refusing the recipient because no sending domain is
         * verified — a message that sends HR to the right place, where
         * "the email did not go out" sends them looking for a bug.
         */
        toast.warning('Employee created, but the invitation email was rejected', {
          description: result.inviteError ?? 'Open their record to resend it.',
          duration: 12_000,
        });
      }
      router.push(`/employees/${result.employee.id}`);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not create the record'),
  });

  return (
    <Stagger className="mx-auto max-w-2xl space-y-6">
      <FadeInItem>
        <PageHeader
          title="Onboard a new hire"
          description="They get an email at their personal address with a link to set their own password"
        />
      </FadeInItem>

      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Who is joining</CardTitle>
            <CardDescription>
              They fill in the rest themselves — address, bank details and documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={form.handleSubmit((v) => onboard.mutate(v))}
            >
              <FormInput control={form.control} name="firstName" label="First name" autoFocus />
              <FormInput control={form.control} name="lastName" label="Last name" />

              <FormInput
                control={form.control}
                name="personalEmail"
                label="Personal email"
                hint="Where the invitation goes — they cannot read the work mailbox yet"
                type="email"
              />
              <FormInput
                control={form.control}
                name="workEmail"
                label="Work email"
                hint="Becomes their sign-in"
                type="email"
              />

              <FormDatePicker
                control={form.control}
                name="joinDate"
                label="Joining date"
                placeholder="Select joining date"
              />
              <FormInput
                control={form.control}
                name="employeeCode"
                label="Employee code"
                hint="Left blank, one is generated"
                placeholder="EMP-0007"
              />

              <div className="sm:col-span-2">
                <Alert variant="info">
                  <Mail aria-hidden />
                  <AlertTitle>No password is emailed</AlertTitle>
                  <AlertDescription>
                    The link lets them choose their own and expires in 7 days. You can resend it
                    from their record at any time.
                  </AlertDescription>
                </Alert>
              </div>

              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={onboard.isPending}>
                  {onboard.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Create and send invitation
                </Button>
                <Button type="button" variant="outline" onClick={() => router.back()}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </FadeInItem>
    </Stagger>
  );
}

export default function OnboardEmployeePage() {
  const { can, status } = useSession();
  const router = useRouter();
  const allowed = can('employee.create') && can('employee.invite');

  useEffect(() => {
    if (status === 'authenticated' && !allowed) router.replace('/employees');
  }, [status, allowed, router]);

  if (status === 'authenticated' && !allowed) return <NoAccess what="onboarding" />;
  return <OnboardForm />;
}
