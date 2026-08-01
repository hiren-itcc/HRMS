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
import { Checkbox } from '@hrms/ui/components/checkbox';
import { Input } from '@hrms/ui/components/input';
import { Label } from '@hrms/ui/components/label';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { Textarea } from '@hrms/ui/components/textarea';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FadeInItem, Stagger } from '@/components/motion';
import {
  type EmailTemplate,
  emailApi,
  previewTemplate,
  SAMPLE_VALUES,
} from '@/features/settings/email-api';

const KEY = ['email-templates'] as const;

function TemplateEditor({ template }: { template: EmailTemplate }) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.bodyHtml);
  const [active, setActive] = useState(template.isActive);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    setSubject(template.subject);
    setBody(template.bodyHtml);
    setActive(template.isActive);
  }, [template]);

  const dirty =
    subject !== template.subject || body !== template.bodyHtml || active !== template.isActive;

  const save = useMutation({
    mutationFn: () => emailApi.update(template.key, { subject, bodyHtml: body, isActive: active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(`${template.name} saved`);
    },
    onError: () => toast.error('Could not save the template. Try again.'),
  });

  const reset = useMutation({
    mutationFn: () => emailApi.reset(template.key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(`${template.name} restored to the built-in default`);
    },
    onError: () => toast.error('Could not reset the template.'),
  });

  const insert = (variable: string) => setBody((b) => `${b}{{${variable}}}`);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {template.name}
              {template.isCustomised && (
                <Badge variant="secondary" className="text-[10px]">
                  Edited
                </Badge>
              )}
            </CardTitle>
            <CardDescription>{template.description}</CardDescription>
          </div>
          {/* Honest about what is actually wired: only password reset sends today. */}
          {!template.hasSender && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              Not sent yet
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`subject-${template.key}`}>Subject</Label>
          <Input
            id={`subject-${template.key}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`body-${template.key}`}>Body</Label>
          <Textarea
            id={`body-${template.key}`}
            rows={8}
            className="font-mono text-xs"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <span className="block font-medium text-sm">Available variables</span>
          <div className="flex flex-wrap gap-1.5">
            {template.variables.map((variable) => (
              <button
                key={variable}
                type="button"
                onClick={() => insert(variable)}
                title={`Insert {{${variable}}}`}
                className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2"
              >
                {`{{${variable}}}`}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            Click to append. Anything else stays as literal text in the email.
          </p>
        </div>

        <div className="flex items-start gap-2.5">
          <Checkbox
            id={`active-${template.key}`}
            checked={active}
            onCheckedChange={(v) => setActive(v === true)}
          />
          <div className="space-y-0.5">
            <Label htmlFor={`active-${template.key}`}>Use this template</Label>
            <p className="text-muted-foreground text-xs">
              When off, the built-in default is sent instead — so email never stops working.
            </p>
          </div>
        </div>

        {showPreview && (
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
            <p className="font-medium text-xs">
              Subject: <span className="font-normal">{previewTemplate(subject)}</span>
            </p>
            {/* A sandboxed iframe, not innerHTML: template bodies are stored
                HTML that another admin may have written, so rendering them in
                this document would execute their script in this session. */}
            <iframe
              title="Email preview"
              sandbox=""
              className="h-40 w-full rounded-lg border bg-white"
              srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:14px/1.5 system-ui,sans-serif;margin:8px;color:#0f172a}a{color:#4f46e5}</style>${previewTemplate(body)}`}
            />
            <p className="text-muted-foreground text-[11px]">
              Filled with sample values ({Object.keys(SAMPLE_VALUES).length} known variables).
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowPreview((p) => !p)}
            aria-expanded={showPreview}
          >
            <Eye className="size-4" aria-hidden />
            {showPreview ? 'Hide preview' : 'Preview'}
          </Button>
          {template.isCustomised && (
            <Button
              size="sm"
              variant="ghost"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              <RotateCcw className="size-4" aria-hidden />
              Reset to default
            </Button>
          )}
          {dirty && <span className="text-muted-foreground text-xs">Unsaved changes</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EmailTemplatesPage() {
  const templates = useQuery({ queryKey: KEY, queryFn: emailApi.list });

  if (templates.isLoading || !templates.data) {
    return (
      <div className="max-w-2xl space-y-4">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-96 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <Stagger className="max-w-2xl space-y-5">
      <FadeInItem>
        <p className="flex items-start gap-2 rounded-2xl border bg-muted/40 p-4 text-muted-foreground text-xs">
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Mail currently uses the development transport, which logs messages rather than sending
            them. Password reset already renders through its template; the others are here so the
            copy is ready when their senders are built.
          </span>
        </p>
      </FadeInItem>

      {templates.data.map((template) => (
        <FadeInItem key={template.key}>
          <TemplateEditor template={template} />
        </FadeInItem>
      ))}
    </Stagger>
  );
}
