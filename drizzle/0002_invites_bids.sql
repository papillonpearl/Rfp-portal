CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"rfp_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"unit_price" numeric(14, 2),
	"lead_time_days" integer,
	"notes" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_link" uuid
);
--> statement-breakpoint
CREATE TABLE "invite_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"email_status" text DEFAULT 'sent' NOT NULL,
	CONSTRAINT "invite_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"sent_by" text
);
--> statement-breakpoint
CREATE TABLE "round_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by_link" uuid
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_updated_by_link_invite_links_id_fk" FOREIGN KEY ("updated_by_link") REFERENCES "public"."invite_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_contact_id_supplier_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."supplier_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_submissions" ADD CONSTRAINT "round_submissions_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_submissions" ADD CONSTRAINT "round_submissions_submitted_by_link_invite_links_id_fk" FOREIGN KEY ("submitted_by_link") REFERENCES "public"."invite_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_rfp_idx" ON "activity_log" USING btree ("rfp_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_invite_line_round_key" ON "bids" USING btree ("invite_id","line_item_id","round");--> statement-breakpoint
CREATE INDEX "invite_links_invite_idx" ON "invite_links" USING btree ("invite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_rfp_supplier_key" ON "invites" USING btree ("rfp_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_submissions_invite_round_key" ON "round_submissions" USING btree ("invite_id","round");