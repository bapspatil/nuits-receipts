# migrations/

The upgrade chain for databases created before `schema/` existed, including the maintainer's own deployment. Wrangler tracks these by filename in the `d1_migrations` table, so never rename or change a file that has been applied. Add new upgrades as new numbered files.

New installs use `schema/` (ledger `template_migrations`) through `bun run setup` and `bun run deploy`. `scripts/schema.test.ts` and `test/migrations.test.ts` check that both chains end in the same schema.

The product names in the `CHECK` list in `0001_initial.sql` are historical. `0004_csv_accounts.sql` replaces that constraint with a length check.
