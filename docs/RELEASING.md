# Releasing

The version follows [Semantic Versioning](https://semver.org) and nobody edits it by hand. `scripts/version.mjs` reads the Conventional Commits since the last `v*` tag and decides the bump.

Releasing a version and deploying it are separate. A release tags the code; each deployment owner decides when to run `bun run deploy`.

This repository is the only source. Releases are cut here, and there is no separate snapshot step.

## How a commit moves the version

| Commit | Bump | Changelog section |
| --- | --- | --- |
| `fix(...)`, `hotfix(...)` | patch | Hotfixes |
| `perf(...)`, `revert(...)` | patch | Hotfixes, or UI enhancements for a UI scope |
| `style(...)` | patch | UI enhancements |
| `feat(...)` | minor | Features, or UI enhancements for a UI scope |
| `type!` or a `BREAKING CHANGE:` footer | major | Breaking changes |
| `docs`, `test`, `chore`, `ci`, `build`, `refactor`, `copy`, `update` | none | not listed |

UI scopes are `a11y`, `design`, `footer`, `style` and `ui` (`UI_SCOPES` in `scripts/version.mjs`). The highest level in the range wins. Subjects that are not Conventional Commits are ignored and reported. Merge commits are skipped. Squash-merge PRs with a conventional title.

## Cutting a release

`.github/workflows/release.yml` runs on pushes to `main` and on manual dispatch, never on a schedule. It does the steps below. To run them locally on an up-to-date `main`:

```sh
bun run version:next                 # read-only: prints the plan as JSON
bun run version:apply > plan.json    # rewrites package.json and prepends CHANGELOG.md
```

- `"action": "baseline"` (first run, no tag yet): `git tag -a vX.Y.Z -m "Release baseline vX.Y.Z"` for the current `package.json` version, push the tag, and create a GitHub Release for it.
- `"action": "release"`: `git add package.json CHANGELOG.md && git commit -m "chore(release): vX.Y.Z"`, `git tag -a vX.Y.Z -m "Release vX.Y.Z"`, push `main` and the tag, then `bun scripts/version.mjs notes X.Y.Z > notes.md && gh release create vX.Y.Z --title vX.Y.Z --notes-file notes.md`.
- `"action": "skip"`: nothing to release.

Nothing is published to npm.

## Version in the UI

`src/ui.ts` imports `version` from `package.json` and prints it in every page footer. If `SOURCE_REPOSITORY` is set, the version links to `<SOURCE_REPOSITORY>/releases/tag/vX.Y.Z`. Wrangler bundles the JSON at build time, so the deployed footer shows the version of the deployed commit.

## Before a release

```sh
bun run typecheck && bun run lint && bun run test && bun run test:scripts
bun run deploy -- --dry-run
```

## Upgrading a deployment

`bun run deploy` lists pending D1 migrations before deploying. Back up first: `bunx wrangler d1 export DB --remote --output backup.sql --config <your config>`, and note a Time Travel bookmark with `bunx wrangler d1 time-travel info DB --config <your config>`. D1 also captures a backup when migrations are applied.

## Failure path

- **Push rejected:** no tag or release was created. Fix it and rerun; the plan is recomputed from scratch.
- **Tag exists, release does not:** `bun scripts/version.mjs notes X.Y.Z > notes.md`, then `gh release create vX.Y.Z --notes-file notes.md`.
- **Mis-typed commit:** land a correcting commit. Never move or delete a published tag.
