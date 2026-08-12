import { TooltipProvider } from '@hrms/ui/components/tooltip';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/render';
import { PtSlabEditor } from './pt-slab-editor';

const SENTINEL = Number.MAX_SAFE_INTEGER;

const show = (ui: React.ReactElement) => render(<TooltipProvider delay={0}>{ui}</TooltipProvider>);

describe('PtSlabEditor', () => {
  it('renders rows in ascending order however the array arrives', () => {
    show(
      <PtSlabEditor
        items={[
          { upTo: SENTINEL, amount: 500 },
          { upTo: 25000, amount: 300 },
          { upTo: 12000, amount: 0 },
        ]}
        disabled={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Slab 1 upper bound')).toHaveValue(12000);
    expect(screen.getByLabelText('Slab 2 upper bound')).toHaveValue(25000);
    // The final row has no editable bound — it is the sentinel, rendered as text.
    expect(screen.queryByLabelText('Slab 3 upper bound')).not.toBeInTheDocument();
  });

  it('shows the unbounded final row as a label, not the sentinel number', () => {
    show(
      <PtSlabEditor
        items={[
          { upTo: 12000, amount: 0 },
          { upTo: SENTINEL, amount: 200 },
        ]}
        disabled={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Above the last band')).toBeInTheDocument();
    expect(screen.queryByText(String(SENTINEL))).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(String(SENTINEL))).not.toBeInTheDocument();
  });

  it('adding a slab calls onChange with the full array plus a blank row', async () => {
    const onChange = vi.fn();
    show(
      <PtSlabEditor
        items={[{ upTo: SENTINEL, amount: 200 }]}
        disabled={false}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add a slab' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { upTo: 0, amount: 0 },
      { upTo: SENTINEL, amount: 200 },
    ]);
  });

  it('removing a slab calls onChange with that row dropped and the rest intact', async () => {
    const onChange = vi.fn();
    show(
      <PtSlabEditor
        items={[
          { upTo: 12000, amount: 0 },
          { upTo: SENTINEL, amount: 200 },
        ]}
        disabled={false}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove slab 1' }));

    expect(onChange).toHaveBeenCalledWith([{ upTo: SENTINEL, amount: 200 }]);
  });

  it('editing a row calls onChange with the full array, that field updated', () => {
    const onChange = vi.fn();
    show(
      <PtSlabEditor
        items={[
          { upTo: 12000, amount: 0 },
          { upTo: SENTINEL, amount: 200 },
        ]}
        disabled={false}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Slab 2 amount'), { target: { value: '250' } });

    expect(onChange).toHaveBeenCalledWith([
      { upTo: 12000, amount: 0 },
      { upTo: SENTINEL, amount: 250 },
    ]);
  });

  it('warns once the highest slab exceeds ₹2,500 a year, and not at the boundary', () => {
    const { rerender } = show(
      <PtSlabEditor
        items={[{ upTo: SENTINEL, amount: 200 }]}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    // ₹200 × 12 = ₹2,400 — Gujarat's actual rate, just under the cap.
    expect(screen.queryByText(/exceeds ₹2,500/)).not.toBeInTheDocument();

    rerender(
      <TooltipProvider delay={0}>
        <PtSlabEditor
          items={[{ upTo: SENTINEL, amount: 209 }]}
          disabled={false}
          onChange={vi.fn()}
        />
      </TooltipProvider>,
    );
    // ₹209 × 12 = ₹2,508 — over the Article 276 cap.
    expect(screen.getByText(/exceeds ₹2,500/)).toBeInTheDocument();
  });

  it('warns when a higher band charges less than the one below it', () => {
    show(
      <PtSlabEditor
        items={[
          { upTo: 12000, amount: 200 },
          { upTo: SENTINEL, amount: 150 },
        ]}
        disabled={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/charges less than the one below it/)).toBeInTheDocument();
  });

  it('renders every control disabled for a viewer without settings.manage', () => {
    show(
      <PtSlabEditor
        items={[
          { upTo: 12000, amount: 0 },
          { upTo: SENTINEL, amount: 200 },
        ]}
        disabled={true}
        onChange={vi.fn()}
      />,
    );

    for (const input of screen.getAllByRole('spinbutton')) {
      expect(input).toBeDisabled();
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: 'Add a slab' })).not.toBeInTheDocument();
  });
});
