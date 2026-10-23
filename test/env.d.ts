import type { Env as AppEnv } from '../src/env';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import '@cloudflare/vitest-pool-workers/types';
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
      TEST_UPGRADE_MIGRATIONS: D1Migration[];
      SAMPLE_PDF: string;
      BLANK_PDF: string;
      TOO_MANY_PAGES_PDF: string;
      SOURCE_FILES: string;
      SITE_FONTS: string;
    }
  }
}
