'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type CompanyUpdateInput, companyUpdateSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormField, FormInput } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { TimezoneField } from '@/components/timezone-field';
import { companyApi } from '@/features/organization/api';

export default function CompanyPage() {
  const { can } = useSession();
  const canManage = can('org.manage');
  const queryClient = useQueryClient();

  const company = useQuery({ queryKey: ['org-company'], queryFn: companyApi.get });

  const form = useForm<CompanyUpdateInput>({
    resolver: zodResolver(companyUpdateSchema),
    defaultValues: { name: '', timezone: 'UTC', logoUrl: null },
  });
  const { isSubmitting, isDirty } = form.formState;

  useEffect(() => {
    if (company.data) {
      form.reset({
        name: company.data.name,
        timezone: company.data.timezone,
        logoUrl: company.data.logoUrl,
      });
    }
  }, [company.data, form]);

  const save = useMutation({
    mutationFn: companyApi.update,
    onSuccess: (data) => {
      queryClient.setQueryData(['org-company'], data);
      toast.success('Company profile saved');
    },
    onError: () => toast.error('Could not save the profile. Try again.'),
  });

  if (company.isLoading) {
    return <Skeleton className="h-72 w-full max-w-xl rounded-xl" />;
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-lg">Company profile</CardTitle>
        <CardDescription>
          Identity and defaults applied across the workspace
          {company.data && (
            <span className="mt-1 block text-xs">
              Workspace slug: <code className="font-mono">{company.data.slug}</code>
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((input) => save.mutate(input))}
          className="space-y-4"
          noValidate
        >
          <FormInput
            control={form.control}
            name="name"
            label="Company name"
            disabled={!canManage}
          />

          {/* TimezoneField is a local composite, so it uses the escape hatch. */}
          <FormField
            control={form.control}
            name="timezone"
            label="Default timezone"
            hint="Used wherever an office or employee has no specific timezone"
          >
            {({ field, a11y }) => (
              <TimezoneField
                {...a11y}
                value={field.value}
                onValueChange={field.onChange}
                disabled={!canManage}
              />
            )}
          </FormField>

          <FormInput
            control={form.control}
            name="logoUrl"
            label="Logo URL"
            hint="Optional — https://…"
            type="url"
            placeholder="https://company.com/logo.png"
            disabled={!canManage}
          />

          {canManage && (
            <Button type="submit" disabled={isSubmitting || save.isPending || !isDirty}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save changes
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
