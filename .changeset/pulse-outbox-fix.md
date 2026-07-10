---
"@coinfra/pulse": patch
---

Fix: outboxBase could exceed sendSeq after a restart, permanently wedging the link

Root cause of the 2026-07-10 kraki prod outage. When a durable-supported
endpoint (kraki's head relay) restarted from a durable-only snapshot, its
`sendSeq` was rewound to the last persisted durable send — but the peer
(tentacle) did not restart and still advertised a `recvCursor` higher than
the restored `sendSeq` (it had received non-durable messages that were lost
in the crash). `pruneOutbox` blindly set `outboxBase = recvCursor`, racing
it past `sendSeq`.

On the NEXT fresh reconnect (peer recvCursor=0), the peer's seq=1..N frames
were treated as duplicates (≤ outboxBase) and silently dropped — permanently
wedging the link in both directions.

Fix (two layers):
- `pruneOutbox`: clamp `outboxBase = min(ackSeq, sendSeq)` so it can never
  exceed the highest seq we've actually sent.
- `loadSnapshot`: defensively clamp `outboxBase = min(outboxBase, sendSeq)`
  on restore, so snapshots persisted by pre-0.3.1 versions (already
  corrupted on disk) self-heal on load instead of re-introducing the wedge.
