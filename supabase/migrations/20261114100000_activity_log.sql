-- What the people running the club did, line by line: what they tapped and
-- typed in the dashboard (UI), what the service received and answered (API),
-- and what changed in the tables that hold money and attendance (DB).
--
-- It answers "I registered it" against "it is not there": the UI lines say
-- whether the action was taken, the API lines whether it reached the service
-- and what came back, the DB lines whether it was stored, and whether
-- somebody changed or deleted it afterwards, by hand included.
--
-- Append only: nothing updates or deletes a line.

CREATE TABLE activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- When it happened, on the server's clock. For a UI line it is the arrival
  -- minus the delay the phone measured on its own clock, so a phone set to
  -- the wrong time still lands where it belongs.
  at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('UI', 'API', 'DB')),
  -- users.id of whoever was logged in. NULL with `actor` saying who it was
  -- otherwise: 'manual' (an edit made directly in Supabase), 'servicio' (the
  -- Telegram bot or an edge function), 'sin sesión'.
  actor_id uuid,
  actor text,
  -- The dashboard path the action was taken on.
  screen text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  -- Ties a submit to the request it sent and to the rows that request wrote.
  trace text,
  -- UI only: the browser tab, its running count (a gap is a lost line), how
  -- many sends it took, whether the page that took the action had already
  -- closed when it went out, and how long it waited on the phone.
  tab text,
  seq integer,
  attempts integer,
  after_close boolean,
  delay_ms integer,
  -- API only: the status the service answered with.
  status integer
);

CREATE INDEX activity_log_at ON activity_log (at DESC);
CREATE INDEX activity_log_trace ON activity_log (trace) WHERE trace IS NOT NULL;

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON activity_log FROM anon, authenticated;

CREATE FUNCTION activity_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append only';
END;
$$;

CREATE TRIGGER activity_log_append_only
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_append_only();

CREATE TRIGGER activity_log_no_truncate
  BEFORE TRUNCATE ON activity_log
  FOR EACH STATEMENT EXECUTE FUNCTION activity_log_append_only();

-- One DB line per row written. The dashboard's requests carry who made them
-- and the trace of the submit in headers, which PostgREST exposes; a write
-- with no such headers came from elsewhere.
CREATE FUNCTION log_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  headers jsonb;
  actor_id uuid;
  actor text;
  trace text;
  detail jsonb;
  old_row jsonb;
  new_row jsonb;
  changed_old jsonb := '{}';
  changed_new jsonb := '{}';
  k text;
BEGIN
  BEGIN
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    headers := NULL;
  END;
  trace := headers->>'x-activity-trace';
  BEGIN
    actor_id := (headers->>'x-activity-actor')::uuid;
  EXCEPTION WHEN others THEN
    actor_id := NULL;
  END;
  IF actor_id IS NULL THEN
    -- session_user, not current_user: inside SECURITY DEFINER current_user is
    -- the owner. Everything through the API (the dashboard, the bot, the edge
    -- functions) logs in as authenticator; anything else is a direct
    -- connection: the Supabase table editor, its SQL editor, a migration.
    actor := CASE WHEN session_user = 'authenticator' THEN 'servicio' ELSE 'manual' END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    detail := jsonb_build_object('row', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    detail := jsonb_build_object('row', to_jsonb(OLD));
  ELSE
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(new_row) LOOP
      IF k <> 'updated_at' AND (old_row->k) IS DISTINCT FROM (new_row->k) THEN
        changed_old := changed_old || jsonb_build_object(k, old_row->k);
        changed_new := changed_new || jsonb_build_object(k, new_row->k);
      END IF;
    END LOOP;
    -- Only the timestamp moved: nothing to tell.
    IF changed_new = '{}' THEN
      RETURN NULL;
    END IF;
    detail := jsonb_build_object(
      'id', new_row->'id',
      'player_id', coalesce(new_row->'player_id', CASE WHEN TG_TABLE_NAME = 'players' THEN new_row->'id' END),
      'old', changed_old,
      'new', changed_new
    );
  END IF;

  INSERT INTO activity_log (source, actor_id, actor, action, detail, trace)
  VALUES ('DB', actor_id, actor, lower(TG_OP) || ' ' || TG_TABLE_NAME, detail, trace);
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- The log must never cost the write it describes.
  RAISE WARNING 'log_row_change on %: %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

CREATE TRIGGER payments_activity AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION log_row_change();
CREATE TRIGGER attendances_activity AFTER INSERT OR UPDATE OR DELETE ON attendances
  FOR EACH ROW EXECUTE FUNCTION log_row_change();
CREATE TRIGGER players_activity AFTER INSERT OR UPDATE OR DELETE ON players
  FOR EACH ROW EXECUTE FUNCTION log_row_change();
CREATE TRIGGER expenses_activity AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION log_row_change();
CREATE TRIGGER incomes_activity AFTER INSERT OR UPDATE OR DELETE ON incomes
  FOR EACH ROW EXECUTE FUNCTION log_row_change();
CREATE TRIGGER cash_handoffs_activity AFTER INSERT OR UPDATE OR DELETE ON cash_handoffs
  FOR EACH ROW EXECUTE FUNCTION log_row_change();
