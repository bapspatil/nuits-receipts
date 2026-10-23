# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email **hi@brandnuits.com** with:

- what you found and where (file, route or setting);
- the steps to reproduce it, using sample data only;
- the version you tested (shown in the app footer, or `version` in `package.json`).

Do not include real receipts, bank statements, account IDs, API tokens or passwords. If you accidentally exposed a secret of your own, rotate it first.

This is a small open-source project run by one person. Reports are read and answered on a best-effort basis, with no promised response time or fix date.

## Supported versions

Only the latest release is supported. Fixes land on `main` and in a new release.

## Scope

Nuits Receipts runs in your own Cloudflare account, so you are responsible for your deployment, its access controls (Cloudflare Access is recommended), your secrets and the personal data in your receipts. See the [privacy and outside calls](https://receipts.nuits.net/docs/explanation/privacy-and-your-data/) documentation for what the app sends where.

Issues in Cloudflare's own products or in third-party dependencies are best reported to their maintainers.
