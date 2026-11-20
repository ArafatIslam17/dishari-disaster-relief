-- NFR12 / UC24 QR1: the audit trail cannot be edited or deleted, not even by the application role.
CREATE OR REPLACE FUNCTION relief_reject_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION relief_reject_audit_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION relief_reject_audit_change();
--> statement-breakpoint
-- NFR09 / NFR12: sync events are stored once and never rewritten. The only permitted
-- change is resolving a deferred (out-of-order) event to its final outcome.
CREATE OR REPLACE FUNCTION relief_guard_sync_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'sync_event is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'deferred'
     OR NEW.event_id <> OLD.event_id OR NEW.device_id <> OLD.device_id OR NEW.user_id <> OLD.user_id
     OR NEW.entity_id <> OLD.entity_id OR NEW.entity_type <> OLD.entity_type OR NEW.action <> OLD.action
     OR NEW.device_seq <> OLD.device_seq OR NEW.base_version <> OLD.base_version
     OR NEW.payload::text <> OLD.payload::text OR NEW.pii_enc IS DISTINCT FROM OLD.pii_enc
     OR NEW.client_time <> OLD.client_time OR NEW.received_at <> OLD.received_at
     OR NEW.clock_offset_ms <> OLD.clock_offset_ms THEN
    RAISE EXCEPTION 'sync_event is append-only (only a deferred status may be resolved)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sync_event_guard BEFORE UPDATE OR DELETE ON sync_event
  FOR EACH ROW EXECUTE FUNCTION relief_guard_sync_event();
--> statement-breakpoint
CREATE TRIGGER sync_event_no_truncate BEFORE TRUNCATE ON sync_event
  FOR EACH STATEMENT EXECUTE FUNCTION relief_guard_sync_event();
--> statement-breakpoint
-- Distribution items are part of the immutable distribution record (voiding keeps them).
CREATE OR REPLACE FUNCTION relief_reject_item_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'distribution_item is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER distribution_item_no_change BEFORE UPDATE OR DELETE ON distribution_item
  FOR EACH ROW EXECUTE FUNCTION relief_reject_item_change();
