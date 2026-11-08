import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import StatusPill from '@/components/StatusPill';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';

const LEVEL_TONE = { high: 'high', medium: 'medium', low: 'low' };

const DRIVER_LABEL = {
  frost_nights: { fi: 'hallayöt', en: 'frost nights' },
  hard_frost: { fi: 'kova halla', en: 'hard frost' },
  heavy_rain_days: { fi: 'rankkasateet', en: 'heavy rain days' },
  precip_deficit_pct: { fi: 'sadevaje', en: 'rain deficit' },
  precip_surplus_pct: { fi: 'sadeylijäämä', en: 'rain surplus' },
  heat_days: { fi: 'helteiset päivät', en: 'hot days' },
};

export default function FarmRiskList({ farms }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const items = farms?.items || [];

  if (!farms?.total) {
    return (
      <div className="flex h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 text-center">
        <p className="text-[12.5px] font-medium text-foreground">
          {fi ? 'Ei tiloja tällä alueella' : 'No farms in this region'}
        </p>
        <p className="mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
          {fi
            ? 'Tilarekisterissä ei ole tämän alueen tiloja, joten tilariskejä ei voi laskea.'
            : 'The farm register holds no farms for this region, so farm-level risks cannot be derived.'}
        </p>
      </div>
    );
  }

  const levelLabel = (level) =>
    level === 'high'
      ? fi ? 'Korkea' : 'High'
      : level === 'medium'
        ? fi ? 'Kohtalainen' : 'Moderate'
        : fi ? 'Vähäinen' : 'Low';

  const driversText = (drivers = []) =>
    drivers.length
      ? drivers
          .map((driver) => {
            const label = DRIVER_LABEL[driver.code]?.[fi ? 'fi' : 'en'] || driver.code;
            const unit = driver.code.endsWith('_pct') ? ' %' : '';
            return `${nf(driver.value, 0)}${unit} ${label}`;
          })
          .join(' · ')
      : fi ? 'ei ennustesignaaleja' : 'no forecast signals';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {['high', 'medium', 'low'].map((level) => (
          <span key={level} className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-2.5 py-1">
            <StatusPill tone={LEVEL_TONE[level]}>{levelLabel(level)}</StatusPill>
            <span className="text-[11.5px] font-semibold tabular-nums text-foreground">{farms.counts?.[level] ?? 0}</span>
          </span>
        ))}
        <span className="text-[11.5px] text-muted-foreground">
          {fi ? `${farms.total} tilaa alueella` : `${farms.total} farms in the region`}
        </span>
      </div>

      <div className="max-h-[420px] overflow-y-auto scrollbar-thin rounded-xl border border-border">
        {items.map((farm) => (
          <Link
            key={farm.id}
            to={`/farms/${farm.id}`}
            className="flex items-start gap-3 border-b border-border px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-muted/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">{farm.farm_id}</span>
                <StatusPill tone={LEVEL_TONE[farm.level]}>{levelLabel(farm.level)}</StatusPill>
                {farm.planned_crop && (
                  <span className="text-[11px] text-muted-foreground">{farm.planned_crop}</span>
                )}
                {farm.area_ha ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">{nf(farm.area_ha, 0)} ha</span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{driversText(farm.drivers)}</p>
            </div>
            <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}