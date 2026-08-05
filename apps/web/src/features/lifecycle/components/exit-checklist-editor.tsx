'use client';

import {
  CLEARANCE_OWNER_LABELS,
  CLEARANCE_OWNERS,
  type ClearanceItem,
  type ClearanceOwnerCode,
} from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Checkbox } from '@hrms/ui/components/checkbox';
import { Input } from '@hrms/ui/components/input';
import { Label } from '@hrms/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useId } from 'react';

const BLANK: ClearanceItem = {
  label: '',
  description: null,
  owner: 'HR',
  required: true,
  kind: 'MANUAL',
};

/**
 * The exit checklist template.
 *
 * Edits here apply to exits started **from now on**. An exit already under way
 * carries the copy it was given, which is the whole point: somebody who has
 * already returned their laptop has returned it whatever this list says
 * afterwards.
 */
export function ExitChecklistEditor({
  items,
  disabled,
  onChange,
}: {
  items: ClearanceItem[];
  disabled: boolean;
  onChange: (items: ClearanceItem[]) => void;
}) {
  const id = useId();

  const patch = (index: number, values: Partial<ClearanceItem>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...values } : item)));

  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((item, index) => (
          // Order is the identity here — items have no id until they are
          // copied onto an exit, and two can legitimately share a label.
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
          <li key={index} className="space-y-2 rounded-xl border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  aria-label={`Item ${index + 1} name`}
                  value={item.label}
                  disabled={disabled}
                  maxLength={120}
                  placeholder="Return company assets"
                  onChange={(e) => patch(index, { label: e.target.value })}
                />
                <Input
                  aria-label={`Item ${index + 1} description`}
                  value={item.description ?? ''}
                  disabled={disabled}
                  maxLength={300}
                  placeholder="Optional detail — what exactly has to come back"
                  onChange={(e) => patch(index, { description: e.target.value || null })}
                />
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || index === 0}
                  aria-label={`Move ${item.label || `item ${index + 1}`} up`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || index === items.length - 1}
                  aria-label={`Move ${item.label || `item ${index + 1}`} down`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  disabled={disabled}
                  aria-label={`Remove ${item.label || `item ${index + 1}`}`}
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${id}-owner-${index}`} className="text-xs">
                  Signed off by
                </Label>
                <Select
                  value={item.owner}
                  disabled={disabled}
                  onValueChange={(v) => patch(index, { owner: v as ClearanceOwnerCode })}
                >
                  <SelectTrigger id={`${id}-owner-${index}`} className="h-8 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLEARANCE_OWNERS.map((owner) => (
                      <SelectItem key={owner} value={owner}>
                        {CLEARANCE_OWNER_LABELS[owner]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-required-${index}`}
                  checked={item.required}
                  disabled={disabled}
                  onCheckedChange={(v) => patch(index, { required: v === true })}
                />
                <Label htmlFor={`${id}-required-${index}`} className="text-xs">
                  Blocks completion
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-assets-${index}`}
                  checked={item.kind === 'ASSET_RETURN'}
                  disabled={disabled}
                  onCheckedChange={(v) =>
                    patch(index, { kind: v === true ? 'ASSET_RETURN' : 'MANUAL' })
                  }
                />
                <Label htmlFor={`${id}-assets-${index}`} className="text-xs">
                  Read from the asset register
                </Label>
              </div>
            </div>

            {item.kind === 'ASSET_RETURN' && (
              <p className="text-muted-foreground text-xs">
                This item lists what the leaver still holds and settles itself when the last thing
                comes back. Nobody can tick it off by hand — but it can still be waived with a
                reason.
              </p>
            )}
          </li>
        ))}
      </ul>

      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={items.length >= 30}
          onClick={() => onChange([...items, BLANK])}
        >
          <Plus className="size-4" aria-hidden /> Add an item
        </Button>
      )}

      <p className="text-muted-foreground text-xs">
        {/*
         * Said out loud, because the alternative reading — that saving
         * retro-fits every exit in flight — is the one somebody will assume.
         */}
        Changes apply to exits started from now on. An exit already under way keeps the checklist it
        was given. <strong>IT / Admin</strong> has no matching role yet, so those items are signed
        off by anyone who can offboard until you add one under Settings → Roles.
      </p>
    </div>
  );
}
