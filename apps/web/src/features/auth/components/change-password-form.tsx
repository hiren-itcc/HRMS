'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { authApi } from '@/features/auth/api';
import { ApiError, setAccessToken } from '@/lib/api-client';
import { PasswordInput } from './password-input';

const formSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const { reload } = useSession();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setServerError(null);
    try {
      const { accessToken } = await authApi.changePassword({ currentPassword, newPassword });
      /*
       * Swap the token before anything else. The one we authenticated with
       * still carries mustChangePassword, and the API refuses every route
       * while that claim is set — keeping it would lock the user out of the
       * app they just unlocked. `reload` then clears the redirect that pins
       * them to this page.
       */
      setAccessToken(accessToken);
      await reload();
      form.reset();
      toast.success('Password changed. Other signed-in devices were logged out.');
    } catch (err) {
      setServerError(
        err instanceof ApiError && err.status === 400
          ? 'Current password is incorrect.'
          : 'Could not change the password. Try again.',
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField control={form.control} name="currentPassword" label="Current password">
        {({ field, a11y }) => (
          <PasswordInput
            {...a11y}
            {...field}
            value={field.value ?? ''}
            autoComplete="current-password"
          />
        )}
      </FormField>

      <FormField
        control={form.control}
        name="newPassword"
        label="New password"
        hint="At least 10 characters with an uppercase letter, a lowercase letter and a digit"
      >
        {({ field, a11y }) => (
          <PasswordInput
            {...a11y}
            {...field}
            value={field.value ?? ''}
            autoComplete="new-password"
          />
        )}
      </FormField>

      <FormField control={form.control} name="confirmPassword" label="Confirm new password">
        {({ field, a11y }) => (
          <PasswordInput
            {...a11y}
            {...field}
            value={field.value ?? ''}
            autoComplete="new-password"
          />
        )}
      </FormField>

      {serverError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive-text text-sm"
        >
          {serverError}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {isSubmitting ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  );
}
