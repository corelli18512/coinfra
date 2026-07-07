---
"@coinfra/pulse": patch
---

fix(pulse): peer cold-restart (new epoch) now resets receive cursor

When a peer cold-restarts (fresh epoch, no restored state, sendSeq back to 1),
its next HELLO advertises a new `epoch` while our `recvCursor` still points at
the old stream's tail. Without dropping our stale cursor, the peer's fresh
seq=1..N frames matched onData's duplicate check (`f.seq <= recvCursor`) and
were silently dropped as duplicates — the peer's new stream never delivered
until the connection was fully reset.

Now `onHello` detects `peerEpoch != ''` && `f.epoch != peerEpoch` (peer
cold-restart), sets `recvCursor = 0`, and emits `ResetInbound(1, newEpoch)`
so the application learns history was dropped. Peer's new stream is then
accepted from seq=1 as expected by the RESTART-FRESH row in spec §9.

Scenario in the wild: kraki daemon restart with an arm session still open —
arm collected no fresh device_greeting / device_joined until the arm tab was
hard-reloaded. TS + Swift ports both updated; spec §5.3 gains an explicit
"check (0)" for the peer-restart case; test coverage added to both ports.
