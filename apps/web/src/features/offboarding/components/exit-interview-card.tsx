'use client';

import { EXIT_INTERVIEW_QUESTIONS } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { DatePicker } from '@hrms/ui/components/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { Textarea } from '@hrms/ui/components/textarea';
import { useQuery } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/error-state';
import { Field } from '@/components/field';
import { useApiMutation } from '@/hooks/use-crud';
import { offboardingKeys, offboardingsApi } from '../api';

/** Tri-state, because "not asked" is a different answer from "no". */
const TRISTATE = [
  { value: 'unset', label: 'Not recorded' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const toTri = (v: boolean | null | undefined) =>
  v === null || v === undefined ? 'unset' : v ? 'yes' : 'no';
const fromTri = (v: string) => (v === 'unset' ? null : v === 'yes');

/**
 * The exit conversation.
 *
 * Answers are saved with the question text beside them, so changing the
 * questionnaire in a later release never rewrites what somebody already said.
 * The card is only rendered for `employee.offboard` holders — a manager who
 * signs off the handover is very often the subject of the answers.
 */
export function ExitInterviewCard({ offboardingId }: { offboardingId: string }) {
  const query = useQuery({
    queryKey: offboardingKeys.interview(offboardingId),
    queryFn: () => offboardingsApi.interview(offboardingId),
  });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [conductedOn, setConductedOn] = useState('');
  const [notes, setNotes] = useState('');
  const [recommend, setRecommend] = useState('unset');
  const [rehire, setRehire] = useState('unset');
  const [dirty, setDirty] = useState(false);

  // Load once, then leave the form alone: a background refetch must not
  // discard what somebody is halfway through typing.
  useEffect(() => {
    if (query.data === undefined || dirty) return;
    const saved = query.data;
    setAnswers(Object.fromEntries((saved?.responses ?? []).map((r) => [r.key, r.answer])));
    setConductedOn(saved?.conductedOn?.slice(0, 10) ?? '');
    setNotes(saved?.notes ?? '');
    setRecommend(toTri(saved?.wouldRecommend));
    setRehire(toTri(saved?.rehireEligible));
  }, [query.data, dirty]);

  const save = useApiMutation({
    mutationFn: () =>
      offboardingsApi.saveInterview(offboardingId, {
        conductedOn: conductedOn || null,
        // Only what was actually answered — an untouched question is not a
        // blank answer, it is a question nobody asked.
        responses: EXIT_INTERVIEW_QUESTIONS.filter((q) => answers[q.key]?.trim()).map((q) => ({
          key: q.key,
          question: q.question,
          answer: answers[q.key]?.trim() ?? '',
        })),
        notes: notes.trim() || null,
        wouldRecommend: fromTri(recommend),
        rehireEligible: fromTri(rehire),
      }),
    invalidate: [offboardingKeys.all()],
    success: 'Exit interview saved',
    error: 'Could not save the interview',
    onSuccess: () => setDirty(false),
  });

  const change = (fn: () => void) => {
    setDirty(true);
    fn();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
          Exit interview
        </CardTitle>
        <CardDescription>
          Visible to HR only. Save as you go — half a conversation recorded beats a form nobody
          finishes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : (
          <>
            <Field label="Conducted on" hint="Leave blank until it has happened">
              {(a11y) => (
                <DatePicker
                  {...a11y}
                  value={conductedOn}
                  onValueChange={(v) => change(() => setConductedOn(v))}
                />
              )}
            </Field>

            {EXIT_INTERVIEW_QUESTIONS.map((q) => (
              <Field key={q.key} label={q.question} hint={q.hint}>
                {(a11y) => (
                  <Textarea
                    {...a11y}
                    rows={2}
                    maxLength={4000}
                    value={answers[q.key] ?? ''}
                    onChange={(e) =>
                      change(() => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value })))
                    }
                  />
                )}
              </Field>
            ))}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Would they recommend working here?">
                {(a11y) => (
                  <Select value={recommend} onValueChange={(v) => change(() => setRecommend(v))}>
                    <SelectTrigger {...a11y}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRISTATE.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Eligible for rehire?">
                {(a11y) => (
                  <Select value={rehire} onValueChange={(v) => change(() => setRehire(v))}>
                    <SelectTrigger {...a11y}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRISTATE.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </div>

            <Field label="Anything else" hint="Not shown to the employee">
              {(a11y) => (
                <Textarea
                  {...a11y}
                  rows={3}
                  maxLength={4000}
                  value={notes}
                  onChange={(e) => change(() => setNotes(e.target.value))}
                />
              )}
            </Field>

            <div className="flex items-center gap-3">
              <Button disabled={save.isPending || !dirty} onClick={() => save.mutate()}>
                Save interview
              </Button>
              {dirty && <span className="text-muted-foreground text-xs">Unsaved changes</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
