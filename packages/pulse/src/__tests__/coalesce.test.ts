/**
 * Send-time coalescing (`coalesceKey`) — spec §12.
 *
 * A message sent with `{ coalesceKey: k }` supersedes any earlier un-drained
 * outbox entry with the same key: the earlier ones are dropped before the new
 * one is appended. This turns "state-covering" streams (deltas, card state)
 * into last-one-wins, so a peer that was offline gets ONE current snapshot on
 * reconnect instead of a replayed burst of stale frames.
 *
 * Dropped seqs become gaps; the peer skips them via the same RESET-on-resend
 * path that `purge*` already uses — no new consumer logic.
 */

import { describe, expect, it } from 'vitest';
import { Endpoint } from '../endpoint.js';
import { marker, payloadsOf, seqsOf, World } from './harness.js';

const A_EPOCH = 'node-A';
const B_EPOCH = 'phone-B';

function makeWorld(): World {
  const random = () => 0.5;
  return new World({ epoch: A_EPOCH, random }, { epoch: B_EPOCH, random });
}

describe('COALESCE-BASIC: an offline producer collapses same-key sends to one', () => {
  it('keeps only the latest same-key entry in the outbox', () => {
    const w = makeWorld(); // starts disconnected
    for (let i = 1; i <= 100; i++) w.sendA(marker(i), { coalesceKey: 'k1' });
    // 100 sends, 99 coalesced away ⇒ a single surviving entry (the last).
    expect(w.a.outboxSize).toBe(1);
    // Each send after the first emits a `purged` effect for the one it dropped.
    expect(w.purgedA.length).toBe(99);
    expect(w.purgedA.at(-1)).toEqual({ droppedSeqs: [99n], reason: 'coalesced:k1' });
  });

  it('delivers exactly one payload (the latest) on reconnect, with its key', () => {
    const w = makeWorld();
    for (let i = 1; i <= 100; i++) w.sendA(marker(i), { coalesceKey: 'k1' });
    w.connect();
    expect(w.deliveredB.length).toBe(1);
    expect(payloadsOf(w.deliveredB)).toEqual([100]); // last one wins
    expect(seqsOf(w.deliveredB)).toEqual([100n]); // fresh seq, dropped seqs skipped
    // The coalesce hint rides the wire and surfaces on the deliver effect so a
    // bridging hub can re-apply it on the next hop.
    expect(w.deliveredB[0]!.coalesceKey).toBe('k1');
    // Peer was told to skip the 1..99 gap (reset-inbound at the coalesced seq).
    expect(w.resetsB.at(-1)).toEqual({ fromSeq: 100n, peerEpoch: A_EPOCH });
  });
});

describe('COALESCE-MIXED: distinct keys and unkeyed events coexist', () => {
  it('keeps one-per-key plus every unkeyed message, ordered by seq', () => {
    const w = makeWorld();
    for (let i = 0; i < 10; i++) w.sendA(marker(10 + i), { coalesceKey: 'k1' });
    for (let i = 0; i < 10; i++) w.sendA(marker(30 + i), { coalesceKey: 'k2' });
    for (let i = 0; i < 5; i++) w.sendA(marker(50 + i)); // unkeyed events

    // 1 latest k1 + 1 latest k2 + 5 unkeyed = 7.
    expect(w.a.outboxSize).toBe(7);

    w.connect();
    // Delivered in seq order: k1-latest(seq10), k2-latest(seq20), then 5 events.
    expect(payloadsOf(w.deliveredB)).toEqual([19, 39, 50, 51, 52, 53, 54]);
    expect(seqsOf(w.deliveredB)).toEqual([10n, 20n, 21n, 22n, 23n, 24n, 25n]);
  });
});

describe('COALESCE-GAP: a superseded message is skipped, consumer sees no error', () => {
  it('drops an already-delivered same-key entry and delivers only the survivor', () => {
    const w = makeWorld();
    w.connect();
    w.sendA(marker(1), { coalesceKey: 'k1' }); // delivered live
    expect(payloadsOf(w.deliveredB)).toEqual([1]);

    w.disconnect();
    w.sendA(marker(2), { coalesceKey: 'k1' }); // supersedes seq1 (already gone to B)
    w.sendA(marker(3), { coalesceKey: 'k1' }); // supersedes seq2 (never sent)
    expect(w.a.outboxSize).toBe(1);

    w.reopen();
    // seq2 was coalesced away and never delivered; consumer jumps 1 → 3 cleanly.
    expect(payloadsOf(w.deliveredB)).toEqual([1, 3]);
    expect(seqsOf(w.deliveredB)).toEqual([1n, 3n]);
  });
});

describe('COALESCE-DURABLE: coalesceKey and durable are mutually exclusive', () => {
  it('throws when both are requested (fail-loud API)', () => {
    const w = makeWorld();
    expect(() => w.a.send(marker(1), { durable: true, coalesceKey: 'k' })).toThrow(
      /coalesceKey requires durable=false/,
    );
  });

  it('allows coalesceKey with an explicit durable:false', () => {
    const w = makeWorld();
    expect(() => w.a.send(marker(1), { durable: false, coalesceKey: 'k' })).not.toThrow();
  });
});

describe('COALESCE-SNAPSHOT: coalesceKey survives snapshot round-trip', () => {
  it('a restored keyed entry still coalesces against a fresh same-key send', () => {
    const w = makeWorld();
    w.sendA(marker(1), { coalesceKey: 'k1' });
    w.sendA(marker(2), { coalesceKey: 'k1' }); // outbox: [seq2 k1]

    const snap = w.a.snapshot();
    expect(snap.outbox.length).toBe(1);
    expect(snap.outbox[0]!.coalesceKey).toBe('k1');

    // Full restart of A from the snapshot.
    const restored = new Endpoint({ epoch: A_EPOCH, random: () => 0.5, restore: snap });
    expect(restored.outboxSize).toBe(1);

    // A fresh k1 send must coalesce the RESTORED entry away — only possible if
    // coalesceKey deserialized correctly.
    const { effects } = restored.send(marker(3), { coalesceKey: 'k1' });
    expect(restored.outboxSize).toBe(1);
    expect(effects).toContainEqual({ t: 'purged', droppedSeqs: [2n], reason: 'coalesced:k1' });
  });
});
