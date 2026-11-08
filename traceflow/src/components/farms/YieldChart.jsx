import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { nf } from '@/lib/format';

export default function YieldChart({ series = [], crop, lang = 'fi' }) {
  const data = [...series]
    .filter((s) => s && s.year)
    .sort((a, b) => a.year - b.year)
    .map((s) => ({ year: s.year, yield: Number(s.yield) || 0 }));
  if (data.length < 2) {
    return <p className="py-6 text-[12px] text-muted-foreground">{lang === 'fi' ? 'Satohistoriaa ei ole riittävästi.' : 'Not enough yield history.'}</p>;
  }
  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <XAxis dataKey="year" tick={{ fontSize: 10.5, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v) => [`${nf(v, 2)} t/ha`, crop || '']}
            contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
          />
          <Line type="monotone" dataKey="yield" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}