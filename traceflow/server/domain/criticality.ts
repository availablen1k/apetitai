// Review priority over existing detector assessments. Original severity/history are preserved.
export const CRITICALITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Criticality = typeof CRITICALITIES[number];
export const CRITICALITY_POLICY = 'severity-impact-v1';
export function criticalityOf(issue: { severity: string; impact?: string }): Criticality {
  if (issue.severity === 'critical' || issue.severity === 'high' && issue.impact === 'high') return 'critical';
  return issue.severity === 'high' || issue.severity === 'low' ? issue.severity : 'medium';
}
export const criticalitySQL = (alias = '') => {
  const p = alias ? `${alias}.` : '';
  return `(CASE WHEN ${p}severity = 'critical' OR (${p}severity = 'high' AND ${p}impact = 'high') THEN 'critical' WHEN ${p}severity IN ('high','medium','low') THEN ${p}severity ELSE 'medium' END)`;
};
