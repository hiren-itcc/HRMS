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
import { Separator } from '@hrms/ui/components/separator';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { FormInput } from '@/components/form';
import { IconAction } from '@/components/icon-action';
import { meApi } from '@/features/employees/api';
import { fullName } from '@/features/employees/types';
import { useApiMutation } from '@/hooks/use-crud';

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
  const _queryClient = useQueryClient();
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
        emergencyContacts: e.emergencyContacts?.map((c) => ({
          name: c.name,
          relation: c.relation,
          phone: c.phone,
        })),
      });
    }
  }, [profile.data, form]);

  const contacts = useFieldArray({ control: form.control, name: 'emergencyContacts' });

  const save = useApiMutation({
    mutationFn: meApi.updateProfile,
    invalidate: [['me-profile']],
    success: 'Profile saved',
    error: 'Could not save. Try again.',
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
            <FormInput control={form.control} name="phone" label="Phone" type="tel" />
            <FormInput
              control={form.control}
              name="personalEmail"
              label="Personal email"
              type="email"
            />
            <FormInput control={form.control} name="addressLine" label="Address" />
            <div className="grid grid-cols-2 gap-3">
              <FormInput control={form.control} name="city" label="City" />
              <FormInput control={form.control} name="country" label="Country" />
            </div>
            <Separator />

            {/*
              In the same form, and saved by the same button, because the API
              takes the whole set in one patch. Two Save buttons on one card
              invites saving one half and walking away from the other.
            */}
            <div>
              <h3 className="font-medium text-sm">Emergency contacts</h3>
              <p className="mt-0.5 text-muted-foreground text-sm">
                Who we call if something happens to you at work. HR can see these — that is the
                point of them.
              </p>

              {/*
                A container query, not a viewport one. `sm:grid-cols-3` put
                three inputs side by side whenever the *window* passed 640px —
                but this card is one half of a two-column layout, so each field
                got about 90 pixels and a name read "Deva", a relation "Broth"
                and a phone "+91 9". The window was never the thing with the
                room in it.
              */}
              <div className="@container mt-3 space-y-3">
                {contacts.fields.map((field, i) => (
                  <div key={field.id} className="flex items-end gap-2">
                    {/*
                      The array paths carry their own errors now. These were the
                      three worst expressions in the app —
                      errors.emergencyContacts?.[i]?.name?.message, three
                      optional chains with nothing checking the path.
                    */}
                    <div className="grid flex-1 gap-2 @md:grid-cols-3">
                      <FormInput
                        control={form.control}
                        name={`emergencyContacts.${i}.name`}
                        label="Name"
                      />
                      <FormInput
                        control={form.control}
                        name={`emergencyContacts.${i}.relation`}
                        label="Relation"
                        placeholder="Spouse, parent, friend…"
                      />
                      <FormInput
                        control={form.control}
                        name={`emergencyContacts.${i}.phone`}
                        label="Phone"
                        type="tel"
                      />
                    </div>
                    <IconAction
                      label={`Remove emergency contact ${i + 1}`}
                      icon={Trash2}
                      size="icon"
                      className="mb-1 text-destructive hover:text-destructive"
                      onClick={() => contacts.remove(i)}
                    />
                  </div>
                ))}

                {contacts.fields.length === 0 && (
                  <p className="text-muted-foreground text-sm">None recorded yet.</p>
                )}

                {contacts.fields.length < 5 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => contacts.append({ name: '', relation: '', phone: '' })}
                  >
                    <Plus className="size-4" aria-hidden /> Add a contact
                  </Button>
                )}
              </div>
            </div>

            <Separator />
            <Button type="submit" size="sm" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save changes
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
