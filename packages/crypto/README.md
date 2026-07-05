# @coinfra/crypto

**Hybrid end-to-end encryption primitives: RSA-OAEP key wrapping + AES-256-GCM.
Multi-recipient, blob encoding, and challenge-response signing. No dependencies.**

`@coinfra/crypto` provides the Node.js crypto primitives for multi-recipient message
encryption, compact key export, blob encoding, and challenge-response signing. It knows
nothing about any application — it moves opaque strings.

## Install

```bash
pnpm add @coinfra/crypto
```

## What it includes

- RSA-OAEP 4096-bit key generation
- AES-256-GCM payload encryption
- per-recipient wrapped keys for multi-device delivery
- blob encoding: `base64(iv ‖ ciphertext ‖ tag)`
- blob-level encrypt/decrypt helpers
- compact public-key export/import helpers
- challenge signing and verification helpers
- stable `canonicalJson` for signable payloads

## How it works

One random AES-256 key per message encrypts the payload with AES-256-GCM. That AES key is
then wrapped once per recipient with the recipient's RSA public key (RSA-OAEP, SHA-256).
Each recipient unwraps their copy of the AES key with their private key, then decrypts the
single shared ciphertext. GCM's auth tag makes any tampering (ciphertext, IV, tag, or a
wrapped key) fail loudly on decrypt.

## Blob API

### `encryptToBlob(plaintext, recipients)` → `{ blob, keys }`

Encrypts a plaintext string for one or more recipients. Returns a single base64 blob
(`iv ‖ ciphertext ‖ tag`) and a map of wrapped AES keys, one per recipient device.

### `decryptFromBlob({ blob, keys }, deviceId, privateKey)` → `plaintext`

Decrypts a blob using the calling device's private key. Looks up the wrapped key by
`deviceId`, unwraps it with RSA-OAEP, and decrypts the blob.

### `payloadToBlob(payload)` → `blobPayload`

Converts a separated payload (iv, ciphertext, tag, keys) into the consolidated blob format.

### `blobToPayload(blobPayload)` → `payload`

Converts a blob payload back into separated fields. Useful for interop or debugging.

## Blob format

The blob is a single base64 string encoding the concatenation of:

1. **IV** — 12 bytes (AES-256-GCM initialization vector)
2. **Ciphertext** — variable length
3. **Tag** — 16 bytes (GCM authentication tag)

This keeps the wire format compact — one string instead of three separate fields.

## Example

```ts
import { generateKeyPair, encryptToBlob, decryptFromBlob } from '@coinfra/crypto';

const alice = generateKeyPair();

const { blob, keys } = encryptToBlob('hello', [
  { deviceId: 'alice', publicKey: alice.publicKey },
]);

const plaintext = decryptFromBlob({ blob, keys }, 'alice', alice.privateKey);
```

## Challenge-response

```ts
import { signChallenge, verifyChallenge, canonicalJson } from '@coinfra/crypto';

const canonical = canonicalJson({ sub: 'user', exp: 2000 }); // stable, sorted keys
const sig = signChallenge(canonical, alice.privateKey);
verifyChallenge(canonical, sig, alice.publicKey); // true
```

This package targets Node.js via the built-in `node:crypto` module. A Web Crypto port would
share the same interface.
