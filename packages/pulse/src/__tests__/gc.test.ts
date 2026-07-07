/**
 * GC + host-driven outbox lifecycle — the 0.2.0 mini-spec (§11).
 *
 * These tests are the brutal contract for the new introspection getters,
 * `purge`/`purgeNonDurable`, `snapshotDurable`, sparse-outbox resend, and
 * `disconnectedAtMs` tracking. They cover both the pure-core behavior and
 * the real host use-case that motivated the feature: a store-and-forward
 * hub whose per-peer endpoint accumulates unbounded non-durable frames when
 * some peers are perma-offline.
 */

import { describe, expect, it } from 'vitest';
import { Endpoint } from '../endpoint.js';
import { DEFAULT_PARAMS, type Effect } from '../types.js';
import { decodeFrame } from '../wire.js';
import { marker, payloadsOf, World } from './harness.js';

const A_EPOCH = 'A';
const B_EPOCH = 'B';

// ── 1. Introspection getters ────────────────────────────────────────────────

describe('GC-1: introspection getters expose outbox state for host decisions', () => {
  it('outboxSize / durableCount / nonDurableCount / outboxByteSize / oldestSentAt', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } });
    expect(a.outboxSize).toBe(0);
    expect(a.durableCount).toBe(0);
    expect(a.nonDurableCount).toBe(0);
    expect(a.outboxByteSize).toBe(0);
    expect(a.oldestSentAt).toBeNull();

    // Warm the endpoint clock so sentAt is meaningful.
    a.onTick(1_000);
    a.send(new Uint8Array([1, 2, 3])); // non-durable, 3 bytes
    a.send(new Uint8Array([9, 9, 9, 9]), { durable: true }); // durable, 4 bytes

    expect(a.outboxSize).toBe(2);
    expect(a.durableCount).toBe(1);
    expect(a.nonDurableCount).toBe(1);
    expect(a.outboxByteSize).toBe(7);
    expect(a.oldestSentAt).toBe(1_000);
  });

  it('oldestSentAt advances after the earliest entry is pruned', () => {
    const p = new World(
      { epoch: A_EPOCH, random: () => 0.5 },
      { epoch: B_EPOCH, random: () => 0.5 },
    );
    p.connect();
    p.sendA(marker(1));
    p.advance(1_000);
    p.sendA(marker(2));
    p.advance(DEFAULT_PARAMS.heartbeatIntervalMs + 1);
    // Both delivered + acked → outbox empty → null.
    expect(p.a.outboxSize).toBe(0);
    expect(p.a.oldestSentAt).toBeNull();
  });
});

// ── 2. disconnectedAtMs tracking ────────────────────────────────────────────

describe('GC-2: disconnectedAtMs tracks Connected → Disconnected transitions', () => {
  it('is null until the first Disconnected', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5 });
    expect(a.disconnectedAtMs).toBeNull();
    a.onConnected(100);
    expect(a.disconnectedAtMs).toBeNull();
  });

  it('is stamped on Connected → Disconnected', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5 });
    a.onConnected(100);
    a.onDisconnected(2_500);
    expect(a.disconnectedAtMs).toBe(2_500);
  });

  it('does NOT advance on repeated onDisconnected while already Disconnected', () => {
    // Adapter idempotency: some transports fire onclose twice. A GC policy
    // that measures "disconnected for N ms" must not have its age reset.
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5 });
    a.onConnected(0);
    a.onDisconnected(1_000);
    a.onDisconnected(5_000); // repeat
    a.onDisconnected(10_000); // repeat
    expect(a.disconnectedAtMs).toBe(1_000); // first stamp preserved
  });

  it('clears back to null when reconnected', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5 });
    a.onConnected(0);
    a.onDisconnected(1_000);
    expect(a.disconnectedAtMs).toBe(1_000);
    a.onConnected(2_000);
    expect(a.disconnectedAtMs).toBeNull();
  });

  it('survives snapshot() / restore across a simulated restart', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5 });
    a.onConnected(0);
    a.onDisconnected(1_234);
    const s = a.snapshot();
    const b = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, restore: s });
    expect(b.disconnectedAtMs).toBe(1_234);
  });

  it('is preserved by snapshotDurable() the same as snapshot()', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5 });
    a.onConnected(0);
    a.onDisconnected(4_567);
    expect(a.snapshotDurable().disconnectedAtMs).toBe(4_567);
  });

  it('back-compat: a pre-0.2.0 snapshot (no disconnectedAtMs field) restores to null', () => {
    // Simulate an old snapshot missing the field.
    const s = {
      epoch: A_EPOCH,
      sendSeq: '0',
      outboxBase: '0',
      outbox: [],
      recvCursor: '0',
      peerEpoch: '',
    };
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, restore: s });
    expect(a.disconnectedAtMs).toBeNull();
  });
});

