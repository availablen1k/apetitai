# TraceFlow database schema (SQLite)

Single file (`SQLITE_PATH`, default `data/traceflow.sqlite`), WAL mode, foreign keys on.
Migrations: `server/db/migrations/NNN_name.up.sql` / `.down.sql`, tracked in `schema_migrations`.
Tables marked **append-only** have triggers that abort any `UPDATE` or `DELETE`.

| Table | Purpose | Key columns |
|---|---|---|
| `import_batches` | one row per uploaded file | `sha256`, `dataset`, `file_format`, `expected_rows`, `imported_rows`, `duplicate_rows`, `rejected_rows`, `errors_json` (line + reason), `status` (`imported`, `imported_with_errors`, `duplicate_upload`, `rejected`), `stored_path` |
| `source_records` **append-only** | every imported row, unchanged | `id = rec_<fingerprint>`, `batch_id`, `table_name`, `record_key` (challenge key format, e.g. `erp:{doc_no}:{line_no}`), `year`, `source_file`, `source_row`, `source_line`, `payload_json` (original strings), `row_hash`, `fingerprint` (unique per table) |
| `shipments` | derived by the linker after each import | `record_id`, `ref_doc`, `mode`, `freight_t`, `distance_km`, `tkm_recorded`, `join_status` (`linked`, `linked_multi_line`, `unlinked_no_erp_document`, `outbound_sales_reference`), `erp_record_id`, `material_id`, `supplier_id`, `origin_country`, `allocation`, `route_status` |
| `locations` | origins/destinations entered for route proposals | `label`, `kind`, `lat`, `lon`, `source`, `review_status` |
| `route_proposals` / `route_legs` | route evidence for a leg | `provider` (`provided_distance`, `manual`, `fixture`, `here`), `status` (`proposed`, `verified`, `rejected`), `is_demo`, `total_km`, `provider_response_json`, `evidence_note`, `revision`, `reviewer_label`; legs: `leg_order`, `mode`, `distance_km`, labels, `geometry_json` |
| `scans` | one row per rule run | `rules_version`, `created/updated/unchanged/missing_count` |
| `dq_issues` | one persistent issue per fingerprint (`sha256(rule_id|record_key|field)`) | `rule_id`, `rule_version`, `issue_type`, `category`, `record_id`, `record_key`, `field`, `observed_value`, `candidate_value`, `action` (`set_value`, `exclude_record`, `add_record`, `acknowledge`), `evidence_ids_json`, `severity`, `confidence`, `impact`, `status` (`open`, `approved`, `rejected`), `detection_state`, `revision` |
| `dq_issue_history` **append-only** | created / evidence_updated / not_detected / approved … | `issue_id`, `scan_id`, `change`, `details_json` |
| `corrections` **append-only** | the human decision on an issue; approved ones are the calculation overlay | `issue_id` (unique), `record_id`, `field`, `action`, `original_value`, `approved_value`, `status`, `reviewer_label`, `reason`, `decided_at`, `issue_revision`, `proposed_by` (`rule`/`ai_investigation`), `evidence_ids_json` |
| `investigations` | Gemini (or test stub) investigations | `mode`, `model`, `status` (`completed`, `degraded`, `failed`), `result_json`, `tool_calls_json`, `evidence_ids_json`, `error`, tokens |
| `calculation_runs` **append-only** | immutable runs | `year`, `kind`, `scope2_basis`, `status`, `parent_run_id`, `method_version`, `dataset_hashes_json`, `correction_ids_json`, `factor_versions_json` (method constants + factor library snapshot), `completeness_json`, `checks_json`, `totals_json`, `gaps_json` |
| `calculation_contributions` **append-only** | one row per calculated line | `scope`, `category`, `line_item`, `kind` (`transport_leg`, `material_purchase`, `contract_farm`, `spend_purchase`, `activity`, `memo`), `source_record_ids_json`, `factor_id/value/unit/source`, `formula`, `inputs_json`, `kgco2e`, `tco2e`, `value_status` (`original`, `corrected`, `estimated`, `has_open_issue`), `correction_ids_json`, `open_issue_ids_json`, `in_total`, `basis` |
| `audit_events` **append-only** | every import, scan, decision, run, investigation | `seq`, `at`, `event_type`, `actor_kind` (`reviewer`, `system`, `ai`), `actor_label`, `entity_type`, `entity_id`, `before_json`, `after_json`, `reason`, `correlation_id` |
| `documents` | editable workspace items | `collection`, `id`, `data_json` |
| `discovery_runs` | queued/running/completed discovery jobs; interrupted jobs remain available for explicit retry | `request_id` unique, `year`, `calc_run_id`, `trigger`, `status`, `mode`, `model`, `notes_json`, calls/tokens, timestamps |
| `discovery_findings` **append-only** | calculated facts and bilingual wording from a completed discovery run | `discovery_run_id`, stable `finding_key`, internal `expert`, `kind`, `rank`, found/suggest text, owner, effect/action/evidence/facts JSON, wording source and numeric-check details |
| `discovery_decisions` **append-only** | named handling decisions, retained across reruns | `finding_key`, `year`, `decision` (`done`, `dismissed`, `reopened`), `reviewer_label`, `note`, `decided_at` |
| `evidence_files` **append-only** | original document metadata and local text | `sha256` unique, `stored_path`, `kind`, `text_status`, `pages_json` |
| `evidence_links` **append-only** | confirmed/contextual links to existing entities | `evidence_id`, `entity_type`, `entity_id`, `label` |
| `evidence_extractions` **append-only** | Gemini extraction history; evidence only | `evidence_id`, `issue_id`, `input_basis`, `result_json`, `status`, `error`, tokens |
| `evidence_text_runs` **append-only** | local OCR attempts without changing original text | `evidence_id`, `method`, `pages_json`, `status`, `error` |
| `upload_inbox` | one queued item per evidence file | `evidence_id` unique, `sheet_names_json`, `created_at` |
| `upload_decisions` **append-only** | human-confirmed classification history, one decision per action/sheet | `upload_id`, `destination`, `dataset`, `sheet`, `document_type`, `reporting_year`, `reviewer_label`, `import_batch_id` |
| `data_review_runs` | persistent import-level agent jobs and bounded execution diagnostics | `batch_id`, `status`, `mode`, `model`, `total_rows`, `local_rows`, `ai_rows`, `summary`, `notes_json`, `tools_json`, tokens, `error` |
| `data_review_findings` **append-only** | linked local/AI concerns needing a human decision | `run_id`, `issue_id`, `origin`, `concern_status`, `explanation`, `next_action`, qualitative `confidence`, `evidence_ids_json` |

Views: `v_emission_factors`, `v_materials`, `v_suppliers` (JSON fields of the imported master data).

## Invariants

* Source rows are never modified. A correction is an overlay keyed by `record_id` + `field`
  (or an exclusion / an added estimated row) and only `approved` corrections reach a calculation.
* Each calculation creates a new run; earlier runs stay readable unchanged.
* Scope 2: both bases are stored as contributions; only the run's `scope2_basis` has `in_total = 1`.
* Re-imports, re-scans and repeated decisions are idempotent or rejected (409).
* Successful mapped imports persist `import_batches.mapping_json`; `sheet_name` identifies their worksheet.
* Queuing an upload creates no calculation source rows or links. Classification and row import commit in one transaction.
* OCR and AI outputs are evidence. They never approve corrections or overwrite the document's original text.
