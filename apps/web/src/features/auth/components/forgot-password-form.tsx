'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type ForgotPasswordInput, forgotPasswordSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { authApi } from '@/features/auth/api';
import { Field } from './field';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (input) => {
    // Errors are swallowed on purpose: the response must not differ per account.
    await authApi.forgotPassword(input).catch(() => undefined);
    setSent(true);
  });

  if (sent) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <MailCheck className="mx-auto size-10 text-success" aria-hidden />
          <CardTitle className="text-xl">Check your email</CardTitle>
          <CardDescription>
            If an account exists for that address, a reset link is on its way. The link expires in 1
            hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" render={<Link href="/login" />}>
            <ArrowLeft className="size-4" aria-hidden /> Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Forgot password</CardTitle>
        <CardDescription>Enter your work email and we'll send a reset link</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" error={errors.email?.message}>
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

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>

          <p className="text-center text-sm">
            <Link
              href="/login"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
