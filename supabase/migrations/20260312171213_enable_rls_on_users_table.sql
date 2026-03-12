-- Enable Row Level Security
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;

-- Revoke anon access, grant service_role full access
REVOKE ALL ON TABLE "public"."users" FROM "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";
