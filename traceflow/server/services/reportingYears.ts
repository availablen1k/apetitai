import { type DB, all } from '../db/database.ts';

export const ACTIVITY_DATASETS = ['erp_purchase_lines', 'shipments', 'energy_meter_readings', 'fuel_deliveries', 'refrigerant_service_log', 'waste_transfer_notes', 'travel_bookings', 'sales_volumes'];
export const CALCULABLE_DATASETS = [...ACTIVITY_DATASETS, 'fuel_stock_changes', 'wastewater_third_party', 'headcount', 'frozen_warehousing'];

export function reportingYears(db: DB, currentYear = new Date().getFullYear()) {
  const activity = all<{ year: number }>(db, `SELECT DISTINCT year FROM source_records WHERE table_name IN (${CALCULABLE_DATASETS.map(() => '?').join(',')}) AND year IS NOT NULL ORDER BY year DESC`, ...CALCULABLE_DATASETS).map((row) => row.year);
  const saved = all<{ year: number }>(db, 'SELECT DISTINCT year FROM calculation_runs').map((row) => row.year);
  return { years: [...new Set([currentYear, ...activity, ...saved])].sort((a, b) => b - a), defaultYear: activity[0] || currentYear };
}

export function yearCoverage(db: DB, year: number) {
  const counts = all<{ table_name: string; records: number }>(db, 'SELECT table_name, COUNT(*) AS records FROM source_records WHERE year = ? GROUP BY table_name', year);
  const byDataset = Object.fromEntries(counts.map((row) => [row.table_name, row.records]));
  return { year, activity_records: CALCULABLE_DATASETS.reduce((sum, dataset) => sum + (byDataset[dataset] || 0), 0), by_dataset: byDataset, missing_activity: ACTIVITY_DATASETS.filter((dataset) => !byDataset[dataset]) };
}
