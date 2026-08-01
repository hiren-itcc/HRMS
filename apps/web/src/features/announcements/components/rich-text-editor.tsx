'use client';

import { Button } from '@hrms/ui/components/button';
import { Textarea } from '@hrms/ui/components/textarea';
import { cn } from '@hrms/ui/lib/utils';
import {
  Bold,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Pencil,
  Quote,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Markdown } from './markdown';

interface Action {
  icon: LucideIcon;
  label: string;
  /** Text placed before and after the selection. */
  wrap: [string, string];
  /** Prefix applied to the start of the line instead of wrapping. */
  linePrefix?: string;
}

const ACTIONS: Action[] = [
  { icon: Bold, label: 'Bold', wrap: ['**', '**'] },
  { icon: Italic, label: 'Italic', wrap: ['_', '_'] },
  { icon: Heading2, label: 'Heading', wrap: ['', ''], linePrefix: '## ' },
  { icon: List, label: 'Bulleted list', wrap: ['', ''], linePrefix: '- ' },
  { icon: ListOrdered, label: 'Numbered list', wrap: ['', ''], linePrefix: '1. ' },
  { icon: Quote, label: 'Quote', wrap: ['', ''], linePrefix: '> ' },
  { icon: Link2, label: 'Link', wrap: ['[', '](https://)'] },
];

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * Markdown-backed rich text editor: a formatting toolbar over a textarea,
 * with a live preview tab. Markdown (not HTML) keeps stored content inert —
 * see components/markdown.tsx.
 */
export function RichTextEditor({ value, onChange, id, ...a11y }: EditorProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const ref = useRef<HTMLTextAreaElement>(null);

  const apply = (action: Action) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);

    let next: string;
    let caret: number;
    if (action.linePrefix) {
      // Apply the prefix to the start of the selected line
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      next = `${value.slice(0, lineStart)}${action.linePrefix}${value.slice(lineStart)}`;
      caret = end + action.linePrefix.length;
    } else {
      const [open, close] = action.wrap;
      next = `${value.slice(0, start)}${open}${selected}${close}${value.slice(end)}`;
      caret = start + open.length + selected.length;
    }
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b bg-muted/40 p-1">
        <div className="flex flex-wrap items-center gap-0.5">
          {ACTIONS.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={action.label}
              title={action.label}
              disabled={tab === 'preview'}
              onClick={() => apply(action)}
            >
              <action.icon className="size-4" aria-hidden />
            </Button>
          ))}
        </div>
        <div className="flex gap-0.5 rounded-md bg-background p-0.5">
          {(['write', 'preview'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cn(
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs capitalize transition-colors',
                tab === t
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'write' ? (
                <Pencil className="size-3.5" aria-hidden />
              ) : (
                <Eye className="size-3.5" aria-hidden />
              )}
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'write' ? (
        <Textarea
          {...a11y}
          id={id}
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          placeholder={'Share the news…\n\n**Bold**, _italic_, - lists and [links](https://) work.'}
          className="min-h-52 resize-y rounded-none border-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        />
      ) : (
        <div className="min-h-52 p-3">
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
