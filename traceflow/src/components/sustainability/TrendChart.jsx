import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';

// points: one per year from that year's latest run ({ year, scope1, scope2, scope3, total }).
export default function TrendChart({ points }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const data = [...points].sort((a, b) => a.year - b.year);
  if (data.length < 2) return null;
  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="year" tick={{ fontSize: 10.5, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => (v >= 1e6 ? `${nf(v / 1e6, 1)}M` : v >= 1000 ? `${nf(v / 1000, 0)}k` : nf(v))} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={52} />
          <Tooltip formatter={(v) => `${nf(v)} tCO₂e`} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
          <Line type="monotone" dataKey="total" name={fi ? 'Yhteensä' : 'Total'} stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="scope3" name="Scope 3" stroke="hsl(var(--chart-2))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