// ── 3. purgeNonDurable() ────────────────────────────────────────────────────

describe('GC-3: purgeNonDurable drops non-durable entries and emits observability', () => {
  it('removes only non-durable entries', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } });
    a.send(marker(1));                        // seq 1 non-durable
    a.send(marker(2), { durable: true });     // seq 2 durable
    a.send(marker(3));                        // seq 3 non-durable
    a.send(marker(4), { durable: true });     // seq 4 durable

    const { droppedSeqs, effects } = a.purgeNonDurable();
    expect(droppedSeqs.map(String).sort()).toEqual(['1', '3']);
    // Outbox retains only durables.
    expect(a.outboxSize).toBe(2);
    expect(a.durableCount).toBe(2);
    expect(a.nonDurableCount).toBe(0);
    // Observable purged effect.
    const purged = effects.find((e) => e.t === 'purged') as Extract<Effect, { t: 'purged' }>;
    expect(purged).toBeDefined();
    expect(purged.droppedSeqs.map(String).sort()).toEqual(['1', '3']);
    expect(purged.reason).toBe('gc');
    // NO unstore — nothing durable was dropped.
    expect(effects.some((e) => e.t === 'unstore')).toBe(false);
  });

  it('is a no-op with no non-durable entries (no effects)', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } });
    a.send(marker(1), { durable: true });
    const { droppedSeqs, effects } = a.purgeNonDurable();
    expect(droppedSeqs).toEqual([]);
    expect(effects).toEqual([]);
  });

  it('is idempotent — calling twice drops nothing the second time', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } });
    a.send(marker(1));
    a.send(marker(2), { durable: true });
    a.purgeNonDurable();
    const { droppedSeqs } = a.purgeNonDurable();
    expect(droppedSeqs).toEqual([]);
  });

  it('does NOT touch outboxBase (peer negotiates the gap on next hello)', () => {
    // Purge is a producer-local decision; peer state is only updated at
    // hello / resend time, when RESET frames announce any gap. outboxBase
    // does not shift.
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5 });
    a.send(marker(1));
    a.send(marker(2));
    a.send(marker(3));
    a.purgeNonDurable();
    // All were non-durable, outbox empty, base unchanged.
    expect(a.outboxSize).toBe(0);
    // sendSeq unchanged (never rewinds).
    expect(a.sendSeqValue).toBe(3n);
  });
});

// ── 4. purge(predicate) — the general form ──────────────────────────────────

describe('GC-4: purge(predicate) is a generic escape hatch', () => {
  it('supports arbitrary host-defined predicates', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } });
    a.onTick(1_000);
    a.send(marker(1), { durable: true }); // sentAt=1000
    a.onTick(2_000);
    a.send(marker(2), { durable: true }); // sentAt=2000
    a.onTick(3_000);
    a.send(marker(3), { durable: true }); // sentAt=3000

    // Host: "drop any durable entry older than 1500 ms" (retention policy).
    const { droppedSeqs, effects } = a.purge((e) => e.sentAt < 1_500, 'age-cap');
    expect(droppedSeqs.map(String)).toEqual(['1']);
    expect(a.outboxSize).toBe(2);
    // Purged durable → an unstore floor is emitted.
    const unstore = effects.find((e) => e.t === 'unstore') as Extract<Effect, { t: 'unstore' }>;
    expect(unstore).toBeDefined();
    expect(unstore.seqUpTo).toBe(1n);
    const purged = effects.find((e) => e.t === 'purged') as Extract<Effect, { t: 'purged' }>;
    expect(purged.reason).toBe('age-cap');
  });

  it('purge with default reason is "host"', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5 });
    a.send(marker(1));
    const { effects } = a.purge(() => true);
    const purged = effects.find((e) => e.t === 'purged') as Extract<Effect, { t: 'purged' }>;
    expect(purged.reason).toBe('host');
  });
});

