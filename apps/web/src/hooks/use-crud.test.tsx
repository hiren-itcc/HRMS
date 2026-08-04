import { useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { queryWrapper } from '@/test/render';
import { useApiMutation, useOptions } from './use-crud';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
});

function apiError(message: string, statusCode = 409) {
  return new ApiError({ statusCode, error: 'Conflict', message });
}

describe('useOptions', () => {
  it('holds options undefined until the request settles, then normalises', async () => {
    const { result } = renderHook(
      () =>
        useOptions(
          'designations',
          async () => [
            { id: 'a', title: 'Engineer' },
            { id: 'b', title: 'Designer' },
          ],
          (row) => row.title,
        ),
      { wrapper: queryWrapper() },
    );

    // The distinction the whole hook exists for: not yet asked is not the same
    // as asked and there are none.
    expect(result.current.options).toBeUndefined();

    await waitFor(() => expect(result.current.options).toBeDefined());
    expect(result.current.options).toEqual([
      { id: 'a', label: 'Engineer' },
      { id: 'b', label: 'Designer' },
    ]);
  });

  it('distinguishes an empty list from a pending one', async () => {
    const { result } = renderHook(
      () =>
        useOptions(
          'shifts',
          async () => [] as { id: string; name: string }[],
          (r) => r.name,
        ),
      { wrapper: queryWrapper() },
    );

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.options).toEqual([]);
  });

  it('reads the label column the caller names, not a fixed one', async () => {
    const { result } = renderHook(
      () =>
        useOptions(
          'departments',
          async () => [{ id: 'a', name: 'Finance', title: 'ignored' }],
          (row) => row.name,
        ),
      { wrapper: queryWrapper() },
    );

    await waitFor(() => expect(result.current.options).toEqual([{ id: 'a', label: 'Finance' }]));
  });
});

describe('useApiMutation', () => {
  it('invalidates every key it is given, by prefix', async () => {
    const listFn = vi.fn().mockResolvedValue(['row']);
    const wrapper = queryWrapper();

    const { result } = renderHook(
      () => ({
        list: useQuery({ queryKey: ['things', 'list', { page: 1 }], queryFn: listFn }),
        save: useApiMutation({
          mutationFn: async () => 'saved',
          // A prefix, not the exact key the query used.
          invalidate: [['things']],
        }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(1));
    result.current.save.mutate();
    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(2));
  });

  it('leaves untouched keys alone', async () => {
    const otherFn = vi.fn().mockResolvedValue('other');
    const wrapper = queryWrapper();

    const { result } = renderHook(
      () => ({
        other: useQuery({ queryKey: ['elsewhere'], queryFn: otherFn }),
        save: useApiMutation({ mutationFn: async () => 'saved', invalidate: [['things']] }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(otherFn).toHaveBeenCalledTimes(1));
    result.current.save.mutate();
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
    expect(otherFn).toHaveBeenCalledTimes(1);
  });

  it("shows the API's own message rather than the caller's fallback", async () => {
    const { result } = renderHook(
      () =>
        useApiMutation({
          mutationFn: async () => {
            throw apiError('That employee code is already taken');
          },
          error: 'Could not save',
        }),
      { wrapper: queryWrapper() },
    );

    result.current.mutate();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('That employee code is already taken'),
    );
  });

  it('falls back for failures that carry no message for the user', async () => {
    const { result } = renderHook(
      () =>
        useApiMutation({
          mutationFn: async () => {
            throw new TypeError('Failed to fetch');
          },
          error: 'Could not save',
        }),
      { wrapper: queryWrapper() },
    );

    result.current.mutate();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save'));
  });

  it('lets a caller take over failure handling entirely', async () => {
    const onError = vi.fn((_err: unknown) => {});
    const { result } = renderHook(
      () =>
        useApiMutation({
          mutationFn: async () => {
            throw apiError('nope');
          },
          onError,
        }),
      { wrapper: queryWrapper() },
    );

    result.current.mutate();
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('builds the success message from the result when given a function', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () =>
        useApiMutation({
          mutationFn: async (count: number) => ({ marked: count }),
          success: (data) => `${data.marked} marked as read`,
          onSuccess,
        }),
      { wrapper: queryWrapper() },
    );

    result.current.mutate(3);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('3 marked as read'));
    expect(onSuccess).toHaveBeenCalledWith({ marked: 3 }, 3);
  });

  it('stays silent when no success message is given', async () => {
    const { result } = renderHook(() => useApiMutation({ mutationFn: async () => 'done' }), {
      wrapper: queryWrapper(),
    });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
