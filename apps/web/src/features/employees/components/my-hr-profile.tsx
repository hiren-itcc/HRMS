'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type SelfProfileUpdateInput, selfProfileUpdateSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { Separator } from '@hrms/ui/components/separator';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Field } from '@/features/auth/components/field';
import { meApi } from '@/features/employees/api';
import { fullName } from '@/features/employees/types';

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
 * Employee self-service: read-only job facts + the contact subset the
 * employee may edit themselves (docs/03 — /me/profile). Renders nothing
 * when no employee record is linked to the account.
 */
export function MyHrProfile() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['me-profile'], queryFn: meApi.profile, retry: false });

  const form = useForm<SelfProfileUpdateInput>({
    resolver: zodResolver(selfProfileUpdateSchema),
    defaultValues: { phone: '', personalEmail: '', addressLine: '', city: '', country: '' },
  });

  useEffect(() => {
    const e = profile.data;
    if (e) {
      form.reset({
        phone: e.phone ?? '',
        personalEmail: e.personalEmail ?? '',
        addressLine: e.addressLine ?? '',
        city: e.city ?? '',
        country: e.country ?? '',
      });
    }
  }, [profile.data, form]);

  const save = useMutation({
    mutationFn: meApi.updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me-profile'] });
      toast.success('Contact details saved');
    },
    onError: () => toast.error('Could not save. Try again.'),
  });

  if (profile.isLoading || !profile.data) return null;
  const e = profile.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BriefcaseBusiness className="size-4 text-muted-foreground" aria-hidden /> Employment
        </CardTitle>
        <CardDescription>
          Your HR record — job details are managed by HR; contact details are yours to keep current
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <dl className="divide-y">
          <Row label="Employee ID" value={<span className="font-mono">{e.employeeCode}</span>} />
          <Row label="Department" value={e.department?.name} />
          <Row label="Designation" value={e.designation?.title} />
          <Row label="Location" value={e.location?.name} />
          <Row label="Reporting manager" value={e.manager ? fullName(e.manager) : null} />
          <Row label="Joining date" value={dateFmt.format(new Date(e.joinDate))} />
          {e.bankDetail && (
            <Row
              label="Salary account"
              value={`${e.bankDetail.bankName} ····${e.bankDetail.accountNumber.slice(-4)}`}
            />
          )}
        </dl>

        <div>
          <h3 className="mb-3 font-medium text-sm">Contact details</h3>
          <form
            onSubmit={form.handleSubmit((input) => save.mutate(input))}
            className="space-y-3"
            noValidate
          >
            <Field label="Phone" error={form.formState.errors.phone?.message}>
              {(a11y) => <Input {...a11y} type="tel" {...form.register('phone')} />}
            </Field>
            <Field label="Personal email" error={form.formState.errors.personalEmail?.message}>
              {(a11y) => <Input {...a11y} type="email" {...form.register('personalEmail')} />}
            </Field>
            <Field label="Address" error={form.formState.errors.addressLine?.message}>
              {(a11y) => <Input {...a11y} {...form.register('addressLine')} />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" error={form.formState.errors.city?.message}>
                {(a11y) => <Input {...a11y} {...form.register('city')} />}
              </Field>
              <Field label="Country" error={form.formState.errors.country?.message}>
                {(a11y) => <Input {...a11y} {...form.register('country')} />}
              </Field>
            </div>
            <Separator />
            <Button type="submit" size="sm" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save contact details
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
