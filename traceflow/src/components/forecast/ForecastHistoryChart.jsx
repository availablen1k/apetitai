import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';

export default function ForecastHistoryChart({ history = [], forecastMean }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const data = history.map((row) => ({ year: row.YEAR, tmean: row.TMEAN }));

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 10.5, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={38} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
            formatter={(value) => [`${nf(value, 1)} °C`, fi ? 'Vuoden keskilämpötila' : 'Annual mean temperature']}
          />
          {Number.isFinite(forecastMean) && (
            <ReferenceLine
              y={forecastMean}
              stroke="hsl(var(--chart-3))"
              strokeDasharray="5 4"
              label={{
                value: fi ? 'Ennuste' : 'Forecast',
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'hsl(var(--muted-foreground))',
              }}
            />
          )}
          <Bar dataKey="tmean" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}