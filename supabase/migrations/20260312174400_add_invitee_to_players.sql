-- Add invitee column to players table
ALTER TABLE "public"."players" ADD COLUMN "invitee" BOOLEAN NOT NULL DEFAULT FALSE;
