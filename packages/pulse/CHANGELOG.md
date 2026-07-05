# @coinfra/pulse

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
