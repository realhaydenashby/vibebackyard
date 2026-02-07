CREATE TABLE `file_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_path` text NOT NULL,
	`user_id` text NOT NULL,
	`edit_type` text NOT NULL,
	`content_before` text,
	`content_after` text,
	`commit_hash` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_edits_project_id_idx` ON `file_edits` (`project_id`);--> statement-breakpoint
CREATE INDEX `file_edits_user_id_idx` ON `file_edits` (`user_id`);--> statement-breakpoint
CREATE INDEX `file_edits_file_path_idx` ON `file_edits` (`file_path`);--> statement-breakpoint
CREATE INDEX `file_edits_edit_type_idx` ON `file_edits` (`edit_type`);--> statement-breakpoint
CREATE INDEX `file_edits_created_at_idx` ON `file_edits` (`created_at`);--> statement-breakpoint
CREATE TABLE `project_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`open_files` text DEFAULT '[]',
	`active_file` text,
	`cursor_position` text,
	`scroll_position` integer,
	`unsaved_changes` integer DEFAULT false,
	`last_saved_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_sessions_project_id_idx` ON `project_sessions` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`app_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`thumbnail_url` text,
	`last_opened_at` integer NOT NULL,
	`current_branch` text DEFAULT 'main',
	`editor_config` text DEFAULT '{}',
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_user_id_idx` ON `projects` (`user_id`);--> statement-breakpoint
CREATE INDEX `projects_app_id_idx` ON `projects` (`app_id`);--> statement-breakpoint
CREATE INDEX `projects_last_opened_at_idx` ON `projects` (`last_opened_at`);