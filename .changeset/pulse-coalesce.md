---
"@coinfra/pulse": minor
---

feat(pulse): send-time coalescing (`coalesceKey`) — spec §12

New, fully backward-compatible surface for **state-covering** message streams
(UI deltas, current-card state) where only the latest value matters:

**API** — `send(payload, { coalesceKey })`:

- Before appending, drops every existing outbox entry with the same
  `coalesceKey`; the new message gets a fresh seq. Dropped seqs become gaps
  the peer skips via the existing RESET-on-resend path (same mechanism as
  `purge*`) — no new consumer logic.
- Mutually exclusive with `durable`: passing both throws
  (`coalesceKey requires durable=false`).
- In-flight entries (transmitted, not yet ACKed) are coalesceable — downstream
  apps must treat coalesced payloads as state snapshots, not incremental
  deltas.
- Emits an observational `purged(droppedSeqs, reason: 'coalesced:<key>')`.

**Wire** — DATA frame gains flag bit 1 + an optional trailing `coalesceKey`
str (≤255 UTF-8 bytes). Old decoders read the payload blob and stop, ignoring
the trailing bytes, so old ↔ new is compatible in both directions. Frames
without a `coalesceKey` are byte-identical to the 0.2 layout.

**Effect** — `deliver` now carries `coalesceKey?: string` so a bridging hub
(kraki head) can re-apply the same key when forwarding onto the next hop.

**Snapshot** — `OutboxEntry` gains `coalesceKey?: string`; pre-0.3 snapshots
deserialize with `coalesceKey=undefined` (no behavior change).
