CREATE TABLE "agent_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"leader_session_id" text NOT NULL,
	"architecture" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"orchestration_run_id" text,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"from_session_id" text,
	"to_session_id" text,
	"sender_role" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'unread' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "group_role" text;--> statement-breakpoint
ALTER TABLE "agent_groups" ADD CONSTRAINT "agent_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_groups" ADD CONSTRAINT "agent_groups_leader_session_id_sessions_id_fk" FOREIGN KEY ("leader_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_group_id_agent_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."agent_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_groups_user_id_idx" ON "agent_groups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_groups_leader_session_id_idx" ON "agent_groups" USING btree ("leader_session_id");--> statement-breakpoint
CREATE INDEX "agent_messages_inbox_idx" ON "agent_messages" USING btree ("to_session_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_messages_group_round_idx" ON "agent_messages" USING btree ("group_id","round","created_at");--> statement-breakpoint
CREATE INDEX "sessions_group_id_idx" ON "sessions" USING btree ("group_id");