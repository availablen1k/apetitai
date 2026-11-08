import { type DB, nowIso, run } from '../db/database.ts';
import { newId } from '../domain/util.ts';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export type AuditInput = {
  event_type: string;
  actor_kind: 'reviewer' | 'system' | 'ai';
  actor_label: string;
  entity_type: string;
  entity_id?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  correlation_id?: string | null;
};

export function recordAudit(db: DB, e: AuditInput): string {
  const id = newId('evt');
  run(
    db,
    `INSERT INTO audit_events (id, at, event_type, actor_kind, actor_label, entity_type, entity_id, before_json, after_json, reason, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    nowIso(),
    e.event_type,
    e.actor_kind,
    e.actor_label,
    e.entity_type,
    e.entity_id ?? null,
    e.before === undefined ? null : JSON.stringify(e.before),
    e.after === undefined ? null : JSON.stringify(e.after),
    e.reason ?? null,
    e.correlation_id ?? null,
  );
  return id;
}
