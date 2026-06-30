import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('user_role', [
  'superadmin',
  'admin',
  'mitarbeiter',
  'kunde',
]);
export type Role = (typeof roleEnum.enumValues)[number];

export const recordStatusEnum = pgEnum('record_status', [
  'verfuegbar',
  'reserviert',
  'verkauft',
  'verliehen',
]);
export type RecordStatus = (typeof recordStatusEnum.enumValues)[number];

export const discogsListingStatusEnum = pgEnum('discogs_listing_status', [
  'not_listed',
  'pending',
  'listed',
  'failed',
]);
export type DiscogsListingStatus = (typeof discogsListingStatusEnum.enumValues)[number];

// ── Registry tables (no tenant RLS) ─────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  domain: text('domain'),
  /** { branding: { primaryColor: string; logo: string | null } } */
  config: jsonb('config').notNull().default({}),
  plan: text('plan').notNull().default('free'),
  limits: jsonb('limits').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const plans = pgTable('plans', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  priceMonthlyCents: integer('price_monthly_cents').notNull().default(0),
  limits: jsonb('limits').notNull().default({}),
  features: jsonb('features').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Tenant-scoped tables (RLS applied in 0001_rls.sql) ───────────────────────

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull(),
    password: text('password').notNull(),
    role: roleEnum('role').notNull().default('kunde'),
    isSuperadmin: boolean('is_superadmin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    emailTenantUnique: unique('users_email_tenant').on(t.email, t.tenantId),
  }),
);

export const userDetail = pgTable('user_detail', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name'),
  surname: text('surname'),
});

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const records = pgTable(
  'records',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text('title').notNull(),
    artist: text('artist').notNull(),
    label: text('label')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    country: text('country'),
    releaseYear: integer('release_year'),
    format: text('format'),
    genre: text('genre')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    coverImage: text('cover_image'),
    discogsId: integer('discogs_id'),
    /** sha256 hex — dedup key; see src/db/hash.ts */
    hash: varchar('hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    hashTenantUnique: unique('records_hash_tenant').on(t.hash, t.tenantId),
  }),
);

export const purchases = pgTable(
  'purchases',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    recordId: integer('record_id')
      .notNull()
      .references(() => records.id),
    purchasePrice: numeric('purchase_price', { precision: 10, scale: 2 }),
    targetPrice: numeric('target_price', { precision: 10, scale: 2 }),
    soldPrice: numeric('sold_price', { precision: 10, scale: 2 }),
    soldDate: timestamp('sold_date', { withTimezone: true }),
    paymentMethod: text('payment_method'),
    // ── copy-as-inventory (Slice 1): status + condition live on the physical copy ──
    status: recordStatusEnum('status').notNull().default('verfuegbar'),
    conditionRecord: smallint('condition_record'),
    conditionCover: smallint('condition_cover'),
    discogsListingId: text('discogs_listing_id'),
    discogsListingStatus: discogsListingStatusEnum('discogs_listing_status')
      .notNull()
      .default('not_listed'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('purchases_tenant_status_idx').on(t.tenantId, t.status),
    recordIdx: index('purchases_record_idx').on(t.recordId),
    conditionRecordRange: check(
      'purchases_condition_record_range',
      sql`${t.conditionRecord} BETWEEN 0 AND 7`,
    ),
    conditionCoverRange: check(
      'purchases_condition_cover_range',
      sql`${t.conditionCover} BETWEEN 0 AND 7`,
    ),
  }),
);

export const permalinks = pgTable(
  'permalinks',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    slug: text('slug').notNull(),
    filter: jsonb('filter').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    slugTenantUnique: unique('permalinks_slug_tenant').on(t.slug, t.tenantId),
  }),
);

export const discogsConnections = pgTable(
  'discogs_connections',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    discogsUsername: text('discogs_username').notNull(),
    /** encryptSecret payload, AAD={tenantId} */
    oauthToken: text('oauth_token').notNull(),
    /** encryptSecret payload, AAD={tenantId} */
    oauthTokenSecret: text('oauth_token_secret').notNull(),
    connectedByUserId: integer('connected_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantUnique: unique('discogs_connections_tenant').on(t.tenantId),
  }),
);

