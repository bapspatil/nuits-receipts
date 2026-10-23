export interface Env {
  DB: D1Database;
  ORIGINALS: R2Bucket;
  AI_MODE: 'mock' | 'live';
  NUITS_PASSWORD?: string;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  // Deployment settings, parsed and validated by src/config.ts. All optional;
  // see docs/ENVIRONMENT.md for defaults.
  AUTH_USERNAME?: string;
  ALLOWED_SENDER_EMAILS?: string;
  RECEIPT_ADDRESS?: string;
  FORWARD_COPY_TO?: string;
  // Mail to this address is read as a sales invoice (an invoice you sent).
  INVOICES_ADDRESS?: string;
  // Your own names as printed on your sales invoices, comma separated.
  SELLER_NAMES?: string;
  PRODUCTS_JSON?: string;
  DEFAULT_PRODUCT?: string;
  ACCOUNTANT_LABEL?: string;
  SOURCE_REPOSITORY?: string;
  APP_NAME?: string;
  EXPORT_PREFIX?: string;
  APP_BASE_PATH?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_EMAILS?: string;
  SEND_HINT?: string;
  DEFAULT_CURRENCY?: string;
  // Review and matching thresholds; see TUNING_VARS in src/config.ts.
  REVIEW_MIN_CONFIDENCE?: string;
  REVIEW_MAX_UNCERTAINTY?: string;
  REVIEW_MIN_CATEGORY_CONFIDENCE?: string;
  MATCH_DAYS_BEFORE?: string;
  MATCH_DAYS_AFTER?: string;
  MATCH_NAME_SIMILARITY?: string;
  SALES_MATCH_DAYS_BEFORE?: string;
  SALES_MATCH_DAYS_AFTER_DUE?: string;
  PAYMENT_TERMS_DAYS?: string;
  // Optional OneDrive upload. MS_CLIENT_ID is a var; the other two are secrets.
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  ONEDRIVE_TOKEN_KEY?: string;
}
