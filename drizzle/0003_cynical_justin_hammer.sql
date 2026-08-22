CREATE TABLE `country_click_events` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`country_code` text(2) NOT NULL,
	`visitor_id` text(36) NOT NULL,
	`clicked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_country_click_events_country_time` ON `country_click_events` (`country_code`,`clicked_at`);--> statement-breakpoint
CREATE INDEX `idx_country_click_events_visitor_time` ON `country_click_events` (`visitor_id`,`clicked_at`);--> statement-breakpoint
CREATE INDEX `idx_country_click_events_time_country` ON `country_click_events` (`clicked_at`,`country_code`);--> statement-breakpoint
CREATE TABLE `country_click_totals` (
	`country_code` text(2) PRIMARY KEY NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bid_orders_status_completed` ON `bid_orders` (`status`,`completed_at`);--> statement-breakpoint
PRAGMA optimize;
