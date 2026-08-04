'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { Label } from '@hrms/ui/components/label';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { Textarea } from '@hrms/ui/components/textarea';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FadeInItem, Stagger } from '@/components/motion';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import { type LetterTemplate, letterKeys, letterTemplatesApi } from '@/features/letters/api';
import { LetterFrame } from '@/features/letters/components/letter-frame';
import { useApiMutation } from '@/hooks/use-crud';

/** Stand-ins for the preview, so the editor shows a letter rather than braces. */
const SAMPLE_VALUES: Record<string, string> = {
  orgName: 'Acme Industries',
  letterNumber: 'OFR/2026/0007',
  issueDate: '2 August 2026',
  issuedByName: 'Priya Nair',
  employeeName: 'Asha Verma',
  employeeCode: 'EMP-0042',
  designation: 'Senior Engineer',
  department: 'Engineering',
  location: 'Pune',
  employmentType: 'permanent',
  managerName: 'Meera Iyer',
  joinDate: '1 April 2024',
  exitDate: 'present',
  tenure: '2 years 4 months',
  monthlyCtc: '₹1,20,000',
  annualCtc: '₹14,40,000',
};

function fillSample(template: string): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in SAMPLE_VALUES ? SAMPLE_VALUES[name] : match,
  );
}

function TemplateEditor({ template }: { template: LetterTemplate }) {
  const _queryClient = useQueryClient();
  const [title, setTitle] = useState(template.title);
  const [body, setBody] = useState(template.bodyHtml);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    setTitle(template.title);
    setBody(template.bodyHtml);
  }, [template]);

  const dirty = title !== template.title || body !== template.bodyHtml;

  const save = useApiMutation({
    mutationFn: () => letterTemplatesApi.update(template.key, { title, bodyHtml: body }),
    invalidate: [letterKeys.templates()],
    success: (_data) => `${template.name} saved`,
    error: 'Could not save the template',
  });

  const reset = useApiMutation({
    mutationFn: () => letterTemplatesApi.reset(template.key),
    invalidate: [letterKeys.templates()],
    success: (_data) => `${template.name} reset to the default`,
    error: 'Could not reset the template',
  });

  const insert = (variable: string) => setBody((b) => `${b}{{${variable}}}`);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              {template.name}
              {template.isCustomised && <Badge variant="info">Edited</Badge>}
              {template.containsSalary && <Badge variant="warning">States salary</Badge>}
            </CardTitle>
            <CardDescription>{template.description}</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/*
         * An issued letter keeps the copy it was rendered from, so an edit here
         * is forward-only. Saying so is the difference between a safe edit and
         * an alarming one.
         */}
        {template.issuedCount > 0 && (
          <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-xs">
            {template.issuedCount} letter{template.issuedCount === 1 ? ' has' : 's have'} been
            issued from this template. Editing changes only letters issued from now on.
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`title-${template.key}`}>Heading</Label>
          <Input
            id={`title-${template.key}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`body-${template.key}`}>Body</Label>
          <Textarea
            id={`body-${template.key}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Insert:</span>
          {template.variables.map((variable) => (
            <Button
              key={variable}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 font-mono text-[11px]"
              onClick={() => insert(variable)}
            >
              {variable}
            </Button>
          ))}
        </div>

        {showPreview && (
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
            <p className="font-medium text-xs">{fillSample(title)}</p>
            <LetterFrame
              html={fillSample(body)}
              className="h-72 w-full rounded-lg border-0 bg-white"
            />
            <p className="text-muted-foreground text-[11px]">Filled with sample values.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save
          </Button>
          <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
            <Eye className="size-4" aria-hidden /> {showPreview ? 'Hide' : 'Preview'}
          </Button>
          {template.isCustomised && (
            <Button
              variant="ghost"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
              className="text-muted-foreground"
            >
              <RotateCcw className="size-4" aria-hidden /> Reset to default
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function LetterTemplatesPage() {
  const { can, status } = useSession();
  const templates = useQuery({
    queryKey: letterKeys.templates(),
    queryFn: letterTemplatesApi.list,
    enabled: can('letter.template.manage'),
  });

  if (status === 'authenticated' && !can('letter.template.manage')) {
    return <NoAccess what="letter templates" />;
  }
  if (templates.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <Stagger className="space-y-4">
      {templates.data?.map((template) => (
        <FadeInItem key={template.key}>
          <TemplateEditor template={template} />
        </FadeInItem>
      ))}
    </Stagger>
  );
}
