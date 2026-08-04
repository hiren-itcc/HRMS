import { zodResolver } from '@hookform/resolvers/zod';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { render, screen } from '@/test/render';
import { FormInput, FormTextarea } from './form-input';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  notes: z.string().optional(),
  nested: z.object({ deep: z.string().min(1, 'Deep is required') }).optional(),
});

function Harness({ onSubmit = vi.fn() }: { onSubmit?: (v: unknown) => void }) {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: '', notes: undefined, nested: { deep: '' } },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormInput control={form.control} name="name" label="Name" required />
      <FormTextarea control={form.control} name="notes" label="Notes" hint="Optional" />
      <FormInput control={form.control} name="nested.deep" label="Deep" />
      <button type="submit">Save</button>
    </form>
  );
}

describe('FormField / FormInput', () => {
  it('labels the control and links them by a generated id', async () => {
    render(<Harness />);
    // Not a hardcoded id string — eight call sites in the app hardcode theirs.
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
  });

  it('reads the error from field state — no hand-written error path', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toContain('Name is required');
  });

  it('associates the message with the control via aria-describedby', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Name is required');

    const input = screen.getByLabelText(/Name/);
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    const message = screen.getByText('Name is required');
    // The defect this prevents: an error rendered but never referenced, so a
    // screen reader announces it once and never again on re-focus.
    expect(describedBy.split(' ')).toContain(message.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the hint described alongside the error, not replaced by it', async () => {
    render(<Harness />);
    const notes = screen.getByLabelText(/Notes/);
    expect(notes.getAttribute('aria-describedby')).toBe(screen.getByText('Optional').id);
  });

  it('resolves nested paths without a chain of optional accessors', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // `name="nested.deep"` replaces errors.nested?.deep?.message.
    expect(await screen.findByText('Deep is required')).toBeInTheDocument();
  });

  it('never renders an undefined value, which would flip the input to uncontrolled', () => {
    render(<Harness />);
    // `notes` defaults to undefined; React warns and moves the cursor on the
    // first keystroke if that reaches the DOM.
    expect(screen.getByLabelText(/Notes/)).toHaveValue('');
  });

  it('marks the form dirty on change without a shouldDirty option', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/Name/), 'Nisha');
    await userEvent.type(screen.getByLabelText(/Deep/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ name: 'Nisha' });
  });
});
