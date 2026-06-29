ALTER TABLE "purchases" ADD COLUMN "status" "record_status" DEFAULT 'verfuegbar' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "condition_record" smallint;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "condition_cover" smallint;--> statement-breakpoint
CREATE INDEX "purchases_tenant_status_idx" ON "purchases" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "purchases_record_idx" ON "purchases" USING btree ("record_id");--> statement-breakpoint
ALTER TABLE "records" DROP COLUMN "record_status";--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_condition_record_range" CHECK ("purchases"."condition_record" BETWEEN 0 AND 7);--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_condition_cover_range" CHECK ("purchases"."condition_cover" BETWEEN 0 AND 7);