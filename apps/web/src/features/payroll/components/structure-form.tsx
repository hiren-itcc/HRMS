'use client';

import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Switch } from '@hrms/ui/components/switch';
import { Textarea } from '@hrms/ui/components/textarea';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/field';
import { payrollApi, payrollKeys } from '@/features/payroll/api';
import type { CalcType, SalaryStructure } from '@/features/payroll/types';

/**
 * STATUTORY is deliberately absent: PF, ESI and PT are produced by the
 * statutory engine from Settings, not by a structure line. Offering it here
 * would let someone build a structure whose numbers the engine then overrides.
 */
const CALC_TYPES: { value: CalcType; label: string; hint: string }[] = [
  { value: 'PERCENT_OF_CTC', label: '% of CTC', hint: 'share of monthly CTC' },
  { value: 'PERCENT_OF_BASIC', label: '% of basic', hint: 'share of the basic line' },
  { value: 'FLAT', label: 'Flat amount', hint: 'a fixed figure each month' },
  { value: 'BALANCE', label: 'Balance', hint: 'absorbs whatever remains' },
];

interface LineDraft {
  componentId: string;
  calcType: CalcType;
  value: string;
}

const emptyLine = (): LineDraft => ({ componentId: '', calcType: 'PERCENT_OF_CTC', value: '0' });

/**
 * Client-side mirror of the two refinements on salaryStructureCreateSchema.
 * The server enforces them too, but it answers with a flat 400 that names no
 * row — saying it here points at the line the person has to fix.
 */
function validate(name: string, code: string, lines: LineDraft[]): string | null {
  if (!name.trim()) return 'Give the structure a name';
  if (!code.trim()) return 'Give the structure a code';
  if (!/^[A-Z0-9_]+$/.test(code.trim())) return 'Code: use capitals, digits and underscores';
  if (lines.length === 0) return 'A structure needs at least one component';
  if (lines.some((l) => !l.componentId)) return 'Every line needs a component';
  if (lines.filter((l) => l.calcType === 'BALANCE').length > 1)
    return 'Only one component can absorb the balance';
  if (new Set(lines.map((l) => l.componentId)).size !== lines.length)
    return 'A component can only appear once';
  return null;
}

export function StructureForm({ existing }: { existing?: SalaryStructure }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = existing !== undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [lines, setLines] = useState<LineDraft[]>(
    existing?.lines.length
      ? existing.lines
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((l) => ({
            componentId: l.componentId,
            calcType: l.calcType,
            value: String(l.value),
          }))
      : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);

  // Statutory components are engine-owned; they never sit on a structure line.
  const components = useQuery({
    queryKey: ['payroll', 'components'],
    queryFn: () => payrollApi.components(),
    select: (all) => all.filter((c) => !c.isStatutory),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        code: code.trim(),
        description: description.trim() || null,
        isActive,
        lines: lines.map((l, index) => ({
          componentId: l.componentId,
          calcType: l.calcType,
          // A BALANCE line carries no figure of its own — it is the remainder.
          value: l.calcType === 'BALANCE' ? 0 : Number(l.value || 0),
          order: index + 1,
        })),
      };
      return isEdit
        ? payrollApi.updateStructure(existing.id, body)
        : payrollApi.createStructure(body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.structures() });
      toast.success(isEdit ? 'Structure saved' : `Created ${saved.name}`);
      router.push('/payroll/structures');
    },
    onError: (err: Error) => setError(err.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validate(name, code, lines);
    setError(problem);
    if (!problem) save.mutate();
  }

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const move = (index: number, by: -1 | 1) =>
    setLines((rows) => {
      const next = rows.slice();
      const target = index + by;
      if (target < 0 || target >= next.length) return rows;
      [next[index], next[target]] = [next[target] as LineDraft, next[index] as LineDraft];
      return next;
    });

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? `Edit ${existing.name}` : 'New salary structure'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            {(a11y) => (
              <Input
                {...a11y}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Standard Staff"
              />
            )}
          </Field>
          <Field label="Code" required hint="Capitals, digits and underscores — e.g. STD">
            {(a11y) => (
              <Input
                {...a11y}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="STD"
                disabled={isEdit}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              {(a11y) => (
                <Textarea
                  {...a11y}
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Who this structure is for"
                />
              )}
            </Field>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch id="structure-active" checked={isActive} onCheckedChange={setIsActive} />
            <label htmlFor="structure-active" className="text-sm">
              Active — available when assigning a salary
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Components</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((rows) => [...rows, emptyLine()])}
            >
              <Plus className="size-4" aria-hidden /> Add line
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((line, index) => (
            <div
              // Rows are reorderable and a component may briefly be blank, so
              // position is the only stable identity while editing.
              // biome-ignore lint/suspicious/noArrayIndexKey: order IS the identity here
              key={index}
              className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_10rem_8rem_auto]"
            >
              <Select
                value={line.componentId}
                onValueChange={(value) => setLine(index, { componentId: value })}
              >
                <SelectTrigger className="w-full" aria-label={`Component for line ${index + 1}`}>
                  <SelectValue placeholder="Choose a component" />
                </SelectTrigger>
                <SelectContent>
                  {components.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={line.calcType}
                onValueChange={(value) => setLine(index, { calcType: value as CalcType })}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={`How line ${index + 1} is worked out`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALC_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {line.calcType === 'BALANCE' ? (
                <Input value="remainder" disabled aria-label={`Value for line ${index + 1}`} />
              ) : (
                <Input
                  inputMode="decimal"
                  value={line.value}
                  onChange={(e) => setLine(index, { value: e.target.value })}
                  aria-label={`Value for line ${index + 1}`}
                />
              )}

              <div className="flex items-end gap-1 pb-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move line ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move line ${index + 1} down`}
                  disabled={index === lines.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ))}

          <p className="text-muted-foreground text-sm">
            Lines resolve in order against the employee's CTC. Give one component the
            <strong> balance</strong> so the earnings always add up to exactly the CTC.
          </p>
        </CardContent>
      </Card>

      {isEdit && existing.assignedCount > 0 && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>
            {existing.assignedCount} salary record
            {existing.assignedCount === 1 ? '' : 's'} use this structure
          </AlertTitle>
          <AlertDescription>
            Saving changes what the <em>next</em> payroll run calculates. Payslips already
            calculated keep their own figures, so nothing already paid is rewritten.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="error">
          <TriangleAlert aria-hidden />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isEdit ? 'Save changes' : 'Create structure'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/payroll/structures')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
