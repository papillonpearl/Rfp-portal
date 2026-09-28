-- Enforced by the database, not only by the application: a bug in a route
-- or a hand-run query must not be able to rewrite history.

-- The activity log is append-only.
CREATE OR REPLACE FUNCTION activity_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER activity_log_no_update BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_append_only();--> statement-breakpoint

-- A submitted bid never changes. Revisions are new rows in a new round.
CREATE OR REPLACE FUNCTION bids_submitted_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'submitted bids cannot be changed or deleted';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bids_submitted_immutable BEFORE UPDATE OR DELETE ON bids
  FOR EACH ROW EXECUTE FUNCTION bids_submitted_immutable();
