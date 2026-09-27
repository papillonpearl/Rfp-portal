CREATE TYPE "public"."rfp_status" AS ENUM('draft', 'open', 'closed', 'awarded');--> statement-breakpoint
CREATE TYPE "public"."rfp_type" AS ENUM('RFP', 'RFQ');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('internal', 'shared');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"visibility" "visibility" DEFAULT 'internal' NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"site" text,
	"equipment" text NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit" text NOT NULL,
	"visibility" "visibility" DEFAULT 'internal' NOT NULL,
	"internal_estimate" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"type" "rfp_type" DEFAULT 'RFP' NOT NULL,
	"status" "rfp_status" DEFAULT 'draft' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"sealed" boolean DEFAULT true NOT NULL,
	"current_round" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_rfp_idx" ON "attachments" USING btree ("rfp_id");--> statement-breakpoint
CREATE INDEX "line_items_rfp_idx" ON "line_items" USING btree ("rfp_id","position");