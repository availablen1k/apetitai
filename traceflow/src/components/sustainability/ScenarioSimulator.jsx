import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import SourceBadge from '@/components/SourceBadge';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';

export default function ScenarioSimulator({ lines }) {
  const { lang, t } = useI18n();
  const fi = lang === 'fi';
  const usable = lines.filter((l) => l.status !== 'insufficient' && l.tco2e > 0);
  const [lineId, setLineId] = useState(usable.find((l) => l.category.includes('cat1'))?.id || usable[0]?.id || '');
  const [cut, setCut] = useState(10);

  const total = usable.reduce((s, l) => s + (l.tco2e || 0), 0);
  const line = usable.find((l) => l.id === lineId) || usable[0];
  const saved = line ? (line.tco2e * cut) / 100 : 0;
  const next = Math.max(0, total - saved);

  const bars = useMemo(() => ([
    { label: fi ? 'Nykytaso' : 'Baseline', value: total },
    { label: fi ? 'Skenaario' : 'Scenario', value: next },
  ]), [total, next, fi]);

  if (!line) return null;
  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <div className="surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[#2E7099]" />
            <h2 className="font-heading text-[17px]">{t('sustain.scenario')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            {fi ? 'Valitse laskentarivi ja vähennys. Luku on havainnollistava, ei ennuste.' : 'Pick a line and a reduction. Illustrative, not a forecast.'}
          </p>
        </div>
        <SourceBadge type="illustrative" />
      </div>

      <label className="mt-4 block">
        <span className="eyebrow">{fi ? 'Laskentarivi' : 'Line item'}</span>
        <select
          value={lineId}
          onChange={(e) => setLineId(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2 text-[12.5px]"
        >
          {usable.map((l) => (
            <option key={l.id} value={l.id}>{l.label} — {nf(l.tco2e)} tCO₂e</option>
          ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className="flex items-center justify-between text-[12px]">
          <span className="eyebrow">{fi ? 'Vähennys' : 'Reduction'}</span>
          <span className="numeral text-[13px] font-semibold">{cut} %</span>
        </span>
        <input
          type="range"
          min="0"
          max="50"
          step="1"
          value={cut}
          onChange={(e) => setCut(Number(e.target.value))}
          className="mt-2 w-full accent-[#2E7099]"
        />
      </label>

      <div className="mt-4 space-y-2">
        {bars.map((b, i) => (
          <div key={b.label}>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-muted-foreground">{b.label}</span>
              <span className="numeral font-semibold">{nf(b.value)} tCO₂e</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${i === 0 ? 'bg-[#1B4968]' : 'bg-[#6FA8D6]'}`}
                style={{ width: `${(b.value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 rounded-xl bg-[#EAF3FB] px-3 py-2 text-[11.5px] text-[#1E5578]">
        −{nf(saved)} tCO₂e ({total ? nf((saved / total) * 100, 1) : 0} % {fi ? 'kokonaispäästöistä' : 'of total emissions'})
      </p>
    </div>
  );
}