CREATE TABLE "donation" (
	"donation_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid,
	"donor_name" varchar(80),
	"donor_phone" varchar(15),
	"donor_email" varchar(120),
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"amount_bdt" integer NOT NULL,
	"payment_method" varchar(12),
	"transaction_id" varchar(24) NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "donation_amount_ck" CHECK ("donation"."amount_bdt" > 0 and "donation"."amount_bdt" <= 10000000),
	CONSTRAINT "donation_status_ck" CHECK ("donation"."status" in ('pending','completed','failed','cancelled')),
	CONSTRAINT "donation_method_ck" CHECK ("donation"."payment_method" is null or "donation"."payment_method" in ('bkash','nagad','rocket','visa','mastercard'))
);
--> statement-breakpoint
ALTER TABLE "donation" ADD CONSTRAINT "donation_operation_id_operation_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "donation_transaction_uq" ON "donation" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "donation_status_idx" ON "donation" USING btree ("status","completed_at");