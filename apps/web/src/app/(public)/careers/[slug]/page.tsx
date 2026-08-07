'use client';

import { type CareersApplyInput, careersApplySchema } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, MapPin, Paperclip } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { FormInput, FormTextarea } from '@/components/form';
import { careersApi } from '@/features/careers/api';
import { useZodForm } from '@/hooks/use-zod-form';

export default function CareersRolePage() {
  const { slug } = useParams<{ slug: string }>();
  const [cv, setCv] = useState<File | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const role = useQuery({ queryKey: ['careers', slug], queryFn: () => careersApi.get(slug) });

  const form = useZodForm<CareersApplyInput>(careersApplySchema, {
    defaultValues: { firstName: '', lastName: '', email: '' },
  });

  /*
   * Plain `useMutation`, not `useApiMutation`. That hook toasts and invalidates
   * a query cache built for a signed-in session; here the whole feedback is the
   * panel below, and there is nothing cached to invalidate.
   */
  const apply = useMutation({
    mutationFn: (values: CareersApplyInput) => careersApi.apply(slug, values, cv ?? undefined),
  });

  const chooseCv = (file: File) => {
    // Checked again on the server, on both the type and the extension — this is
    // only so somebody is told before they have filled the form in.
    const ok = /\.(pdf|docx)$/i.test(file.name);
    if (!ok) {
      setCvError('Please attach a PDF or Word document');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCvError('That file is larger than 5 MB');
      return;
    }
    setCvError(null);
    setCv(file);
  };

  if (role.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (role.isError || !role.data) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          That role is no longer open. Have a look at what else we are hiring for.
        </p>
        <Button render={<Link href="/careers" />}>
          <ArrowLeft className="size-4" aria-hidden /> All open roles
        </Button>
      </div>
    );
  }

  const job = role.data;

  if (apply.isSuccess) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 font-medium text-lg">
          <CheckCircle2 className="size-5 text-success-text" aria-hidden />
          Thank you — we have your application
        </div>
        <p className="text-muted-foreground">
          The hiring team will be in touch about <strong>{job.title}</strong>. Nothing else is
          needed from you for now.
        </p>
        <Button variant="outline" render={<Link href="/careers" />}>
          <ArrowLeft className="size-4" aria-hidden /> Other open roles
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/careers" />}>
        <ArrowLeft className="size-4" aria-hidden /> All roles
      </Button>

      <div className="space-y-3">
        <h1 className="font-semibold text-3xl">{job.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
          {job.department && <Badge variant="outline">{job.department}</Badge>}
          {job.location && (
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {job.location}
            </span>
          )}
          {job.employmentType && <span>· {job.employmentType}</span>}
        </div>
      </div>

      {/*
        Rendered as text, never as markup. The description is written by staff
        rather than by the public, but a careers page is the one thing here an
        anonymous visitor reads, and a stored-XSS route through an internal
        editor is still a route.
      */}
      {job.description && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.description}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Apply</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => apply.mutate(values))}
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput
                control={form.control}
                name="firstName"
                label="First name"
                placeholder="Ada"
                required
              />
              <FormInput
                control={form.control}
                name="lastName"
                label="Last name"
                placeholder="Lovelace"
                required
              />
            </div>
            <FormInput
              control={form.control}
              name="email"
              label="Email"
              type="email"
              placeholder="ada@example.com"
              required
            />
            <FormInput
              control={form.control}
              name="phone"
              label="Phone"
              placeholder="+91 98765 43210"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput
                control={form.control}
                name="currentEmployer"
                label="Current employer"
                placeholder="Where you are now"
              />
              <FormInput
                control={form.control}
                name="currentTitle"
                label="Current job title"
                placeholder="What you do there"
              />
            </div>
            <FormInput
              control={form.control}
              name="noticePeriodDays"
              label="Notice period, in days"
              type="number"
              placeholder="30"
            />
            <FormTextarea
              control={form.control}
              name="message"
              label="Anything you would like us to know"
              placeholder="Optional"
              rows={4}
            />

            <div className="space-y-1.5">
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept=".pdf,.docx,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) chooseCv(file);
                }}
              />
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
                <Paperclip className="size-4" aria-hidden />
                {cv ? 'Choose a different CV' : 'Attach your CV'}
              </Button>
              {cv && <p className="text-muted-foreground text-xs">{cv.name}</p>}
              {cvError && <p className="text-destructive-text text-xs">{cvError}</p>}
            </div>

            {apply.isError && (
              <p className="text-destructive-text text-sm">
                {apply.error instanceof Error
                  ? apply.error.message
                  : 'Something went wrong. Please try again.'}
              </p>
            )}

            <Button type="submit" disabled={apply.isPending}>
              {apply.isPending ? 'Sending…' : 'Send my application'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
