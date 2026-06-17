CREATE TABLE "session_dashboards" (
	"session_id" text PRIMARY KEY NOT NULL,
	"spec" jsonb NOT NULL,
	"updated_by_chat_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_dashboards" ADD CONSTRAINT "session_dashboards_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;