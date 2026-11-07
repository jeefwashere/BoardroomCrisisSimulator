CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`created` integer NOT NULL,
	`started` integer,
	`finished` integer,
	`lease` text
);
--> statement-breakpoint
CREATE INDEX `jobs_owner` ON `jobs` (`owner`,`created`);--> statement-breakpoint
CREATE INDEX `jobs_queue` ON `jobs` (`status`,`created`);--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`seen` integer NOT NULL
);
