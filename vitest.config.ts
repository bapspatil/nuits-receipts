import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: './wrangler.local.jsonc' },
      miniflare: {
        bindings: {
          NUITS_PASSWORD: 'local-dummy-password',
          // Synthetic identities only. Products match wrangler.local.jsonc.
          AUTH_USERNAME: 'owner',
          ALLOWED_SENDER_EMAILS: 'owner@example.com, bookkeeping@example.org, sender@example.net',
          RECEIPT_ADDRESS: 'receipts@example.com',
          SAMPLE_PDF: readFileSync('scripts/sample-receipts/sample.pdf').toString('base64'),
          BLANK_PDF: readFileSync('test/fixtures/blank.pdf').toString('base64'),
          TOO_MANY_PAGES_PDF: readFileSync('test/fixtures/too-many-pages.pdf').toString('base64'),
          // test/flags.test.ts scans the source for emitted review codes; the
          // font test checks the bundled fonts match the site's files.
          SOURCE_FILES: JSON.stringify(
            Object.fromEntries(
              readdirSync('src')
                .filter((name) => name.endsWith('.ts') && name !== 'fonts.ts')
                .map((name) => [name, readFileSync(`src/${name}`, 'utf8')]),
            ),
          ),
          // site/ is not part of the public template, so the drift check is
          // skipped there.
          SITE_FONTS: !existsSync('site/public/fonts')
            ? ''
            : JSON.stringify(
                Object.fromEntries(
                  ['bricolage.woff2', 'instrument-sans.woff2'].map((name) => [
                    name,
                    readFileSync(`site/public/fonts/${name}`).toString('base64'),
                  ]),
                ),
              ),
          // Tests run against the public bootstrap. scripts/schema.test.ts proves it
          // matches the private migrations/ chain.
          TEST_MIGRATIONS: await readD1Migrations('./schema'),
          TEST_UPGRADE_MIGRATIONS: existsSync('./migrations') ? await readD1Migrations('./migrations') : [],
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
  },
});
