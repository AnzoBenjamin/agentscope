CREATE TABLE "processed_webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(32) NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "processed_webhook_event_source_event_unique" ON "processed_webhook_event" USING btree ("source","event_id");--> statement-breakpoint
CREATE INDEX "processed_webhook_event_processed_at_idx" ON "processed_webhook_event" USING btree ("processed_at");
