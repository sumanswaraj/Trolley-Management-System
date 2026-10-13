CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` integer NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`detail` text NOT NULL,
	`ts` integer NOT NULL,
	FOREIGN KEY (`actor`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trolley_categories` (
	`trolley_type` text NOT NULL,
	`category` text NOT NULL,
	PRIMARY KEY(`trolley_type`, `category`)
);
--> statement-breakpoint
CREATE TABLE `demo_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `command_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`ok` integer NOT NULL,
	CONSTRAINT "command_is_current" CHECK("command_guards"."ok" = 1)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`external` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trolley` text NOT NULL,
	`source` text NOT NULL,
	`destination` text NOT NULL,
	`product` text,
	`batch` text NOT NULL,
	`qty` real NOT NULL,
	`state` text NOT NULL,
	`requested_by` integer NOT NULL,
	`approved_by` integer,
	`received_by` integer,
	`created` integer NOT NULL,
	`expected` integer NOT NULL,
	`received` integer,
	`key` text NOT NULL,
	`payload` text NOT NULL,
	`version` integer NOT NULL,
	`policy_flags` text DEFAULT '[]' NOT NULL,
	`exception_reason` text DEFAULT '' NOT NULL,
	`requires_quality` integer DEFAULT 0 NOT NULL,
	`decision_reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`trolley`) REFERENCES `trolleys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movements_key_unique` ON `movements` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_open_movement` ON `movements` (`trolley`) WHERE "movements"."state" IN ('Pending','In Transit');--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `allowed_routes` (
	`source` text NOT NULL,
	`destination` text NOT NULL,
	`category` text NOT NULL,
	`requires_quality` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`source`, `destination`, `category`),
	FOREIGN KEY (`source`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_locations` (
	`user_id` integer NOT NULL,
	`location` text NOT NULL,
	`can_depart` integer DEFAULT 0 NOT NULL,
	`can_receive` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `location`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plant_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enforce_routes` integer DEFAULT 0 NOT NULL,
	`enforce_categories` integer DEFAULT 0 NOT NULL,
	`scope_operations` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trolleys` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`capacity` real NOT NULL,
	`location` text NOT NULL,
	`status` text NOT NULL,
	`product` text,
	`batch` text DEFAULT '' NOT NULL,
	`qty` real DEFAULT 0 NOT NULL,
	`unit` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`location`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);

--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER movement_no_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT, 'Movement history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER movement_request_immutable BEFORE UPDATE OF trolley,source,destination,product,batch,qty,requested_by,created,expected,key,payload,version,policy_flags,exception_reason,requires_quality ON movements BEGIN SELECT RAISE(ABORT, 'Movement request is immutable'); END;
