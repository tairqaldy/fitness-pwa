CREATE TABLE `exercise_media` (
	`exercise_id` text NOT NULL,
	`idx` integer NOT NULL,
	`r2_key` text NOT NULL,
	`sha256` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	PRIMARY KEY(`exercise_id`, `idx`),
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "exercise_media_idx_range" CHECK("exercise_media"."idx" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_media_r2_key_uq` ON `exercise_media` (`r2_key`);--> statement-breakpoint
CREATE TABLE `exercise_muscles` (
	`exercise_id` text NOT NULL,
	`muscle` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`exercise_id`, `muscle`, `role`),
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "exercise_muscles_muscle_domain" CHECK("exercise_muscles"."muscle" IN ('abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings', 'lats', 'lower_back', 'middle_back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps')),
	CONSTRAINT "exercise_muscles_role_domain" CHECK("exercise_muscles"."role" IN ('primary', 'secondary'))
);
--> statement-breakpoint
CREATE INDEX `exercise_muscles_muscle_role_exercise_id_idx` ON `exercise_muscles` (`muscle`,`role`,`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`source_commit` text,
	`name` text NOT NULL,
	`name_ru` text,
	`slug` text NOT NULL,
	`force` text,
	`level` text NOT NULL,
	`mechanic` text,
	`equipment` text NOT NULL,
	`category` text NOT NULL,
	`load_mode` text DEFAULT 'external' NOT NULL,
	`instructions_json` text DEFAULT '[]' NOT NULL,
	`image_licence` text DEFAULT 'unknown-third-party' NOT NULL,
	`is_favourite` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "exercises_equipment_domain" CHECK("exercises"."equipment" IN ('barbell', 'dumbbell', 'ez_bar', 'cable', 'machine', 'kettlebell', 'resistance_band', 'medicine_ball', 'exercise_ball', 'foam_roller', 'bodyweight', 'other', 'unknown')),
	CONSTRAINT "exercises_category_domain" CHECK("exercises"."category" IN ('strength', 'stretching', 'plyometrics', 'powerlifting', 'olympic_weightlifting', 'strongman', 'cardio')),
	CONSTRAINT "exercises_level_domain" CHECK("exercises"."level" IN ('beginner', 'intermediate', 'expert')),
	CONSTRAINT "exercises_instructions_json_bytes" CHECK(length(CAST("exercises"."instructions_json" AS BLOB)) <= 65536)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_slug_uq` ON `exercises` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_source_source_id_uq` ON `exercises` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `exercises_equipment_idx` ON `exercises` (`equipment`);--> statement-breakpoint
CREATE INDEX `exercises_updated_at_id_idx` ON `exercises` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `personal_records` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`reps_at_value` integer,
	`set_id` text,
	`origin_key` text NOT NULL,
	`local_day` text NOT NULL,
	`achieved_at` integer NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`superseded_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "personal_records_local_day_fmt" CHECK("personal_records"."local_day" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_records_origin_key_kind_uq` ON `personal_records` (`origin_key`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `personal_records_exercise_id_kind_uq` ON `personal_records` (`exercise_id`,`kind`) WHERE is_current = 1;--> statement-breakpoint
CREATE INDEX `personal_records_achieved_at_idx` ON `personal_records` (`achieved_at`);--> statement-breakpoint
CREATE INDEX `personal_records_exercise_id_kind_achieved_at_idx` ON `personal_records` (`exercise_id`,`kind`,`achieved_at`);--> statement-breakpoint
CREATE INDEX `personal_records_updated_at_id_idx` ON `personal_records` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`workout_exercise_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`local_day` text NOT NULL,
	`position` integer NOT NULL,
	`set_type` text NOT NULL,
	`weight_kg` real,
	`assist_kg` real,
	`reps` integer,
	`rpe` real,
	`rir` real,
	`distance_m` real,
	`duration_sec` integer,
	`rest_after_sec` integer,
	`superset_round` integer,
	`e1rm_kg` real,
	`e1rm_source` text,
	`is_pr` integer DEFAULT false NOT NULL,
	`pr_kinds_json` text,
	`completed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workout_exercise_id`) REFERENCES `workout_exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sets_reps_sane" CHECK("sets"."reps" IS NULL OR ("sets"."reps" >= 0 AND "sets"."reps" <= 500)),
	CONSTRAINT "sets_weight_sane" CHECK("sets"."weight_kg" IS NULL OR ("sets"."weight_kg" BETWEEN 0 AND 1000)),
	CONSTRAINT "sets_e1rm_finite" CHECK("sets"."e1rm_kg" IS NULL OR ("sets"."e1rm_kg" > 0 AND "sets"."e1rm_kg" < 2000)),
	CONSTRAINT "sets_rpe_range" CHECK("sets"."rpe" IS NULL OR ("sets"."rpe" BETWEEN 1 AND 10)),
	CONSTRAINT "sets_e1rm_source_paired" CHECK(("sets"."e1rm_kg" IS NULL) = ("sets"."e1rm_source" IS NULL)),
	CONSTRAINT "sets_local_day_fmt" CHECK("sets"."local_day" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sets_workout_exercise_id_position_uq` ON `sets` (`workout_exercise_id`,`position`);--> statement-breakpoint
CREATE INDEX `sets_exercise_id_completed_at_idx` ON `sets` (`exercise_id`,`completed_at`,`weight_kg`,`reps`,`e1rm_kg`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `sets_local_day_exercise_id_idx` ON `sets` (`local_day`,`exercise_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `sets_workout_id_idx` ON `sets` (`workout_id`);--> statement-breakpoint
CREATE INDEX `sets_is_pr_idx` ON `sets` (`completed_at`) WHERE is_pr = 1 AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `sets_updated_at_id_idx` ON `sets` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `workout_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`superset_group` integer,
	`target_sets` integer,
	`target_reps_low` integer,
	`target_reps_high` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workout_exercises_workout_id_position_uq` ON `workout_exercises` (`workout_id`,`position`);--> statement-breakpoint
CREATE INDEX `workout_exercises_workout_id_idx` ON `workout_exercises` (`workout_id`);--> statement-breakpoint
CREATE INDEX `workout_exercises_exercise_id_idx` ON `workout_exercises` (`exercise_id`);--> statement-breakpoint
CREATE INDEX `workout_exercises_updated_at_id_idx` ON `workout_exercises` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`local_day` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_sec` integer,
	`title` text,
	`notes` text,
	`bodyweight_kg` real,
	`volume_kg` real,
	`hard_sets` integer,
	`gym_within_geofence` integer,
	`gym_distance_bucket` text,
	`import_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workouts_local_day_fmt" CHECK("workouts"."local_day" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `workouts_local_day_idx` ON `workouts` (`local_day`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `workouts_started_at_idx` ON `workouts` (`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workouts_import_key_uq` ON `workouts` (`import_key`);--> statement-breakpoint
CREATE INDEX `workouts_updated_at_id_idx` ON `workouts` (`updated_at`,`id`);