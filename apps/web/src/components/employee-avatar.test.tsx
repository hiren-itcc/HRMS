import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { fetchBlob } from '@/lib/api-client';
import { render, screen, waitFor } from '@/test/render';

vi.mock('@/lib/api-client', () => ({ fetchBlob: vi.fn() }));

beforeEach(() => {
  vi.mocked(fetchBlob).mockReset();
  // jsdom has no object-URL implementation.
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

describe('EmployeeAvatar', () => {
  /*
   * The case that is true for almost everybody in a fresh workspace. It must
   * not cost a request — a list of twenty people with no photos would
   * otherwise be twenty guaranteed 404s.
   */
  it('shows initials and asks for nothing when there is no photo', () => {
    render(<EmployeeAvatar src={null} fallback="AV" />);

    expect(screen.getByText('AV')).toBeInTheDocument();
    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it('fetches the photo through the API when there is one', async () => {
    vi.mocked(fetchBlob).mockResolvedValue(new Blob(['bytes'], { type: 'image/webp' }));
    render(<EmployeeAvatar src="/employees/e1/avatar?v=abc123" fallback="AV" />);

    await waitFor(() => expect(fetchBlob).toHaveBeenCalledWith('/employees/e1/avatar?v=abc123'));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  /*
   * A photo removed between one payload and this request is a 404. The answer
   * is the initials, not an empty circle and not three more attempts.
   */
  it('falls back to initials when the fetch fails', async () => {
    vi.mocked(fetchBlob).mockRejectedValue(new Error('404'));
    render(<EmployeeAvatar src="/employees/e1/avatar?v=abc123" fallback="AV" />);

    await waitFor(() => expect(fetchBlob).toHaveBeenCalledTimes(1));
    expect(screen.getByText('AV')).toBeInTheDocument();
  });

  /* Object URLs are per mount; leaving them behind leaks one handle per photo. */
  it('revokes the object URL when it unmounts', async () => {
    vi.mocked(fetchBlob).mockResolvedValue(new Blob(['bytes'], { type: 'image/webp' }));
    const view = render(<EmployeeAvatar src="/employees/e1/avatar?v=abc123" fallback="AV" />);

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });
});
