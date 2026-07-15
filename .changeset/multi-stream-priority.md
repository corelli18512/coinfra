---
'@coinfra/pulse': minor
---

Multi-stream priority isolation (spec §13): one shared link can now carry N
independent Pulse streams, each a full Endpoint with its own epoch / seq /
outbox / cursor / handshake. A 1-byte `streamId` in the v2 wire header routes
frames to the owning stream.

This eliminates cross-stream head-of-line blocking: a bulk stream (history
replay, turn-trace batches, attachment chunks) can no longer delay a live
stream (echo, abort, status card) sharing the link. Each stream has its own seq
space, so a live message is never queued behind bulk seqs. `onTick` visits
streams in ascending id order so a low-id (live) stream's transmits emit first.

- Wire: `encodeFrame(f, streamId)`; `streamId === 0` encodes as v1
  (byte-identical to pre-§13), `streamId > 0` as v2. `decodeFrameWithStream`
  returns `{frame, streamId}` and accepts both versions; `decodeFrame` is the
  stream-0 convenience wrapper.
- `Endpoint` takes an optional `streamId` (default 0); single-stream usage is
  unchanged. New public `onFrame(frame, now)` lets a demuxer feed pre-decoded
  frames.
- New `StreamSet` multiplexes endpoints on one link: `onConnected` /
  `onDisconnected` broadcast, `onBytes` demuxes by streamId, `onTick` schedules
  in ascending stream order.

Backward compatible: stream 0 peers interoperate with pre-§13 peers unchanged.
Using stream ids > 0 requires both peers to speak v2. TypeScript 149/149,
Swift 85/85 (incl. a HOL-isolation test proving a live message delivers before
20 bulk messages piled on a separate stream).
