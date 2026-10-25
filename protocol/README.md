# Clickaa protocol

`clickaa/v1/*.proto` is the single source of truth for every message between
the core and any runtime. TypeScript mirrors live in `core/src/types.ts`
until protobuf codegen is added.

Rules:
- Never add an untyped field; extend a spec or add a version.
- Commands are versioned (`v1`); capabilities are advertised, not assumed.
- Approvals are protocol objects, not UI-side checks.
