# Repository Guidelines

## Project Structure & Module Organization
- `entrypoints/` holds browser extension surfaces: `background.ts`, `content.ts`, and the React popup under `popup/`.
- `assets/` stores reusable media referenced via the `@/` alias; `public/` contains shipped icons and static files copied as-is.
- `tests/` collects Vitest suites; mirror entrypoint names (e.g., `tests/popup/`) as coverage grows.
- Build configuration lives in `wxt.config.ts`; TypeScript options extend WXT defaults through `tsconfig.json`.
- Keep feature-specific utilities near their entrypoint, creating subdirectories inside `entrypoints/` when logic grows.

## Build, Test, and Development Commands
- `pnpm install` syncs dependencies and runs `wxt prepare` to scaffold WXT internals.
- `pnpm dev` (or `pnpm dev:firefox`) launches the live-reload extension runner in Chromium or Firefox.
- `pnpm build` generates a production bundle in `dist/`; add `:firefox` for Gecko assets.
- `pnpm zip` packages the latest build for store submission; run after a clean `pnpm build`.
- `pnpm compile` executes `tsc --noEmit` for a fast type-only regression check.
- `pnpm test` runs Vitest in watch mode; append `-- --run` for a single CI-friendly pass.

## Coding Style & Naming Conventions
- Write TypeScript-first React components; prefer function components with hooks.
- Match the existing 2-space indentation, trailing commas, and double-quote JSX props produced by default Prettier settings.
- Use `PascalCase` for components (`App.tsx`), `camelCase` for helpers, and kebab-case for folders within `entrypoints/`.
- Keep imports path-based, favoring the WXT alias (`@/assets/...`) when referencing shared resources.

## Testing Guidelines
- Vitest is configured in `vitest.config.ts`; author unit tests under `tests/` or beside modules as `*.test.ts[x]`.
- Use `pnpm test` during development, `pnpm test -- --run` in CI, and add `--coverage` when validating broader changes.
- Provide smoke tests for new entrypoints and utilities; keep assertions deterministic to avoid browser-specific flakes.
- Validate extension behavior in both Chromium and Firefox when APIs differ, noting gaps in the PR description.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`type: summary`) as seen in `chore: init repo with wxt`; use present-tense summaries under 75 characters.
- Push focused branches, link tracking issues, and include screenshots or screen captures for UI changes in the popup.
- Describe verification steps (commands run, browsers tested) and call out any follow-up work or known limitations.
