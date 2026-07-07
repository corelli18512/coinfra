# @coinfra/pulse

## 0.1.2

### Patch Changes

- 299abab: fix(pulse): peer cold-restart (new epoch) now resets receive cursor

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

## 0.1.1

### Patch Changes

- ed3229d: Ship a dual ESM + CJS build. The package now exposes a `require` entry
  (`dist/index.cjs`) alongside the ESM `dist/index.mjs`, so CJS-first resolvers —
  notably tsx's tsconfig-paths resolver, used by consuming apps that run TypeScript
  sources directly — can resolve the package. Without the CJS entry, those apps
  fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Runtime behavior is unchanged.

## 0.1.0

### Minor Changes

- Initial release: reliable-delivery contract for a breakable WebSocket channel —
  message sequencing, acks, cursor-based resume, and durable outbox. Sans-I/O core
  (bring your own transport + storage), byte-identical TypeScript + Swift ports
  sharing wire fixtures.
