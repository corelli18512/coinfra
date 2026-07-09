# @coinfra/crypto

## 0.2.0

### Minor Changes

- 93a3c77: Add non-extractable CryptoKey support, so private keys never need to exist as
  strings in memory. New surface, fully backward-compatible (the existing
  string-based API is unchanged):

  - `generateEncryptionKeyPairHandle()` / `generateSigningKeyPairHandle()` —
    generate a key pair whose private key is a non-extractable `CryptoKey`
    (returned as `{ publicKey: string; privateKey: CryptoKey }`). The private key
    material never becomes a string, so it can't be read by injected script (XSS)
    or serialized by accident, and the handle can be persisted directly in
    IndexedDB. New `KeyPairHandle` type.
  - `importEncryptionPrivateKey(str)` / `importSigningPrivateKey(str)` — import a
    base64url PKCS#8 private key once into a reusable `CryptoKey`, avoiding a
    re-import on every message (hot-path win for decrypt/sign).
  - `decrypt()`, `decryptFromBlob()` and `signChallenge()` now accept
    `string | CryptoKey` for the private key.

  Also: `encrypt()` now wraps recipients in parallel, and the Web Crypto
  implementation is resolved lazily with a clear error message instead of
  throwing at module load when `globalThis.crypto` is absent.
