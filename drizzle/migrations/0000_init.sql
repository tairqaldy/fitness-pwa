CREATE TABLE `cron_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`cron` text NOT NULL,
	`job` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`ok` integer DEFAULT false NOT NULL,
	`error` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `cron_runs_job_started_idx` ON `cron_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cron_runs_job_slot_idx` ON `cron_runs` (`job`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `schema_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'ru' NOT NULL,
	`timezone` text DEFAULT 'Asia/Almaty' NOT NULL,
	`unit_system` text DEFAULT 'metric' NOT NULL,
	`theme` text DEFAULT 'dark' NOT NULL,
	`default_rest_seconds` integer DEFAULT 120 NOT NULL,
	`barbell_increment_g` integer DEFAULT 2500 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`sex` text,
	`birth_day` text,
	`height_cm` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
