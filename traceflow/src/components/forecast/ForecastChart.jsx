import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';

export default function ForecastChart({ days = [] }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';

  const data = days.map((day) => ({
    day: String(day.date).slice(5).replace('-', '.'),
    tmin: day.tmin_c,
    tmax: day.tmax_c,
    precip: day.precip_mm,
  }));

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10.5, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="temp" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={38} />
          <YAxis yAxisId="rain" orientation="right" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
            formatter={(value, key) => {
              if (key === 'tmin') return [`${nf(value, 1)} °C`, fi ? 'Alin lämpötila' : 'Minimum'];
              if (key === 'tmax') return [`${nf(value, 1)} °C`, fi ? 'Ylin lämpötila' : 'Maximum'];
              return [`${nf(value, 1)} mm`, fi ? 'Sade' : 'Precipitation'];
            }}
          />
          <Legend
            formatter={(value) => (
              <span className="text-[11px] text-muted-foreground">
                {value === 'tmin'
                  ? fi ? 'Alin lämpötila' : 'Minimum temperature'
                  : value === 'tmax'
                    ? fi ? 'Ylin lämpötila' : 'Maximum temperature'
                    : fi ? 'Sade' : 'Precipitation'}
              </span>
            )}
          />
          <Bar yAxisId="rain" dataKey="precip" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} barSize={16} />
          <Line yAxisId="temp" type="monotone" dataKey="tmax" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 2.5 }} />
          <Line yAxisId="temp" type="monotone" dataKey="tmin" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 2.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}