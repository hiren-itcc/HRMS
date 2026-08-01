'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, loginSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Field } from '@/components/field';
import { useSession } from '@/components/session-provider';
import { ApiError } from '@/lib/api-client';
import { PasswordInput } from './password-input';

export function LoginForm() {
  const { login } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (input) => {
    setServerError(null);
    try {
      await login(input);
      router.replace(searchParams.get('next') ?? '/dashboard');
    } catch (err) {
      setServerError(
        err instanceof ApiError && err.status === 401
          ? 'Invalid email or password.'
          : err instanceof ApiError && err.status === 429
            ? 'Too many attempts — please wait a minute and try again.'
            : 'Could not sign in. Check your connection and try again.',
      );
    }
  });

  return (
    <Card className="border-0 bg-transparent shadow-none lg:border lg:bg-card lg:shadow-xs">
      <CardHeader className="px-0 lg:px-6">
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in with your work account to continue</CardDescription>
      </CardHeader>
      <CardContent className="px-0 lg:px-6">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" required error={errors.email?.message}>
            {(a11y) => (
              <Input
                {...a11y}
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                autoFocus
                {...form.register('email')}
              />
            )}
          </Field>

          <Field label="Password" required error={errors.password?.message}>
            {(a11y) => (
              <PasswordInput
                {...a11y}
                autoComplete="current-password"
                {...form.register('password')}
              />
            )}
          </Field>

          {serverError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-destructive-text text-sm"
            >
              {serverError}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="text-center text-sm">
            <Link
              href="/forgot-password"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
