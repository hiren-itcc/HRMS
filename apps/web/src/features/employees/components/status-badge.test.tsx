import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/render';
import { EmployeeStatusCell } from './status-badge';

describe('EmployeeStatusCell', () => {
  it('reads a status the way the roster does, not as the stored code', () => {
    render(<EmployeeStatusCell value="ON_NOTICE" />);

    expect(screen.getByText('On notice')).toBeInTheDocument();
    expect(screen.queryByText('ON_NOTICE')).not.toBeInTheDocument();
  });

  /*
   * Report rows arrive untyped, so a status the badge has no style for must
   * degrade to text. Indexing the lookup with it would destructure undefined
   * and take the whole report down over one row.
   */
  it('prints a status it has no style for rather than throwing', () => {
    render(<EmployeeStatusCell value="SABBATICAL" />);
    expect(screen.getByText('SABBATICAL')).toBeInTheDocument();
  });

  it('shows a dash for an empty cell', () => {
    render(<EmployeeStatusCell value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
