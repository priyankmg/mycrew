-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'EMPLOYEE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SchemaEntity" AS ENUM ('EMPLOYEE', 'ATTENDANCE', 'LEAVE', 'SHIFT');

-- CreateEnum
CREATE TYPE "FieldDataType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'INTEGER', 'CURRENCY', 'BOOLEAN', 'DATE', 'DATETIME', 'TIME', 'SELECT', 'MULTI_SELECT', 'PHONE', 'EMAIL', 'URL', 'FILE');

-- CreateEnum
CREATE TYPE "FieldEditPolicy" AS ENUM ('SYSTEM_ONLY', 'OWNER_ONLY', 'EMPLOYEE_REQUEST', 'EMPLOYEE_DIRECT');

-- CreateEnum
CREATE TYPE "FieldVisibility" AS ENUM ('OWNER_ONLY', 'EMPLOYEE_VISIBLE');

-- CreateEnum
CREATE TYPE "FieldSource" AS ENUM ('SYSTEM_DEFAULT', 'ONBOARDING_SURVEY', 'ROSTER_IMPORT', 'LLM_INFERRED', 'MANUAL');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('HOURLY', 'SALARIED', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('OPEN', 'COMPLETE', 'FLAGGED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AttendanceFlag" AS ENUM ('LATE_IN', 'EARLY_OUT', 'MISSING_CLOCK_OUT', 'OVERTIME_RISK', 'OUTSIDE_SCHEDULE', 'MISSING_BREAK');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('FIELD_CHANGE', 'LEAVE_REQUEST', 'ATTENDANCE_CORRECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('CHAT', 'WEB', 'IMPORT', 'SYSTEM', 'API');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'WEB_SIMULATOR', 'SMS', 'VOICE');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "PendingActionStatus" AS ENUM ('AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('BUSINESS_BASICS', 'TEAM_SIZE', 'DATA_TO_TRACK', 'PAY_SETUP', 'SCHEDULE_SETUP', 'POLICY_SURVEY', 'ROSTER_IMPORT', 'COMPLETE');

-- CreateEnum
CREATE TYPE "PolicyKind" AS ENUM ('LEAVE', 'OVERTIME', 'MEAL_BREAK', 'ATTENDANCE', 'PAY_CYCLE', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "PolicySource" AS ENUM ('ONBOARDING_SURVEY', 'LLM_GENERATED', 'MANUAL', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('RECEIVED', 'PARSING', 'NEEDS_REVIEW', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "country_code" TEXT NOT NULL DEFAULT 'US',
    "region_code" TEXT,
    "industry" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "display_name" TEXT NOT NULL,
    "phone_e164" TEXT,
    "email" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "employee_id" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_definition" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "entity" "SchemaEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "data_type" "FieldDataType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "is_unique" BOOLEAN NOT NULL DEFAULT false,
    "edit_policy" "FieldEditPolicy" NOT NULL DEFAULT 'OWNER_ONLY',
    "visibility" "FieldVisibility" NOT NULL DEFAULT 'OWNER_ONLY',
    "options" JSONB,
    "validation" JSONB,
    "default_value" JSONB,
    "source" "FieldSource" NOT NULL DEFAULT 'MANUAL',
    "source_import_id" TEXT,
    "confidence" DOUBLE PRECISION,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone_e164" TEXT,
    "email" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'INVITED',
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'HOURLY',
    "job_title" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "external_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_entry" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "clock_in_at" TIMESTAMP(3),
    "clock_out_at" TIMESTAMP(3),
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'OPEN',
    "flags" "AttendanceFlag"[] DEFAULT ARRAY[]::"AttendanceFlag"[],
    "justification" TEXT,
    "source" "ChangeSource" NOT NULL DEFAULT 'CHAT',
    "locked_at" TIMESTAMP(3),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "recorded_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_request" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "hours" DOUBLE PRECISION,
    "reason" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "role" TEXT,
    "notes" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_request" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "employee_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT,
    "decision_by_user_id" TEXT,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "conversation_id" TEXT,
    "leave_request_id" TEXT,
    "attendance_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_change" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "entity" "SchemaEntity" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field_key" TEXT,
    "previous_value" JSONB,
    "new_value" JSONB,
    "changed_by_user_id" TEXT,
    "actor_role" "UserRole" NOT NULL,
    "source" "ChangeSource" NOT NULL,
    "justification" TEXT,
    "message_id" TEXT,
    "approval_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT,
    "channel" "ChannelType" NOT NULL,
    "channel_thread_id" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "role" "MessageRole" NOT NULL,
    "body" TEXT NOT NULL,
    "media_url" TEXT,
    "media_type" TEXT,
    "transcript" TEXT,
    "channel_message_id" TEXT,
    "tool_name" TEXT,
    "tool_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_action" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_session" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "current_step" "OnboardingStep" NOT NULL DEFAULT 'BUSINESS_BASICS',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "skipped" JSONB NOT NULL DEFAULT '[]',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "kind" "PolicyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" "PolicySource" NOT NULL DEFAULT 'MANUAL',
    "source_transcript" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_import" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_url" TEXT,
    "raw_text" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'RECEIVED',
    "inferred_fields" JSONB,
    "parsed_rows" JSONB,
    "issues" JSONB,
    "employees_created" INTEGER NOT NULL DEFAULT 0,
    "employees_updated" INTEGER NOT NULL DEFAULT 0,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roster_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT,
    "employee_id" TEXT,
    "channel" "ChannelType" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_employee_id_key" ON "user"("employee_id");

-- CreateIndex
CREATE INDEX "user_account_id_idx" ON "user"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_id_phone_e164_key" ON "user"("account_id", "phone_e164");

-- CreateIndex
CREATE INDEX "field_definition_account_id_entity_archived_at_idx" ON "field_definition"("account_id", "entity", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "field_definition_account_id_entity_key_key" ON "field_definition"("account_id", "entity", "key");

-- CreateIndex
CREATE INDEX "employee_account_id_status_idx" ON "employee"("account_id", "status");

-- CreateIndex
CREATE INDEX "employee_account_id_phone_e164_idx" ON "employee"("account_id", "phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "employee_account_id_external_ref_key" ON "employee"("account_id", "external_ref");

-- CreateIndex
CREATE INDEX "attendance_entry_account_id_work_date_idx" ON "attendance_entry"("account_id", "work_date");

-- CreateIndex
CREATE INDEX "attendance_entry_account_id_status_idx" ON "attendance_entry"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_entry_employee_id_work_date_key" ON "attendance_entry"("employee_id", "work_date");

-- CreateIndex
CREATE INDEX "leave_request_account_id_status_idx" ON "leave_request"("account_id", "status");

-- CreateIndex
CREATE INDEX "leave_request_employee_id_start_date_idx" ON "leave_request"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "shift_account_id_start_at_idx" ON "shift"("account_id", "start_at");

-- CreateIndex
CREATE INDEX "shift_employee_id_start_at_idx" ON "shift"("employee_id", "start_at");

-- CreateIndex
CREATE INDEX "approval_request_account_id_status_idx" ON "approval_request"("account_id", "status");

-- CreateIndex
CREATE INDEX "approval_request_employee_id_status_idx" ON "approval_request"("employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_account_id_seq_key" ON "approval_request"("account_id", "seq");

-- CreateIndex
CREATE INDEX "data_change_account_id_entity_entity_id_idx" ON "data_change"("account_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "data_change_account_id_created_at_idx" ON "data_change"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_account_id_last_message_at_idx" ON "conversation"("account_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_channel_channel_thread_id_key" ON "conversation"("channel", "channel_thread_id");

-- CreateIndex
CREATE INDEX "message_conversation_id_created_at_idx" ON "message"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_conversation_id_channel_message_id_key" ON "message"("conversation_id", "channel_message_id");

-- CreateIndex
CREATE INDEX "pending_action_conversation_id_status_idx" ON "pending_action"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "onboarding_session_account_id_idx" ON "onboarding_session"("account_id");

-- CreateIndex
CREATE INDEX "policy_account_id_kind_is_active_idx" ON "policy"("account_id", "kind", "is_active");

-- CreateIndex
CREATE INDEX "roster_import_account_id_status_idx" ON "roster_import"("account_id", "status");

-- CreateIndex
CREATE INDEX "notification_account_id_status_idx" ON "notification"("account_id", "status");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_source_import_id_fkey" FOREIGN KEY ("source_import_id") REFERENCES "roster_import"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decision_by_user_id_fkey" FOREIGN KEY ("decision_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_attendance_entry_id_fkey" FOREIGN KEY ("attendance_entry_id") REFERENCES "attendance_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_change" ADD CONSTRAINT "data_change_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_change" ADD CONSTRAINT "data_change_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_change" ADD CONSTRAINT "data_change_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_change" ADD CONSTRAINT "data_change_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_action" ADD CONSTRAINT "pending_action_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_session" ADD CONSTRAINT "onboarding_session_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy" ADD CONSTRAINT "policy_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_import" ADD CONSTRAINT "roster_import_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_import" ADD CONSTRAINT "roster_import_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
