// Open-Meteo forecast access (public API, no key).

export const REGIONS: Record<string, { name: string; nameFi: string; lat: number; lon: number }> = {
  FI_SW: { name: 'Southwest Finland', nameFi: 'Varsinais-Suomi', lat: 60.45, lon: 22.27 },
  FI_UUSIMAA: { name: 'Uusimaa', nameFi: 'Uusimaa', lat: 60.29, lon: 24.94 },
  FI_HAME: { name: 'Häme', nameFi: 'Häme', lat: 60.98, lon: 24.46 },
  FI_OSTROBOTHNIA: { name: 'Ostrobothnia', nameFi: 'Pohjanmaa', lat: 62.79, lon: 22.84 },
  FI_SAVO: { name: 'Savo', nameFi: 'Savo', lat: 62.89, lon: 27.68 },
  SE_SKANE: { name: 'Skåne', nameFi: 'Skåne', lat: 55.99, lon: 13.6 },
};

export type ForecastDay = {
  date: string; tmin_c: number | null; tmax_c: number | null; tmean_c: number | null; precip_mm: number; rain_mm: number;
  snow_cm: number; wind_ms: number | null; precip_probability: number | null; frost_risk: boolean;
};

const DAILY = ['temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean', 'precipitation_sum', 'rain_sum', 'snowfall_sum', 'wind_speed_10m_max', 'precipitation_probability_max'];

type DailyBody = { daily?: Record<string, (number | null)[]> & { time?: string[] } };

function toDays(data: DailyBody): ForecastDay[] {
  const d = data?.daily;
  if (!d?.time?.length) return [];
  return d.time.map((day, i) => {
    const tmin = d.temperature_2m_min?.[i] ?? null;
    return {
      date: day, tmin_c: tmin, tmax_c: d.temperature_2m_max?.[i] ?? null, tmean_c: d.temperature_2m_mean?.[i] ?? null,
      precip_mm: d.precipitation_sum?.[i] ?? 0, rain_mm: d.rain_sum?.[i] ?? 0, snow_cm: d.snowfall_sum?.[i] ?? 0,
      wind_ms: d.wind_speed_10m_max?.[i] ?? null, precip_probability: d.precipitation_probability_max?.[i] ?? null, frost_risk: tmin !== null && tmin <= 0,
    };
  });
}

export function summarize(days: ForecastDay[]) {
  return {
    tmin_c: Math.min(...days.map((d) => d.tmin_c ?? 99)),
    tmax_c: Math.max(...days.map((d) => d.tmax_c ?? -99)),
    precip_mm: Math.round(days.reduce((s, d) => s + (d.precip_mm || 0), 0) * 10) / 10,
    max_wind_ms: Math.max(...days.map((d) => d.wind_ms ?? 0)),
    frost_nights: days.filter((d) => d.frost_risk).length,
  };
}

const url = (lats: number[], lons: number[]) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&daily=${DAILY.join(',')}&timezone=Europe%2FHelsinki&forecast_days=7&wind_speed_unit=ms`;

export async function fetchRegionalForecast(code: string) {
  const region = REGIONS[code];
  if (!region) throw Object.assign(new Error('Unknown region'), { status: 400 });
  const res = await fetch(url([region.lat], [region.lon]), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Object.assign(new Error(`Open-Meteo returned HTTP ${res.status}`), { status: 502 });
  const forecast = toDays((await res.json()) as DailyBody);
  if (!forecast.length) throw Object.assign(new Error('Open-Meteo returned no forecast days'), { status: 502 });
  return { region, forecast, summary: summarize(forecast) };
}

// Open-Meteo accepts several coordinates per request and answers in the same order.
export async function fetchForecastBatch(coords: { lat: number; lon: number }[]): Promise<ForecastDay[][]> {
  if (!coords.length) return [];
  const res = await fetch(url(coords.map((c) => c.lat), coords.map((c) => c.lon)), { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw Object.assign(new Error(`Open-Meteo returned HTTP ${res.status}`), { status: 502 });
  const body = (await res.json()) as DailyBody | DailyBody[];
  return (Array.isArray(body) ? body : [body]).map(toDays);
}
