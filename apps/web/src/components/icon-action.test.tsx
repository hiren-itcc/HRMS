import { TooltipProvider } from '@hrms/ui/components/tooltip';
import userEvent from '@testing-library/user-event';
import { Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/render';
import { IconAction } from './icon-action';

const show = (ui: React.ReactElement) => render(<TooltipProvider delay={0}>{ui}</TooltipProvider>);

describe('IconAction', () => {
  /*
   * One label, both readings. A pencil and a bin mean nothing to somebody who
   * does not already know the app, and an aria-label alone only helps a screen
   * reader — so the same string has to reach the eye as well.
   */
  it('uses the one label as the accessible name', () => {
    show(<IconAction label="Delete Casual Leave" icon={Trash2} onClick={() => {}} />);

    expect(screen.getByRole('button', { name: 'Delete Casual Leave' })).toBeInTheDocument();
  });

  it('shows the label on hover, and not before', async () => {
    show(<IconAction label="Delete Casual Leave" icon={Trash2} onClick={() => {}} />);

    // An aria-label is an attribute, not a text node, so nothing is readable
    // yet — which is the complaint this component answers.
    expect(screen.queryByText('Delete Casual Leave')).not.toBeInTheDocument();

    await userEvent.hover(screen.getByRole('button', { name: 'Delete Casual Leave' }));

    await waitFor(() => expect(screen.getByText('Delete Casual Leave')).toBeInTheDocument());
  });

  it('still fires the action it wraps', async () => {
    const onClick = vi.fn();
    show(<IconAction label="Delete it" icon={Trash2} onClick={onClick} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete it' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('refuses to fire when disabled', async () => {
    const onClick = vi.fn();
    show(<IconAction label="Delete it" icon={Trash2} onClick={onClick} disabled />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete it' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  /* Disclosure buttons — an org-chart node, the sidebar toggle. */
  it('carries aria-expanded when it is a disclosure', () => {
    show(<IconAction label="Collapse reports" icon={Trash2} expanded onClick={() => {}} />);

    expect(screen.getByRole('button', { name: 'Collapse reports' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
