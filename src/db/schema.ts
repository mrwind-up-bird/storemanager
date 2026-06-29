import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
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
    recordStatus: recordStatusEnum('record_status')
      .notNull()
      .default('verfuegbar'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    hashTenantUnique: unique('records_hash_tenant').on(t.hash, t.tenantId),
  }),
);

export const purchases = pgTable('purchases', {
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

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
