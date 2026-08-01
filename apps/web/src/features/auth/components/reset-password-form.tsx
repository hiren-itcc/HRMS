'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { authApi } from '@/features/auth/api';
import { ApiError } from '@/lib/api-client';
import { Field } from './field';
import { PasswordInput } from './password-input';

const formSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
type FormValues = z.infer<typeof formSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Invalid link</CardTitle>
          <CardDescription>
            This reset link is missing its token. Request a new one below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" render={<Link href="/forgot-password" />}>
            Request a new link
          </Button>
        </CardContent>
      </Card>
    );
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setServerError(null);
    try {
      await authApi.resetPassword({ token, password });
      toast.success('Password updated — sign in with your new password.');
      router.replace('/login');
    } catch (err) {
      setServerError(
        err instanceof ApiError && err.status === 400
          ? 'This reset link is invalid or has expired. Request a new one.'
          : 'Could not reset the password. Try again.',
      );
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>
          At least 10 characters with an uppercase letter, a lowercase letter and a digit
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="New password" error={errors.password?.message}>
            {(a11y) => (
              <PasswordInput
                {...a11y}
                autoComplete="new-password"
                autoFocus
                {...form.register('password')}
              />
            )}
          </Field>

          <Field label="Confirm new password" error={errors.confirmPassword?.message}>
            {(a11y) => (
              <PasswordInput
                {...a11y}
                autoComplete="new-password"
                {...form.register('confirmPassword')}
              />
            )}
          </Field>

          {serverError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-destructive-text text-sm"
            >
              {serverError}{' '}
              <Link href="/forgot-password" className="font-medium underline underline-offset-4">
                Request a new link
              </Link>
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