// ── Slice 3 Enums ────────────────────────────────────────────────────────────

export const paymentMethodEnum = pgEnum('payment_method', [
  'bar',
  'karte',
  'paypal',
  'gutschein',
]);
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];

export const wishlistStatusEnum = pgEnum('wishlist_status', [
  'open',
  'notified',
  'closed',
]);
export type WishlistStatus = (typeof wishlistStatusEnum.enumValues)[number];

export const wishlistMatchStatusEnum = pgEnum('wishlist_match_status', [
  'pending',
  'notified',
  'dismissed',
]);
export type WishlistMatchStatus = (typeof wishlistMatchStatusEnum.enumValues)[number];

// ── Slice 3: POS / Sales + Wishlists (RLS applied in 0007_slice3_rls.sql) ────

export const quickItems = pgTable(
  'quick_items',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantActiveIdx: index('quick_items_tenant_active_idx').on(t.tenantId, t.active),
    priceNonneg: check('quick_items_price_nonneg', sql`${t.price} >= 0`),
  }),
);

export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    soldByUserId: integer('sold_by_user_id')
      .notNull()
      .references(() => users.id),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
    discount: numeric('discount', { precision: 10, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 10, scale: 2 }).notNull(),
    voucherCode: text('voucher_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('transactions_tenant_created_idx').on(t.tenantId, t.createdAt),
    discountNonneg: check('transactions_discount_nonneg', sql`${t.discount} >= 0`),
    discountLeSubtotal: check('transactions_discount_le_subtotal', sql`${t.discount} <= ${t.subtotal}`),
    totalConsistent: check('transactions_total_consistent', sql`${t.total} = ${t.subtotal} - ${t.discount}`),
    // HARDENED (Nemesis/Ipcha): §3.3 invariant pushed to the DB — voucherCode present IFF gutschein.
    voucherIffGutschein: check(
      'transactions_voucher_iff_gutschein',
      sql`(${t.paymentMethod} = 'gutschein') = (${t.voucherCode} IS NOT NULL)`,
    ),
  }),
);

export const transactionItems = pgTable(
  'transaction_items',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id),
    purchaseId: integer('purchase_id').references(() => purchases.id),
    quickItemId: integer('quick_item_id').references(() => quickItems.id),
    label: text('label').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
  },
  (t) => ({
    tenantTransactionIdx: index('transaction_items_tenant_transaction_idx').on(t.tenantId, t.transactionId),
    tenantPurchaseIdx: index('transaction_items_tenant_purchase_idx').on(t.tenantId, t.purchaseId),
    quantityPositive: check('transaction_items_quantity_positive', sql`${t.quantity} >= 1`),
    // HARDENED (Nemesis/Ipcha): the derived position-type invariant pushed to the DB (defence-in-depth).
    //   inventory: purchaseId set, quickItemId null, quantity 1 · quick: quickItemId set, purchaseId null · adhoc: both null
    kindExclusive: check(
      'transaction_items_kind_exclusive',
      sql`NOT (${t.purchaseId} IS NOT NULL AND ${t.quickItemId} IS NOT NULL)`,
    ),
    inventoryQtyOne: check(
      'transaction_items_inventory_qty_one',
      sql`${t.purchaseId} IS NULL OR ${t.quantity} = 1`,
    ),
  }),
);

export const wishlists = pgTable(
  'wishlists',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    createdByUserId: integer('created_by_user_id')
      .notNull()
      .references(() => users.id),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    artist: text('artist').notNull(),
    label: text('label'),
    title: text('title'),
    country: text('country'),
    status: wishlistStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wishlists_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export const wishlistMatches = pgTable(
  'wishlist_matches',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    wishlistId: integer('wishlist_id')
      .notNull()
      .references(() => wishlists.id),
    purchaseId: integer('purchase_id')
      .notNull()
      .references(() => purchases.id),
    recordId: integer('record_id')
      .notNull()
      .references(() => records.id),
    status: wishlistMatchStatusEnum('status').notNull().default('pending'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wishlist_matches_tenant_status_idx').on(t.tenantId, t.status),
    wishlistPurchaseUnique: unique('wishlist_matches_wishlist_purchase').on(t.wishlistId, t.purchaseId),
  }),
);