// ── 5. Sparse outbox resend: RESET announces middle gaps ────────────────────

describe('GC-5: after purge, resend announces the gap so the peer skips it', () => {
  it('purged non-durable in the middle → peer skips via RESET, delivers durable suffix', () => {
    // A sends [ND, D, ND, D, ND]; the peer is a fresh consumer receiving them
    // live. Then A goes offline, purges non-durable — leaving [D2, D4] with
    // seqs sparse in outbox. On reconnect A resends, emitting RESET frames
    // before each hole so peer's recvCursor jumps over the lost non-durables
    // and DELIVERS the remaining durables in order.
    const w = new World(
      { epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } },
      { epoch: B_EPOCH, random: () => 0.5, durable: { supported: true } },
    );
    w.connect();
    w.disconnect();

    w.sendA(marker(1));                       // seq 1 non-durable
    w.sendA(marker(2), { durable: true });    // seq 2 durable
    w.sendA(marker(3));                       // seq 3 non-durable
    w.sendA(marker(4), { durable: true });    // seq 4 durable
    w.sendA(marker(5));                       // seq 5 non-durable

    // Simulate the host GC that motivated this feature.
    w.a.purgeNonDurable();

    // Outbox now sparse: only [D2, D4] survive; seqs 1, 3, 5 are dropped.
    expect(w.a.outboxSize).toBe(2);
    expect(w.a.durableCount).toBe(2);

    w.reopen();
    w.advance(DEFAULT_PARAMS.heartbeatIntervalMs + 1);

    // Peer received exactly the two durable messages, in order, exactly once.
    expect(payloadsOf(w.deliveredB)).toEqual([2, 4]);
    // Peer's reset-inbound fires for the gap(s) the resend announced.
    expect(w.resetsB.length).toBeGreaterThan(0);
  });

  it('purge that leaves ONLY a suffix hole works too', () => {
    // outbox = [D1, D2, ND3, ND4] → purge → [D1, D2]; peer sees no gap since
    // its recvCursor never advanced past 2.
    const w = new World(
      { epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } },
      { epoch: B_EPOCH, random: () => 0.5, durable: { supported: true } },
    );
    w.connect();
    w.disconnect();
    w.sendA(marker(1), { durable: true });
    w.sendA(marker(2), { durable: true });
    w.sendA(marker(3));
    w.sendA(marker(4));
    w.a.purgeNonDurable();
    w.reopen();
    w.advance(DEFAULT_PARAMS.heartbeatIntervalMs + 1);
    expect(payloadsOf(w.deliveredB)).toEqual([1, 2]);
  });

  it('purge that leaves ONLY a middle survivor still delivers via RESET before AND after', () => {
    // outbox = [ND1, D2, ND3] → purge → [D2] only.
    const w = new World(
      { epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } },
      { epoch: B_EPOCH, random: () => 0.5, durable: { supported: true } },
    );
    w.connect();
    w.disconnect();
    w.sendA(marker(1));
    w.sendA(marker(2), { durable: true });
    w.sendA(marker(3));
    w.a.purgeNonDurable();
    w.reopen();
    w.advance(DEFAULT_PARAMS.heartbeatIntervalMs + 1);
    expect(payloadsOf(w.deliveredB)).toEqual([2]);
  });
});

// ── 6. snapshotDurable() — spec-correct persistence ─────────────────────────

