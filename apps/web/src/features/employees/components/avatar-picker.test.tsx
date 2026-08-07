import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarPicker } from '@/features/employees/components/avatar-picker';
import { api, fetchBlob } from '@/lib/api-client';
import { render, screen } from '@/test/render';

vi.mock('@/lib/api-client', () => ({
  api: vi.fn(),
  uploadFile: vi.fn(),
  fetchBlob: vi.fn(),
  ApiError: class extends Error {},
}));

beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchBlob)
    .mockReset()
    .mockResolvedValue(new Blob(['x'], { type: 'image/webp' }));
  // jsdom has no object-URL implementation.
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

const PHOTO = '/employees/e1/avatar?v=abc123';

/**
 * The picker after the controls moved into a popover.
 *
 * What is *not* here is the upload itself: `prepareAvatar` runs
 * `createImageBitmap` and a canvas `drawImage`, and jsdom has neither. Asserting
 * against a mocked-out `prepareAvatar` would only prove the mock was called, so
 * that path stays a browser check.
 */
describe('AvatarPicker', () => {
  /* Somebody who cannot change a face should still see one. */
  it('renders the photo with no controls when the viewer cannot edit', () => {
    render(
      <AvatarPicker
        src={null}
        fallback="AV"
        endpoint="/employees/e1/avatar"
        canEdit={false}
        onDone={() => {}}
      />,
    );

    expect(screen.getByText('AV')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the controls behind the badge until it is pressed', async () => {
    render(
      <AvatarPicker
        src={PHOTO}
        fallback="AV"
        endpoint="/employees/e1/avatar"
        canEdit
        onDone={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: /Change photo/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Photo options/i }));

    expect(await screen.findByRole('button', { name: /Change photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove photo/i })).toBeInTheDocument();
    expect(screen.getByText(/PNG, JPEG or WebP/i)).toBeInTheDocument();
  });

  /* Removing nothing is a request that can only fail. */
  it('offers no Remove when there is no photo to remove', async () => {
    render(
      <AvatarPicker
        src={null}
        fallback="AV"
        endpoint="/employees/e1/avatar"
        canEdit
        onDone={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Photo options/i }));

    expect(await screen.findByRole('button', { name: /Add a photo/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();
  });

  /*
   * The endpoint is the caller's, not the component's — `/me/avatar` for your
   * own photo, `/employees/:id/avatar` for somebody else's — and getting that
   * wrong would delete the wrong person's face.
   */
  it('deletes through the endpoint it was given, and tells the caller', async () => {
    const onDone = vi.fn();
    render(
      <AvatarPicker src={PHOTO} fallback="AV" endpoint="/me/avatar" canEdit onDone={onDone} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Photo options/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Remove photo/i }));

    expect(api).toHaveBeenCalledWith('/me/avatar', { method: 'DELETE' });
    expect(onDone).toHaveBeenCalled();
  });
});
