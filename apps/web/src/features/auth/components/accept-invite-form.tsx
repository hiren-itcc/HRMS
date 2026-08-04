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
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { authApi } from '@/features/auth/api';
import { errorMessage } from '@/hooks/use-crud';
import { PasswordInput } from './password-input';

const formSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
type FormValues = z.infer<typeof formSchema>;

function Dead({ title, hint }: { title: string; hint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" render={<Link href="/login" />}>
          Go to sign-in
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Accepting an invitation: choose a password, and you are in.
 *
 * The link is checked before the form is drawn, so a spent or expired one says
 * so plainly instead of rendering a password field that fails on submit.
 */
export function AcceptInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const { adoptSession } = useSession();
  const [serverError, setServerError] = useState<string | null>(null);

  const check = useQuery({
    queryKey: ['invite', token],
    queryFn: () => authApi.checkInvite(token as string),
    enabled: Boolean(token),
    retry: false,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const { isSubmitting } = form.formState;

  if (!token) {
    return (
      <Dead
        title="Invalid link"
        hint="This invitation link is missing its token. Ask your HR team to send a new one."
      />
    );
  }
  if (check.isLoading) return <Skeleton className="h-72 w-full rounded-xl" />;

  if (!check.data?.valid) {
    const reason = check.data?.reason;
    if (reason === 'used' || reason === 'not-invited') {
      return (
        <Dead
          title="Already set up"
          hint="This invitation has been used. Sign in with your work email, or use “forgot password”."
        />
      );
    }
    return (
      <Dead
        title={reason === 'expired' ? 'This invitation has expired' : 'Invitation not valid'}
        hint="Ask your HR team to send you a new invitation."
      />
    );
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setServerError(null);
    try {
      const { accessToken, user } = await authApi.acceptInvite({ token, password });
      adoptSession(accessToken, user);
      // Straight into the wizard — they are signed in already.
      router.replace('/onboarding');
    } catch (err) {
      setServerError(errorMessage(err, 'Could not set your password'));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {check.data.name ? `Welcome, ${check.data.name}` : 'Welcome'}
        </CardTitle>
        <CardDescription>
          Choose a password to finish setting up your account. You will sign in with your work email
          from now on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField control={form.control} name="password" label="Password">
            {({ field, a11y }) => (
              <PasswordInput
                {...a11y}
                {...field}
                value={field.value ?? ''}
                autoComplete="new-password"
                autoFocus
              />
            )}
          </FormField>
          <FormField control={form.control} name="confirmPassword" label="Confirm password">
            {({ field, a11y }) => (
              <PasswordInput
                {...a11y}
                {...field}
                value={field.value ?? ''}
                autoComplete="new-password"
              />
            )}
          </FormField>

          {serverError && <p className="text-destructive text-sm">{serverError}</p>}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Set password and continue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
