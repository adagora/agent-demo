## Build & Run

Succinct rules for how to BUILD the project:

- **Build**: `bun build src/agent.ts --outdir dist --target bun`
- **Dev (watch)**: `bun --watch src/agent.ts`

## Validation

Run these after implementing to get immediate feedback:

- **Tests**: `bun test` (full suite) or `bun test --watch` (watch mode)
- **Typecheck**: `bun x tsc --noEmit`
- **Lint**: `bun x eslint src --ext .ts` (fix with `--fix` flag)
- Use `bun x tsc --noEmit && bun test && bun x eslint src --ext .ts` for complete validation
