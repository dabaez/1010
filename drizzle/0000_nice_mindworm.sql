CREATE TABLE `guestbook` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`seal` text NOT NULL,
	`n_hex` text NOT NULL,
	`t` text NOT NULL,
	`iv_b64` text NOT NULL,
	`ciphertext_b64` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rite_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tower_moves` (
	`year` integer PRIMARY KEY NOT NULL,
	`state_before` text NOT NULL,
	`move` text NOT NULL,
	`state_after` text NOT NULL,
	`tally_json` text NOT NULL,
	`decided_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `voters_guestbook` (
	`year` integer NOT NULL,
	`voter_hash` text NOT NULL,
	PRIMARY KEY(`year`, `voter_hash`)
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`year` integer NOT NULL,
	`voter_hash` text NOT NULL,
	`move` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`year`, `voter_hash`)
);
--> statement-breakpoint
CREATE TABLE `years` (
	`year` integer PRIMARY KEY NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`number_round` integer NOT NULL,
	`number_u64` text,
	`bit` integer,
	`number_randomness` text,
	`beacon_source` text,
	`number_proof` text,
	`tiebreak_round` integer NOT NULL,
	`tiebreak_randomness` text,
	`tiebreak_source` text,
	`tiebreak_proof` text,
	`seal_table` text NOT NULL
);
