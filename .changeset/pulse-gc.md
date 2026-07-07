---
"@coinfra/pulse": minor
---

feat(pulse): host-driven outbox lifecycle (GC) — spec §11

New surface, all backward-compatible:

**Introspection getters** — let a host key GC decisions on outbox state:
`outboxByteSize`, `durableCount`, `nonDurableCount`, `oldestSentAt`,
`disconnectedAtMs` (public; preserved across snapshot/restore).

**Purge APIs** — the host's escape hatch when the peer is permanently gone
(revoked device, closed tab, hub churn artifact):

- `purge(predicate, reason)` — drops entries matching predicate; emits
  `unstore(seqUpTo)` for any dropped durables and observational
  `purged(droppedSeqs, reason)`.
- `purgeNonDurable(reason='gc')` — common-case convenience.

**Snapshot separation** — fixes a spec violation:

- `snapshot()` unchanged (all outbox, back-compat).
- `snapshotDurable()` new: only durable entries. This is the spec-correct
  form for restart-persistence; non-durables are "in-memory only, may be
  lost on restart" (§8.1) so persisting them both breaks the contract AND
  causes unbounded memory growth if the host writes snapshots aggressively
  (each save duplicates the same in-memory outbox into a growing disk state
  — the exact root cause of the kraki head OOM discovered on 2026-07-07).

**Sparse outbox is now allowed.** After `purge` or restore from
`snapshotDurable`, the outbox may contain holes in seq space. `resendFrom`
walks entries in seq order and emits `RESET{oldest = e.seq}` before any
entry not contiguous with the previous one, so the peer's `recvCursor`
skips the purged range and delivery of surviving entries continues in
order, exactly once.

**disconnectedAtMs tracking**: recorded on Connected→Disconnected
transition, NOT reset by repeated `onDisconnected` (adapter idempotency),
cleared to null on reconnect, preserved across snapshot/restore. Lets a
host GC policy safely key on "peer offline continuously for N ms".

**Spec adds §11 "Host-driven outbox lifecycle (GC)"** + two new failure
catalog rows: `GC-NON-DURABLE` and `SPARSE-RESUME`.

**Test coverage**:
- TS: 115 tests (was 93; 22 new gc tests)
- Swift: 64 tests (was 48; 16 new gc tests)
- Byte-identical wire behavior; existing DURABLE / SCENARIO / SLOW-NETWORK
  / PROPERTY / INTEGRATION suites unchanged.

No breaking changes: existing hosts that never call the new APIs behave
identically to 0.1.x.
