create extension if not exists "moddatetime" with schema "public" version '1.0';

alter table "public"."payments" add column "registered_by" text not null;

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');


