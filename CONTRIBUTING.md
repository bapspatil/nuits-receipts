# Contributing

Thanks for helping. This is a small project, so keep changes focused.

## Before you start

- Open an issue first for anything bigger than a small fix, so we can agree on the direction.
- Never paste real receipts, bank statements, account IDs, API tokens or passwords into an issue or pull request. Use the synthetic files in `scripts/sample-receipts/` or make up values.
- Security problems go to the address in [SECURITY.md](SECURITY.md), not to a public issue.

## Set up and check

```sh
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
bun run migrate
bun run dev
bun run check     # typecheck, lint and tests; run it before you open a pull request
```

If you change `docs-site/` or `site/`, also run `bun run build` in that folder. The build checks the copy rules in `docs-site/WRITING.md`.

## Pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) for the title (`fix:`, `feat:`, `docs:`). Releases are versioned from them; see [docs/RELEASING.md](docs/RELEASING.md).
- Add or update tests for behaviour changes. Tests must not call the network.
- Keep the wording honest: the app suggests, prepares and reads with AI. It does not guarantee accuracy, compliance or tax correctness.
- Do not add scheduled (cron) workflows.

By contributing you agree that your work is licensed under the [Apache License 2.0](LICENSE).
