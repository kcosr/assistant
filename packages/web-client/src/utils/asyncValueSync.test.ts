import { describe, expect, it, vi } from 'vitest';

import { AsyncValueSync } from './asyncValueSync';

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AsyncValueSync', () => {
  it('does not resend an already-synced value', async () => {
    const send = vi.fn(async (_value: string) => true);
    const sync = new AsyncValueSync(send);

    sync.request('alpha');
    await Promise.resolve();
    await Promise.resolve();

    sync.request('alpha');
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('alpha');
  });

  it('retries the same desired value after a failed send when asked again', async () => {
    const send = vi
      .fn<(value: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const sync = new AsyncValueSync(send);

    sync.request('alpha');
    await Promise.resolve();
    await Promise.resolve();

    sync.request('alpha');
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'alpha');
    expect(send).toHaveBeenNthCalledWith(2, 'alpha');
  });

  it('serializes updates and eventually sends the latest desired value', async () => {
    const first = createDeferred<boolean>();
    const second = createDeferred<boolean>();
    const send = vi
      .fn<(value: string) => Promise<boolean>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const sync = new AsyncValueSync(send);

    sync.request('alpha');
    sync.request('beta');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('alpha');

    first.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 'beta');

    second.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    sync.request('beta');
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('continues to the latest queued value after a failed in-flight send', async () => {
    const first = createDeferred<boolean>();
    const send = vi
      .fn<(value: string) => Promise<boolean>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(true);
    const sync = new AsyncValueSync(send);

    sync.request('alpha');
    sync.request('beta');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('alpha');

    first.resolve(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 'beta');
  });

  it('allows a later retry after send rejects', async () => {
    const send = vi
      .fn<(value: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);
    const sync = new AsyncValueSync(send);

    sync.request('alpha');
    await Promise.resolve();
    await Promise.resolve();

    sync.request('alpha');
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'alpha');
    expect(send).toHaveBeenNthCalledWith(2, 'alpha');
  });
});