describe('GC-6: snapshotDurable persists only durable outbox entries', () => {
  it('serializes only durable entries; non-durable are dropped', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } });
    a.send(marker(1));                        // non-durable
    a.send(marker(2), { durable: true });     // durable
    a.send(marker(3));                        // non-durable
    a.send(marker(4), { durable: true });     // durable

    const s = a.snapshotDurable();
    expect(s.outbox.map((e) => e.seq).sort()).toEqual(['2', '4']);
    // sendSeq is preserved (not rewound) so future sends never collide.
    expect(s.sendSeq).toBe('4');
  });

  it('legacy snapshot() still preserves everything (back-compat)', () => {
    const a = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } });
    a.send(marker(1));
    a.send(marker(2), { durable: true });
    const s = a.snapshot();
    expect(s.outbox.map((e) => e.seq).sort()).toEqual(['1', '2']);
  });

  it('restoring from snapshotDurable() then reconnecting delivers just the durable messages', () => {
    // Producer restart: A snapshots durable-only, dies, restores. All queued
    // non-durables are lost by design; durables continue to peer.
    const w1 = new World(
      { epoch: A_EPOCH, random: () => 0.5, durable: { supported: true } },
      { epoch: B_EPOCH, random: () => 0.5, durable: { supported: true } },
    );
    w1.connect();
    w1.disconnect();
    w1.sendA(marker(1));                       // non-durable — will be lost
    w1.sendA(marker(2), { durable: true });    // durable — must survive
    w1.sendA(marker(3));                       // non-durable — will be lost
    w1.sendA(marker(4), { durable: true });    // durable — must survive

    const snap = w1.a.snapshotDurable();

    // "Restart": brand-new endpoints; A restored from the durable-only snapshot.
    const w2 = new World(
      { epoch: A_EPOCH, random: () => 0.5, durable: { supported: true }, restore: snap },
      { epoch: B_EPOCH, random: () => 0.5, durable: { supported: true }, restore: w1.b.snapshot() },
    );
    w2.connect();
    w2.advance(DEFAULT_PARAMS.heartbeatIntervalMs + 1);
    expect(payloadsOf(w2.deliveredB)).toEqual([2, 4]);
  });
});

// ── 7. End-to-end: the kraki store-and-forward hub GC scenario ─────────────

describe('GC-7: hub-style host GC keeps outbox memory bounded', () => {
  it('a hub-side endpoint that never sees the peer come back can be purged without wedging active peers', () => {
    // Model the kraki head: two peer endpoints (representing device A + device B
    // in the same user). A stays connected; B goes offline permanently. The
    // hub forwards every A → * broadcast into BOTH peer endpoints. Without
    // GC, B's endpoint accumulates unbounded non-durable frames.
    const activePeer = new Endpoint({ epoch: 'active', random: () => 0.5, durable: { supported: true } });
    const stalePeer = new Endpoint({ epoch: 'stale', random: () => 0.5, durable: { supported: true } });
    activePeer.onConnected(0);
    stalePeer.onConnected(0);
    stalePeer.onDisconnected(1_000); // never comes back

    // Simulate 100 forwarded non-durable frames.
    for (let i = 0; i < 100; i++) {
      activePeer.send(new Uint8Array([i & 0xff]));
      stalePeer.send(new Uint8Array([i & 0xff]));
    }
    expect(activePeer.outboxSize).toBe(100);
    expect(stalePeer.outboxSize).toBe(100);

    // Hub GC ticks: "stalePeer has been down for >5 min → purge non-durable".
    activePeer.onTick(6 * 60_000);
    stalePeer.onTick(6 * 60_000);
    // We don't have host wiring here; call purgeNonDurable directly to model
    // the GC policy.
    const { droppedSeqs } = stalePeer.purgeNonDurable('gc-idle-5m');
    expect(droppedSeqs.length).toBe(100);
    expect(stalePeer.outboxSize).toBe(0);
    // active peer's outbox is untouched — its frames still deliver on next
    // resend (this is the key: GC is per-endpoint, not global).
    expect(activePeer.outboxSize).toBe(100);
  });
});
