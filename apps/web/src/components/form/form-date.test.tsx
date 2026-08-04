import { zodResolver } from '@hookform/resolvers/zod';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { render, screen } from '@/test/render';
import { FormDatePicker, FormTimePicker } from './form-date';

const schema = z.object({
  date: z.string().min(1, 'A date is required'),
  startTime: z.string().min(1, 'Pick a time'),
});

function Harness({
  onSubmit = vi.fn(),
  date = '',
}: {
  onSubmit?: (v: unknown) => void;
  date?: string;
}) {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { date, startTime: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormDatePicker control={form.control} name="date" label="Date" required />
      <FormTimePicker control={form.control} name="startTime" label="Start time" step={15} />
      <button type="submit">Save</button>
    </form>
  );
}

describe('FormDatePicker / FormTimePicker', () => {
  it('renders both pickers labelled', () => {
    render(<Harness />);
    expect(screen.getByLabelText(/Date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start time/)).toBeInTheDocument();
  });

  it('shows a value it is given, as the ISO string these store', () => {
    render(<Harness date="2026-08-04" />);
    // The pickers hold `yyyy-mm-dd`, not a Date — schemas must expect that.
    expect(screen.getByLabelText(/Date/)).toHaveTextContent('2026');
  });

  it('associates a validation message with the control', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const message = await screen.findByText('A date is required');
    const trigger = screen.getByLabelText(/Date/);
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect((trigger.getAttribute('aria-describedby') ?? '').split(' ')).toContain(message.id);
  });

  it('accepts loose time text and normalises it on blur', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} date="2026-08-04" />);

    /*
     * TimePicker parses free text in its OWN onBlur — which is exactly why
     * field.onBlur cannot be attached to it. Typing "930" and tabbing away is
     * the behaviour that would break if the wrapper tried to take that handler.
     */
    const input = screen.getByLabelText(/Start time/);
    await userEvent.type(input, '930');
    await userEvent.tab();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ startTime: '09:30' });
  });
});
