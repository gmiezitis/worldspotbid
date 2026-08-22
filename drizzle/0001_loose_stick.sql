CREATE TABLE `logo_uploads` (
	`key` text(160) PRIMARY KEY NOT NULL,
	`user_id` text(160) NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_type` text(40) NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_logo_uploads_user_created` ON `logo_uploads` (`user_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;
