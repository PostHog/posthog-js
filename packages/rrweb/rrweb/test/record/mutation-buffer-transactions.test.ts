/**
 * @vitest-environment jsdom
 *
 * The buffer-transaction helpers re-enter consumer code synchronously via
 * MutationBuffer.commit → emit → mutationCb. A consumer throw, a splice of
 * `mutationBuffers` (iframe teardown), or a buffer born during the commit
 * (iframe attached while an add serializes) must not strand any buffer locked
 * with a token nobody owns — that failure mode is permanent, silent recording
 * death, because a stranded lockToken makes every future lock/commit fail.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MutationBuffer } from '../../src/record/mutation';
import {
  mutationBuffers,
  createMutationBufferLockToken,
  lockMutationBuffers,
  commitMutationBuffers,
  discardMutationBuffers,
  discardActiveMutationBufferTransaction,
} from '../../src/record/observer';

type FakeBuffer = Pick<
  MutationBuffer,
  'lock' | 'commit' | 'discard' | 'hasLockToken'
> & {
  lockToken: number | null;
  committed: boolean;
  discarded: boolean;
  onCommit?: () => void;
  pendingRecordCount?: () => number;
};

function makeBuffer(overrides: Partial<FakeBuffer> = {}): FakeBuffer {
  const buffer: FakeBuffer = {
    lockToken: null,
    committed: false,
    discarded: false,
    lock(token: number) {
      if (buffer.lockToken !== null && buffer.lockToken !== token) return false;
      buffer.lockToken = token;
      return true;
    },
    commit(token: number) {
      if (buffer.lockToken !== token) return false;
      buffer.lockToken = null;
      buffer.committed = true;
      buffer.onCommit?.();
      return true;
    },
    discard(token: number) {
      if (buffer.lockToken !== token) return false;
      buffer.lockToken = null;
      buffer.discarded = true;
      return true;
    },
    hasLockToken(token: number) {
      return buffer.lockToken === token;
    },
    ...overrides,
  };
  return buffer;
}

function install(...buffers: FakeBuffer[]) {
  for (const buffer of buffers) {
    mutationBuffers.push(buffer as unknown as MutationBuffer);
  }
}

afterEach(() => {
  // release any transaction a test left armed, then drop the fakes
  discardActiveMutationBufferTransaction();
  mutationBuffers.length = 0;
});

describe('mutation buffer transactions', () => {
  it('a consumer throw mid-commit still releases every other buffer and the token', () => {
    const a = makeBuffer();
    const b = makeBuffer({
      onCommit: () => {
        throw new Error('consumer emit failure');
      },
    });
    const c = makeBuffer();
    install(a, b, c);

    const token = createMutationBufferLockToken();
    expect(lockMutationBuffers(token)).toBe(true);
    commitMutationBuffers(token);

    expect(a.committed).toBe(true);
    expect(c.committed).toBe(true);
    // b threw after clearing its own token — nothing left locked either way
    expect(a.lockToken).toBeNull();
    expect(b.lockToken).toBeNull();
    expect(c.lockToken).toBeNull();

    // the next snapshot must be able to acquire the buffers, and even with
    // the consumer still throwing, nothing may end up stranded
    const next = createMutationBufferLockToken();
    expect(lockMutationBuffers(next)).toBe(true);
    commitMutationBuffers(next);
    expect(a.lockToken).toBeNull();
    expect(b.lockToken).toBeNull();
    expect(c.lockToken).toBeNull();
  });

  it('a commit that throws before releasing its buffer is force-discarded', () => {
    const stuck = makeBuffer();
    stuck.commit = () => {
      // throws with the lock still held — the worst version of re-entry
      throw new Error('commit failed before releasing');
    };
    const healthy = makeBuffer();
    install(stuck, healthy);

    const token = createMutationBufferLockToken();
    expect(lockMutationBuffers(token)).toBe(true);
    expect(commitMutationBuffers(token).committed).toBe(false);

    expect(healthy.committed).toBe(true);
    expect(stuck.discarded).toBe(true);
    expect(stuck.lockToken).toBeNull();

    const next = createMutationBufferLockToken();
    expect(lockMutationBuffers(next)).toBe(true);
  });

  it('a buffer spliced out during commit does not break the iteration', () => {
    const a = makeBuffer({
      onCommit: () => {
        // iframe teardown mid-commit removes an entry under the cursor
        mutationBuffers.splice(1, 1);
      },
    });
    const b = makeBuffer();
    const c = makeBuffer();
    install(a, b, c);

    const token = createMutationBufferLockToken();
    expect(lockMutationBuffers(token)).toBe(true);
    commitMutationBuffers(token);

    // c stayed in the array and must have been committed despite the splice
    expect(c.committed).toBe(true);
    expect(c.lockToken).toBeNull();
    // b was spliced out mid-commit; whatever its fate, it must not be a
    // stranded lock holder from the array's point of view
    const next = createMutationBufferLockToken();
    expect(lockMutationBuffers(next)).toBe(true);
  });

  it('a buffer born during commit is swept into the same transaction', () => {
    const late = makeBuffer();
    const a = makeBuffer({
      onCommit: () => {
        // an iframe attach during a committed add's serialization creates a
        // new buffer; the armed gate locks it with the in-flight token
        late.lock(token);
        mutationBuffers.push(late as unknown as MutationBuffer);
      },
    });
    install(a);

    const token = createMutationBufferLockToken();
    expect(lockMutationBuffers(token)).toBe(true);
    expect(commitMutationBuffers(token).committed).toBe(true);

    expect(late.committed).toBe(true);
    expect(late.lockToken).toBeNull();
  });

  it('a frozen buffer defers its records to unfreeze() instead of dropping them', () => {
    // mimics MutationBuffer.commit on a frozen buffer: the lock is released,
    // the records stay buffered, and the commit reports the miss
    const frozen = makeBuffer({ pendingRecordCount: () => 3 });
    frozen.commit = (token: number) => {
      if (frozen.lockToken !== token) return false;
      frozen.lockToken = null;
      return false;
    };
    const healthy = makeBuffer();
    install(frozen, healthy);

    const token = createMutationBufferLockToken();
    expect(lockMutationBuffers(token)).toBe(true);
    const outcome = commitMutationBuffers(token);

    expect(outcome.committed).toBe(false);
    expect(outcome.deferredRecordCount).toBe(3);
    expect(outcome.droppedRecordCount).toBe(0);
    expect(frozen.discarded).toBe(false);
    expect(healthy.committed).toBe(true);
  });

  it('counts force-discarded records as dropped, exactly once', () => {
    // discard failing too keeps the buffer a lock holder across every sweep,
    // the worst case for double counting
    const stuck = makeBuffer({ pendingRecordCount: () => 5 });
    stuck.commit = () => {
      throw new Error('commit failed before releasing');
    };
    stuck.discard = () => {
      throw new Error('discard failed too');
    };
    install(stuck);

    const token = createMutationBufferLockToken();
    expect(lockMutationBuffers(token)).toBe(true);
    const outcome = commitMutationBuffers(token);

    expect(outcome.committed).toBe(false);
    expect(outcome.droppedRecordCount).toBe(5);
    expect(outcome.deferredRecordCount).toBe(0);

    // the stranded fake still holds its token; release it so afterEach's
    // cleanup is not fighting a buffer that throws on discard
    stuck.lockToken = null;
  });

  it('discard works by token even after the global owner was cleared', () => {
    const a = makeBuffer();
    const b = makeBuffer();
    install(a, b);

    const token = createMutationBufferLockToken();
    expect(lockMutationBuffers(token)).toBe(true);
    // simulate a half-failed commit that cleared the owner but left b locked
    a.commit(token);
    commitMutationBuffers(token);
    b.lockToken = token; // re-stranded by a hostile interleaving

    expect(discardMutationBuffers(token)).toBe(true);
    expect(b.lockToken).toBeNull();

    const next = createMutationBufferLockToken();
    expect(lockMutationBuffers(next)).toBe(true);
  });
});
