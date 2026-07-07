CREATE TABLE "record_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "record_embeddings_tenant_record" UNIQUE("tenant_id","record_id")
);
--> statement-breakpoint
ALTER TABLE "record_embeddings" ADD CONSTRAINT "record_embeddings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_embeddings" ADD CONSTRAINT "record_embeddings_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "record_embeddings_embedding_hnsw" ON "record_embeddings" USING hnsw ("embedding" vector_cosine_ops);