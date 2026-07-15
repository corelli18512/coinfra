---
'@coinfra/pulse': patch
---

Carry `streamId` on store/unstore/acked/purged effects (not just deliver), so a
store-and-forward hub can key durable outbox entries per (device, stream, seq)
instead of colliding across independent seq spaces (live seq=5 vs bulk seq=5).
