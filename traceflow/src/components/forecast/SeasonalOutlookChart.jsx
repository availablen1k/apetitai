import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import ChartEmpty from '@/components/ChartEmpty';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';

export default function SeasonalOutlookChart({ monthly = [], month, forecastMean, forecastPrecip, expectedPrecip }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const locale = fi ? 'fi-FI' : 'en-GB';

  if (!monthly.length) {
    return (
      <ChartEmpty
        title={fi ? 'Ei ilmastollisia normeja' : 'No climate normals yet'}
        hint={fi
          ? 'ClimateStat-taulussa ei ole kuukausittaisia normeja tälle alueelle.'
          : 'ClimateStat holds no monthly normals for this region.'}
      />
    );
  }

  const labelFor = (value) => {
    try {
      return new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2024, Number(value) - 1, 1));
    } catch {
      return String(value);
    }
  };

  const data = monthly.map((entry) => {
    const isCurrent = Number(entry.month) === Number(month);
    return {
      label: labelFor(entry.month),
      tmean_normal: entry.tmean,
      precip_normal: entry.precip,
      tmean_forecast: isCurrent ? forecastMean ?? null : null,
      precip_projected: isCurrent ? forecastPrecip ?? null : null,
    };
  });

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="temp" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={38} />
          <YAxis yAxisId="rain" orientation="right" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
            formatter={(value, key) => {
              if (key === 'tmean_normal') return [`${nf(value, 1)} °C`, fi ? 'Normaali keskilämpötila' : 'Normal mean temperature'];
              if (key === 'tmean_forecast') return [`${nf(value, 1)} °C`, fi ? 'Ennustettu keskilämpötila' : 'Forecast mean temperature'];
              if (key === 'precip_projected') return [`${nf(value, 1)} mm`, fi ? 'Ennustettu sade' : 'Forecast rainfall'];
              return [`${nf(value, 1)} mm`, fi ? 'Normaali sademäärä' : 'Normal rainfall'];
            }}
          />
          <Legend
            formatter={(value) => (
              <span className="text-[11px] text-muted-foreground">
                {value === 'tmean_normal'
                  ? fi ? 'Normaali lämpötila' : 'Normal temperature'
                  : value === 'tmean_forecast'
                    ? fi ? 'Ennuste nyt' : 'Forecast now'
                    : value === 'precip_projected'
                      ? fi ? 'Ennustettu sade nyt' : 'Forecast rain now'
                      : fi ? 'Normaali sade' : 'Normal rainfall'}
              </span>
            )}
          />
          <Bar yAxisId="rain" dataKey="precip_normal" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} barSize={12} />
          <Bar yAxisId="rain" dataKey="precip_projected" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} barSize={12} />
          <Line yAxisId="temp" type="monotone" dataKey="tmean_normal" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 2 }} />
          <Line yAxisId="temp" type="monotone" dataKey="tmean_forecast" stroke="hsl(var(--chart-2))" strokeWidth={0} dot={{ r: 5 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {expectedPrecip ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {fi
            ? `Tämän jakson normaalisade ${nf(expectedPrecip, 1)} mm, ennuste ${nf(forecastPrecip, 1)} mm.`
            : `Normal rainfall for this span is ${nf(expectedPrecip, 1)} mm, the forecast gives ${nf(forecastPrecip, 1)} mm.`}
        </p>
      ) : null}
    </div>
  );
}