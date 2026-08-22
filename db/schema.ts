import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const countries = sqliteTable('countries', {
  code: text('code', { length: 2 }).primaryKey(),
  name: text('name', { length: 100 }).notNull(),
  currentBidCents: integer('current_bid_cents').notNull().default(0),
  companyName: text('company_name', { length: 60 }),
  companyUrl: text('company_url', { length: 500 }),
  businessDescription: text('business_description', { length: 180 }),
  projectCategory: text('project_category', { length: 60 }),
  logoKey: text('logo_key', { length: 160 }),
  ownerUserId: text('owner_user_id', { length: 160 }),
  activeSince: integer('active_since', { mode: 'timestamp_ms' }),
  minimumGuaranteedUntil: integer('minimum_guaranteed_until', { mode: 'timestamp_ms' }),
  version: integer('version').notNull().default(0),
  pendingBidId: text('pending_bid_id', { length: 36 }),
  pendingBidCents: integer('pending_bid_cents'),
  pendingBidExpiresAt: integer('pending_bid_expires_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [index('idx_countries_current_bid').on(table.currentBidCents)]);

export const bidOrders = sqliteTable('bid_orders', {
  id: text('id', { length: 36 }).primaryKey(),
  stripeSessionId: text('stripe_session_id', { length: 255 }),
  stripePaymentIntentId: text('stripe_payment_intent_id', { length: 255 }),
  countryCode: text('country_code', { length: 2 }).notNull(),
  countryName: text('country_name', { length: 100 }).notNull(),
  userId: text('user_id', { length: 160 }).notNull(),
  bidderEmail: text('bidder_email', { length: 320 }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  expectedVersion: integer('expected_version').notNull(),
  companyName: text('company_name', { length: 60 }).notNull(),
  companyUrl: text('company_url', { length: 500 }).notNull(),
  businessDescription: text('business_description', { length: 180 }),
  projectCategory: text('project_category', { length: 60 }),
  logoKey: text('logo_key', { length: 160 }).notNull(),
  status: text('status', { length: 32 }).notNull(),
  failureReason: text('failure_reason', { length: 160 }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
}, (table) => [
  uniqueIndex('idx_bid_orders_stripe_session').on(table.stripeSessionId),
  index('idx_bid_orders_country_created').on(table.countryCode, table.createdAt),
  index('idx_bid_orders_user_created').on(table.userId, table.createdAt),
  index('idx_bid_orders_status').on(table.status),
  index('idx_bid_orders_status_completed').on(table.status, table.completedAt),
]);

export const webhookEvents = sqliteTable('webhook_events', {
  id: text('id', { length: 255 }).primaryKey(),
  eventType: text('event_type', { length: 80 }).notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp_ms' }).notNull(),
});

export const logoUploads = sqliteTable('logo_uploads', {
  key: text('key', { length: 160 }).primaryKey(),
  userId: text('user_id', { length: 160 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  contentType: text('content_type', { length: 40 }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [index('idx_logo_uploads_user_created').on(table.userId, table.createdAt)]);

export const countryClickEvents = sqliteTable('country_click_events', {
  id: text('id', { length: 36 }).primaryKey(),
  countryCode: text('country_code', { length: 2 }).notNull(),
  visitorId: text('visitor_id', { length: 36 }).notNull(),
  clickedAt: integer('clicked_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('idx_country_click_events_country_time').on(table.countryCode, table.clickedAt),
  index('idx_country_click_events_visitor_time').on(table.visitorId, table.clickedAt),
  index('idx_country_click_events_time_country').on(table.clickedAt, table.countryCode),
]);

export const countryClickTotals = sqliteTable('country_click_totals', {
  countryCode: text('country_code', { length: 2 }).primaryKey(),
  clickCount: integer('click_count').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
