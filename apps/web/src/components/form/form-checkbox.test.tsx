import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useZodForm } from '@/hooks/use-zod-form';
import { render, screen } from '@/test/render';
import { FormCheckbox, FormSwitch } from './form-checkbox';

const schema = z.object({
  isPaid: z.boolean(),
  isActive: z.boolean(),
  accepted: z.literal(true, { message: 'You must accept the terms' }),
});

function Harness({ onSubmit = vi.fn() }: { onSubmit?: (v: unknown) => void }) {
  const form = useZodForm(schema, {
    defaultValues: { isPaid: false, isActive: true, accepted: false as true },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormCheckbox
        control={form.control}
        name="isPaid"
        label="Paid leave"
        hint="Counts toward salary"
      />
      <FormSwitch control={form.control} name="isActive" label="Active" />
      <FormCheckbox control={form.control} name="accepted" label="I accept the terms" />
      <button type="submit">Save</button>
    </form>
  );
}

describe('FormCheckbox / FormSwitch', () => {
  it('gives react-hook-form a plain boolean, never the event-details object', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Paid leave' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'I accept the terms' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    /*
     * Base UI calls onCheckedChange(checked, eventDetails) — two arguments,
     * unlike Radix. Passing field.onChange straight in hands RHF that second
     * object and the stored value stops being a boolean.
     */
    const submitted = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitted.isPaid).toBe(true);
    expect(typeof submitted.isPaid).toBe('boolean');
    expect(submitted.isActive).toBe(true);
  });

  it('toggles back off, so the wrap is not a one-way latch', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Active' })); // true -> false
    await userEvent.click(screen.getByRole('checkbox', { name: 'I accept the terms' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const submitted = onSubmit.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(submitted?.isActive).toBe(false);
  });

  it('puts the label beside the control and links it, without a hardcoded id', () => {
    render(<Harness />);
    // Six checkbox sites in the app work around Field's stacked layout by hand;
    // three re-derive useId and three hardcode a string.
    const box = screen.getByRole('checkbox', { name: 'Paid leave' });
    expect(box).toBeInTheDocument();
    expect(box.id).toBeTruthy();
  });

  it('describes the control with its hint', () => {
    render(<Harness />);
    const box = screen.getByRole('checkbox', { name: 'Paid leave' });
    expect((box.getAttribute('aria-describedby') ?? '').split(' ')).toContain(
      screen.getByText('Counts toward salary').id,
    );
  });

  it('renders and associates a validation message', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const message = await screen.findByText('You must accept the terms');
    const box = screen.getByRole('checkbox', { name: 'I accept the terms' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect((box.getAttribute('aria-describedby') ?? '').split(' ')).toContain(message.id);
  });
});

describe('FormCheckbox cascade', () => {
  it('fires onValueChange after storing, so a dependent field can be cleared', async () => {
    const seen: unknown[] = [];

    function Cascade() {
      const form = useForm({
        defaultValues: { carryForward: true, maxCarryForward: 5 as number | null },
      });
      return (
        <FormCheckbox
          control={form.control}
          name="carryForward"
          label="Carry forward unused leave"
          onValueChange={(checked) => {
            // The real rule: a cap on a switched-off feature fails validation.
            if (!checked) form.setValue('maxCarryForward', null);
            seen.push([checked, form.getValues('maxCarryForward')]);
          }}
        />
      );
    }

    render(<Cascade />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Carry forward/ }));

    expect(seen).toEqual([[false, null]]);
  });
});
