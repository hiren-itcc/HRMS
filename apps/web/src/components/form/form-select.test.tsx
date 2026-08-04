import { zodResolver } from '@hookform/resolvers/zod';
import { SelectItem } from '@hrms/ui/components/select';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { render, screen } from '@/test/render';
import { FormSelect } from './form-select';

const schema = z.object({
  leaveTypeId: z.string().min(1, 'Choose a leave type'),
  parentId: z.string().nullable(),
});

function Harness({ onSubmit = vi.fn() }: { onSubmit?: (v: unknown) => void }) {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { leaveTypeId: '', parentId: null },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormSelect
        control={form.control}
        name="leaveTypeId"
        label="Leave type"
        required
        placeholder="Choose a type"
      >
        <SelectItem value="casual">Casual</SelectItem>
        <SelectItem value="sick">Sick</SelectItem>
      </FormSelect>

      <FormSelect
        control={form.control}
        name="parentId"
        label="Parent department"
        emptyLabel="No parent"
      >
        <SelectItem value="dept-1">Engineering</SelectItem>
      </FormSelect>

      <button type="submit">Save</button>
    </form>
  );
}

const triggerFor = (name: RegExp) => screen.getByRole('combobox', { name });

describe('FormSelect', () => {
  it('puts every aria prop on the TRIGGER — the root renders no element', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Choose a leave type');

    const trigger = triggerFor(/Leave type/);
    const message = screen.getByText('Choose a leave type');

    /*
     * The bug this pins: four call sites in the app pass only `a11y.id` to
     * SelectTrigger and drop the rest, so a required select announces
     * "invalid" and never says why. Base UI's Select root is state, not an
     * element — aria handed to it goes nowhere at all.
     */
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect((trigger.getAttribute('aria-describedby') ?? '').split(' ')).toContain(message.id);
  });

  it('is labelled, without a hardcoded id', () => {
    render(<Harness />);
    expect(triggerFor(/Leave type/)).toBeInTheDocument();
  });

  it('shows the placeholder until something is chosen', () => {
    render(<Harness />);
    expect(triggerFor(/Leave type/)).toHaveTextContent('Choose a type');
  });

  it('stores the chosen value on the form', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(triggerFor(/Leave type/));
    await userEvent.click(await screen.findByRole('option', { name: 'Casual' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ leaveTypeId: 'casual' });
  });

  it('round-trips emptyLabel to null, never to the sentinel string', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    // Pick a real value, then clear it again.
    await userEvent.click(triggerFor(/Parent department/));
    await userEvent.click(await screen.findByRole('option', { name: 'Engineering' }));
    await userEvent.click(triggerFor(/Parent department/));
    await userEvent.click(await screen.findByRole('option', { name: 'No parent' }));

    await userEvent.click(triggerFor(/Leave type/));
    await userEvent.click(await screen.findByRole('option', { name: 'Sick' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    /*
     * Two files each grew their own `NONE = 'none'` sentinel and mapped it back
     * differently — one to null, one to undefined. Leaking the sentinel would
     * store the literal string as a department id.
     */
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ parentId: null });
  });

  it('shows the empty option as the selection when the value is null', () => {
    render(<Harness />);
    expect(triggerFor(/Parent department/)).toHaveTextContent('No parent');
  });
});
