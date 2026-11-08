import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';
import ChartEmpty from '@/components/ChartEmpty';

const axis = { fontSize: 10.5, fill: 'hsl(var(--muted-foreground))' };
const kfmt = (v) => (Math.abs(v) >= 1000 ? `${nf(v / 1000, 0)}k` : nf(v));

// Monitored total P and N loads (kg/year) of one catchment, as supplied (method per row).
export function MonitoringChart({ rows }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  if (!rows?.length) return <ChartEmpty title={fi ? 'Ei kuormitusseurantaa' : 'No load monitoring'} hint={fi ? 'Vain osalla valuma-alueista on seuranta-asema.' : 'Only some catchments have a monitoring station.'} />;
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="year" tick={axis} axisLine={false} tickLine={false} />
          <YAxis yAxisId="p" tickFormatter={kfmt} tick={axis} axisLine={false} tickLine={false} width={46} />
          <YAxis yAxisId="n" orientation="right" tickFormatter={kfmt} tick={axis} axisLine={false} tickLine={false} width={46} />
          <Tooltip formatter={(v, name) => [`${nf(v)} kg`, name]} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line isAnimationActive={false} yAxisId="p" type="monotone" dataKey="total_p_load_kg" name={fi ? 'Fosfori (P)' : 'Phosphorus (P)'} stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
          <Line isAnimationActive={false} yAxisId="n" type="monotone" dataKey="total_n_load_kg" name={fi ? 'Typpi (N)' : 'Nitrogen (N)'} stroke="hsl(var(--chart-3))" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Screened field area per action lever (query 18): assessment leads, not reductions.
// Delivered load per input variant and stress case of a loss pilot (uncalibrated), from the
// pilot's catchment_summary.csv for one scope. A scope total is null (unknown) when any field in
// scope is unavailable; the bar then shows the available-fields-only sum, labelled as partial.
export function LossChart({ summary, scope }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const rows = (summary || []).filter((r) => r.scope === scope);
  const keys = [...new Set(rows.map((r) => `${r.input_variant} · ${r.input_point} · ${r.stress_case}`))];
  const data = keys.map((k) => {
    const pick = (n) => rows.find((r) => `${r.input_variant} · ${r.input_point} · ${r.stress_case}` === k && r.nutrient === n);
    const p = pick('P');
    const n = pick('N');
    return { case: k, P: p?.scope_delivered_kg ?? null, P_partial: p?.scope_delivered_kg == null ? p?.available_fields_delivered_kg ?? null : null, N: n?.scope_delivered_kg ?? null, N_partial: n?.scope_delivered_kg == null ? n?.available_fields_delivered_kg ?? null : null, p, n };
  });
  if (!data.length) return null;
  const label = (row, key) => {
    const full = row[key];
    const partial = row[`${key}_partial`];
    const src = key === 'P' ? row.p : row.n;
    if (full !== null) return `${nf(full, 1)} kg`;
    if (partial === null) return fi ? 'tuntematon' : 'unknown';
    return `${fi ? 'kokonaismäärä tuntematon; saatavilla olevat pellot' : 'total unknown; available fields only'} ${nf(partial, 1)} kg (${nf(src?.coverage_pct, 0)} % ${fi ? 'alasta' : 'of area'})`;
  };
  return (
    <div className="w-full" style={{ height: Math.max(180, data.length * 30 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
          <XAxis type="number" tick={axis} axisLine={false} tickLine={false} tickFormatter={kfmt} />
          <YAxis type="category" dataKey="case" tick={{ ...axis, fontSize: 9.5 }} axisLine={false} tickLine={false} width={190} />
          <Tooltip formatter={(_v, name, item) => [label(item.payload, String(item.dataKey).replace('_partial', '')), name]} contentStyle={{ fontSize: 12, borderRadius: 10, maxWidth: 360, whiteSpace: 'normal' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="P" stackId="p" name={fi ? 'Fosfori (P), kg' : 'Phosphorus (P), kg'} fill="hsl(var(--chart-1))" />
          <Bar dataKey="P_partial" stackId="p" name={fi ? 'P, osittainen (kokonaismäärä tuntematon)' : 'P, partial (total unknown)'} fill="hsl(var(--chart-1))" fillOpacity={0.35} />
          <Bar dataKey="N" stackId="n" name={fi ? 'Typpi (N), kg' : 'Nitrogen (N), kg'} fill="hsl(var(--chart-3))" />
          <Bar dataKey="N_partial" stackId="n" name={fi ? 'N, osittainen (kokonaismäärä tuntematon)' : 'N, partial (total unknown)'} fill="hsl(var(--chart-3))" fillOpacity={0.35} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
