CREATE SEQUENCE "public"."change_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "app_user" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid,
	"full_name" varchar(80) NOT NULL,
	"mobile_number" varchar(15) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(25) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"rejection_reason" varchar(200),
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_role_ck" CHECK ("app_user"."role" in ('FIELD_VOLUNTEER','GROUP_COORDINATOR','OPERATION_ADMINISTRATOR','SYSTEM_ADMINISTRATOR','OBSERVER')),
	CONSTRAINT "app_user_status_ck" CHECK ("app_user"."status" in ('pending','active','locked','deactivated','rejected')),
	CONSTRAINT "app_user_org_role_ck" CHECK (("app_user"."role" in ('FIELD_VOLUNTEER','GROUP_COORDINATOR')) = ("app_user"."organisation_id" is not null) or "app_user"."role" = 'OBSERVER')
);
--> statement-breakpoint
CREATE TABLE "area" (
	"area_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"upazila" varchar(50) NOT NULL,
	"union_name" varchar(50) NOT NULL,
	"ward" varchar(20) NOT NULL,
	"upazila_bn" varchar(100),
	"union_bn" varchar(100),
	"union_key" varchar(110) NOT NULL,
	"ward_key" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"audit_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid,
	"organisation_id" uuid,
	"device_id" uuid,
	"operation_id" uuid,
	"action" varchar(60) NOT NULL,
	"entity_type" varchar(30),
	"entity_id" uuid,
	"changed_fields" text[],
	"value_hashes" jsonb,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(10) NOT NULL,
	"status" varchar(10) NOT NULL,
	"file" varchar(300),
	"size_bytes" bigint,
	"detail" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conflict" (
	"conflict_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"field_name" varchar(40) NOT NULL,
	"local_value" text,
	"server_value" text,
	"local_user_id" uuid NOT NULL,
	"local_device_id" uuid NOT NULL,
	"local_organisation_id" uuid,
	"local_time" timestamp with time zone NOT NULL,
	"server_user_id" uuid,
	"server_device_id" uuid,
	"server_organisation_id" uuid,
	"server_time" timestamp with time zone,
	"resolved_value" text,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflict_status_ck" CHECK ("conflict"."status" in ('open','resolved'))
);
--> statement-breakpoint
CREATE TABLE "device" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_label" varchar(40) NOT NULL,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"short_code_prefix" varchar(3) NOT NULL,
	"recovery_key_enc" text NOT NULL,
	"last_clock_offset_ms" integer,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "device_status_ck" CHECK ("device"."status" in ('active','revoked'))
);
--> statement-breakpoint
CREATE TABLE "disaster_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_en" varchar(40) NOT NULL,
	"name_bn" varchar(60) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distribution" (
	"distribution_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"household_id" uuid,
	"is_anonymous" boolean NOT NULL,
	"recorded_by" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"distributed_at" timestamp with time zone NOT NULL,
	"client_time" timestamp with time zone NOT NULL,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(10) DEFAULT 'recorded' NOT NULL,
	"cancel_reason" varchar(100),
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"received_elsewhere_today" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"server_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	CONSTRAINT "distribution_status_ck" CHECK ("distribution"."status" in ('recorded','voided')),
	CONSTRAINT "distribution_anon_ck" CHECK ("distribution"."is_anonymous" = ("distribution"."household_id" is null))
);
--> statement-breakpoint
CREATE TABLE "distribution_flag" (
	"flag_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"first_distribution_id" uuid NOT NULL,
	"second_distribution_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"note" varchar(300),
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distribution_flag_status_ck" CHECK ("distribution_flag"."status" in ('pending','justified','repeat'))
);
--> statement-breakpoint
CREATE TABLE "distribution_item" (
	"distribution_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "distribution_item_distribution_id_item_id_pk" PRIMARY KEY("distribution_id","item_id"),
	CONSTRAINT "distribution_item_qty_ck" CHECK ("distribution_item"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "duplicate_pair" (
	"pair_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"household_a_id" uuid NOT NULL,
	"household_b_id" uuid NOT NULL,
	"score" numeric(4, 3) NOT NULL,
	"label" varchar(10) NOT NULL,
	"signals" jsonb NOT NULL,
	"status" varchar(15) DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_pair_order_ck" CHECK ("duplicate_pair"."household_a_id" < "duplicate_pair"."household_b_id"),
	CONSTRAINT "duplicate_pair_status_ck" CHECK ("duplicate_pair"."status" in ('pending_review','linked','not_duplicate')),
	CONSTRAINT "duplicate_pair_label_ck" CHECK ("duplicate_pair"."label" in ('likely','possible'))
);
--> statement-breakpoint
CREATE TABLE "household" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"short_code" varchar(10) NOT NULL,
	"registered_by" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"head_name" varchar(80),
	"name_norm" varchar(80),
	"mobile_number" varchar(15),
	"mobile_hmac" varchar(64),
	"mobile_masked" varchar(15),
	"member_count" integer NOT NULL,
	"consent_given" boolean NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"gps_lat" numeric(8, 5),
	"gps_lng" numeric(8, 5),
	"version" integer DEFAULT 1 NOT NULL,
	"field_stamps" jsonb NOT NULL,
	"link_group_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "household_consent_ck" CHECK ("household"."consent_given" = true),
	CONSTRAINT "household_members_ck" CHECK ("household"."member_count" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"operation_id" uuid NOT NULL,
	"organisation_name" varchar(100),
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(10) DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"notification_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"params" jsonb NOT NULL,
	"link" varchar(200),
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"disaster_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_status_ck" CHECK ("operation"."status" in ('active','closed'))
);
--> statement-breakpoint
CREATE TABLE "operation_admin" (
	"operation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_admin_operation_id_user_id_pk" PRIMARY KEY("operation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "operation_key" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_key" text,
	"destroyed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_membership" (
	"operation_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" varchar(200),
	CONSTRAINT "operation_membership_operation_id_organisation_id_pk" PRIMARY KEY("operation_id","organisation_id"),
	CONSTRAINT "membership_status_ck" CHECK ("operation_membership"."status" in ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "operation_observer" (
	"operation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_observer_operation_id_user_id_pk" PRIMARY KEY("operation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organisation" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"name_key" varchar(100) NOT NULL,
	"name_bn" varchar(100),
	"org_type" varchar(30) NOT NULL,
	"contact_name" varchar(80) NOT NULL,
	"contact_phone" varchar(15) NOT NULL,
	"contact_email" varchar(120),
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"rejection_reason" varchar(200),
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_status_ck" CHECK ("organisation"."status" in ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"token_hash" varchar(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relief_item" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"item_name" varchar(50) NOT NULL,
	"name_key" varchar(50) NOT NULL,
	"item_name_bn" varchar(100),
	"unit" varchar(15) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_event" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organisation_id" uuid,
	"operation_id" uuid,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(10) NOT NULL,
	"device_seq" integer NOT NULL,
	"base_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"pii_enc" text,
	"client_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_offset_ms" integer NOT NULL,
	"status" varchar(10) NOT NULL,
	"reject_reason" varchar(60),
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "sync_event_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "sync_event_status_ck" CHECK ("sync_event"."status" in ('applied','conflict','deferred','rejected'))
);
--> statement-breakpoint
CREATE TABLE "unserved_release" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"released_by" uuid NOT NULL,
	"household_ids" uuid[] NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_seq" bigint DEFAULT nextval('change_seq') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_organisation_id_organisation_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area" ADD CONSTRAINT "area_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict" ADD CONSTRAINT "conflict_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict" ADD CONSTRAINT "conflict_household_id_household_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict" ADD CONSTRAINT "conflict_event_id_sync_event_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."sync_event"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_app_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution" ADD CONSTRAINT "distribution_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution" ADD CONSTRAINT "distribution_area_id_area_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("area_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution" ADD CONSTRAINT "distribution_household_id_household_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution" ADD CONSTRAINT "distribution_recorded_by_app_user_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution" ADD CONSTRAINT "distribution_organisation_id_organisation_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_flag" ADD CONSTRAINT "distribution_flag_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_flag" ADD CONSTRAINT "distribution_flag_first_distribution_id_distribution_distribution_id_fk" FOREIGN KEY ("first_distribution_id") REFERENCES "public"."distribution"("distribution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_flag" ADD CONSTRAINT "distribution_flag_second_distribution_id_distribution_distribution_id_fk" FOREIGN KEY ("second_distribution_id") REFERENCES "public"."distribution"("distribution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_flag" ADD CONSTRAINT "distribution_flag_item_id_relief_item_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."relief_item"("item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_item" ADD CONSTRAINT "distribution_item_distribution_id_distribution_distribution_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."distribution"("distribution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_item" ADD CONSTRAINT "distribution_item_item_id_relief_item_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."relief_item"("item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_pair" ADD CONSTRAINT "duplicate_pair_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_pair" ADD CONSTRAINT "duplicate_pair_household_a_id_household_household_id_fk" FOREIGN KEY ("household_a_id") REFERENCES "public"."household"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_pair" ADD CONSTRAINT "duplicate_pair_household_b_id_household_household_id_fk" FOREIGN KEY ("household_b_id") REFERENCES "public"."household"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_area_id_area_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("area_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_registered_by_app_user_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_organisation_id_organisation_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation" ADD CONSTRAINT "operation_disaster_type_id_disaster_type_id_fk" FOREIGN KEY ("disaster_type_id") REFERENCES "public"."disaster_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation" ADD CONSTRAINT "operation_created_by_app_user_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_admin" ADD CONSTRAINT "operation_admin_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_admin" ADD CONSTRAINT "operation_admin_user_id_app_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_key" ADD CONSTRAINT "operation_key_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_membership" ADD CONSTRAINT "operation_membership_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_membership" ADD CONSTRAINT "operation_membership_organisation_id_organisation_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_observer" ADD CONSTRAINT "operation_observer_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_observer" ADD CONSTRAINT "operation_observer_user_id_app_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_app_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_device_id_device_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relief_item" ADD CONSTRAINT "relief_item_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_event" ADD CONSTRAINT "sync_event_device_id_device_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unserved_release" ADD CONSTRAINT "unserved_release_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unserved_release" ADD CONSTRAINT "unserved_release_area_id_area_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("area_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unserved_release" ADD CONSTRAINT "unserved_release_organisation_id_organisation_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unserved_release" ADD CONSTRAINT "unserved_release_released_by_app_user_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_mobile_uq" ON "app_user" USING btree ("mobile_number");--> statement-breakpoint
CREATE INDEX "app_user_org_idx" ON "app_user" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "area_unique_ward_uq" ON "area" USING btree ("operation_id","union_key","ward_key");--> statement-breakpoint
CREATE INDEX "area_operation_idx" ON "area" USING btree ("operation_id","union_key");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_op_idx" ON "audit_log" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE INDEX "conflict_op_status_idx" ON "conflict" USING btree ("operation_id","status");--> statement-breakpoint
CREATE INDEX "conflict_household_idx" ON "conflict" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_prefix_uq" ON "device" USING btree ("short_code_prefix");--> statement-breakpoint
CREATE INDEX "device_user_idx" ON "device" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disaster_type_name_uq" ON "disaster_type" USING btree (lower("name_en"));--> statement-breakpoint
CREATE INDEX "distribution_area_seq_idx" ON "distribution" USING btree ("area_id","server_seq");--> statement-breakpoint
CREATE INDEX "distribution_household_idx" ON "distribution" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "distribution_op_time_idx" ON "distribution" USING btree ("operation_id","distributed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "distribution_flag_uq" ON "distribution_flag" USING btree ("first_distribution_id","second_distribution_id","item_id");--> statement-breakpoint
CREATE INDEX "distribution_flag_op_idx" ON "distribution_flag" USING btree ("operation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_pair_uq" ON "duplicate_pair" USING btree ("household_a_id","household_b_id");--> statement-breakpoint
CREATE INDEX "duplicate_pair_op_idx" ON "duplicate_pair" USING btree ("operation_id","status","score");--> statement-breakpoint
CREATE UNIQUE INDEX "household_short_code_uq" ON "household" USING btree ("short_code");--> statement-breakpoint
CREATE INDEX "household_area_seq_idx" ON "household" USING btree ("area_id","server_seq");--> statement-breakpoint
CREATE INDEX "household_op_hmac_idx" ON "household" USING btree ("operation_id","mobile_hmac");--> statement-breakpoint
CREATE INDEX "household_link_idx" ON "household" USING btree ("link_group_id");--> statement-breakpoint
CREATE INDEX "household_name_trgm_idx" ON "household" USING gin ("name_norm" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "invite_token_uq" ON "invite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "job_queue_idx" ON "job" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","is_read","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_name_key_uq" ON "organisation" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_token_hash_uq" ON "refresh_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_token_family_idx" ON "refresh_token" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relief_item_name_uq" ON "relief_item" USING btree ("operation_id","name_key");--> statement-breakpoint
CREATE INDEX "sync_event_entity_idx" ON "sync_event" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "sync_event_device_idx" ON "sync_event" USING btree ("device_id","device_seq");--> statement-breakpoint
CREATE INDEX "unserved_release_org_idx" ON "unserved_release" USING btree ("organisation_id","server_seq");