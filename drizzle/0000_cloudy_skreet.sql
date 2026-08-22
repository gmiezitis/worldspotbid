CREATE TABLE `bid_orders` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`stripe_session_id` text(255),
	`stripe_payment_intent_id` text(255),
	`country_code` text(2) NOT NULL,
	`country_name` text(100) NOT NULL,
	`user_id` text(160) NOT NULL,
	`bidder_email` text(320) NOT NULL,
	`amount_cents` integer NOT NULL,
	`expected_version` integer NOT NULL,
	`company_name` text(60) NOT NULL,
	`company_url` text(500) NOT NULL,
	`logo_key` text(160) NOT NULL,
	`status` text(32) NOT NULL,
	`failure_reason` text(160),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bid_orders_stripe_session` ON `bid_orders` (`stripe_session_id`);--> statement-breakpoint
CREATE INDEX `idx_bid_orders_country_created` ON `bid_orders` (`country_code`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_bid_orders_user_created` ON `bid_orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_bid_orders_status` ON `bid_orders` (`status`);--> statement-breakpoint
CREATE TABLE `countries` (
	`code` text(2) PRIMARY KEY NOT NULL,
	`name` text(100) NOT NULL,
	`current_bid_cents` integer DEFAULT 0 NOT NULL,
	`company_name` text(60),
	`company_url` text(500),
	`logo_key` text(160),
	`owner_user_id` text(160),
	`active_since` integer,
	`minimum_guaranteed_until` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`pending_bid_id` text(36),
	`pending_bid_cents` integer,
	`pending_bid_expires_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_countries_current_bid` ON `countries` (`current_bid_cents`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text(255) PRIMARY KEY NOT NULL,
	`event_type` text(80) NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
