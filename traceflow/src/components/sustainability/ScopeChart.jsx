import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-4))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-5))'];

export default function ScopeChart({ lines }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const data = lines
    .filter((l) => l.status !== 'insufficient' && l.tco2e > 0)
    .sort((a, b) => b.tco2e - a.tco2e)
    .slice(0, 8)
    .map((l) => ({
      name: (!fi && l.label_en) || l.label || l.category,
      value: l.tco2e,
      scope: l.scope,
    }));

  if (!data.length) return null;
  const smallValues = Math.max(...data.map((item) => item.value)) < 10;

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
          <XAxis
            type="number"
            tickFormatter={(v) => (v >= 1000 ? `${nf(v / 1000, 0)}k` : nf(v, smallValues ? 1 : 0))}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            tick={{ fontSize: 10.5, fill: 'hsl(var(--foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v) => [`${nf(v, smallValues ? 3 : 0)} tCO₂e`, fi ? 'Päästöt' : 'Emissions']}
            contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={d.scope.startsWith('scope3') ? COLORS[2] : d.scope === 'scope1' ? COLORS[0] : COLORS[1]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
