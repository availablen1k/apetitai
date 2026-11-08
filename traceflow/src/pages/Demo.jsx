import { Link } from 'react-router-dom';
import { ArrowRight, PlayCircle, CheckCircle2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import SourceBadge from '@/components/SourceBadge';
import { useI18n } from '@/lib/i18n';

const SCENES = [
  {
    fi: '1. Tiedostot tuodaan', en: '1. Files are imported',
    descFi: 'ERP-ostot, kuljetukset, energia, PCF:t ja tilatiedot tuodaan CSV/Excel/JSON-muodossa. Jokainen rivi säilyy alkuperäisenä tiedoston ja rivinumeron kanssa.',
    descEn: 'ERP purchases, shipments, energy, PCFs and farm data are imported as CSV/Excel/JSON. Every row is kept unchanged with its file and row number.',
    to: '/data-quality', ctaFi: 'Avaa validointi', ctaEn: 'Open validation',
  },
  {
    fi: '2. Säännöt liputtavat, ihminen päättää', en: '2. Rules flag, a human decides',
    descFi: 'Havainto näyttää alkuperäisen arvon, ehdotuksen, näytön ja vaikutuksen. Gemini voi tutkia havainnon, mutta vain ihminen hyväksyy tai hylkää.',
    descEn: 'A finding shows the original value, the proposal, the evidence and the impact. Gemini can investigate it, but only a person approves or rejects.',
    to: '/data-quality', ctaFi: 'Käsittele löydökset', ctaEn: 'Review findings',
  },
  {
    fi: '3. Kuljetukset lasketaan', en: '3. Transport is calculated',
    descFi: 'Jokainen osuus: t × km × kulkumuodon kerroin, rekka ja lautta erikseen. Matka on lähteen ilmoittama, ei keksitty reitti.',
    descEn: 'Each leg: t × km × the mode factor, truck and ferry separately. The distance is the one supplied by the source, not an invented route.',
    to: '/transport', ctaFi: 'Avaa kuljetukset', ctaEn: 'Open transport',
  },
  {
    fi: '4. Inventaario uutena ajona', en: '4. The inventory as a new run',
    descFi: 'Hyväksytyt korjaukset otetaan mukaan uudessa muuttumattomassa ajossa; avoimet havainnot lasketaan tuotuina arvoina ja merkitään. Vanhat ajot säilyvät.',
    descEn: 'Approved corrections are used in a new immutable run; rows with open findings are calculated as imported and marked. Earlier runs are kept.',
    to: '/sustainability', ctaFi: 'Avaa päästölaskenta', ctaEn: 'Open emissions',
  },
  {
    fi: '5. Selitä luku', en: '5. Explain the number',
    descFi: 'Mistä tahansa luvusta: laskentarivi → lähdetiedosto ja rivi → kerroin → korjaukset.',
    descEn: 'From any number: contribution → source file and row → factor → corrections.',
    to: '/traceability', ctaFi: 'Avaa jäljitettävyys', ctaEn: 'Open traceability',
  },
  {
    fi: '6. Excel-vienti', en: '6. Excel export',
    descFi: 'Ajo viedään Exceliin välilehtinä (kuljetukset, raaka-aineet, havainnot, korjaukset ja loki, kertoimet, yhteenveto, metatiedot).',
    descEn: 'The run is exported to Excel as sheets (shipments, raw materials, issues, corrections and audit, factors, summary, metadata).',
    to: '/reports', ctaFi: 'Avaa raportit', ctaEn: 'Open reports',
  },
];

export default function Demo() {
  const { t, lang } = useI18n();
  const fi = lang === 'fi';

  return (
    <div>
      <PageHeader
        eyebrow={fi ? 'Opastettu demo' : 'Guided demo'}
        title={fi ? 'Kuusi kohtausta: ongelmasta päätökseen' : 'Six scenes: from problem to decision'}
        description={fi ? 'Seuraa polkua raakadatasta hyväksyttyyn raporttiin. Jokainen vaihe käyttää samaa tuotua aineistoa.' : 'Follow the path from raw data to an approved report. Every step uses the same imported dataset.'}
        actions={<SourceBadge type="synthetic" />}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SCENES.map((s, i) => (
          <article key={s.en} className="surface flex flex-col p-5">
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF3FB]">
                {i === 0 ? <PlayCircle className="h-4 w-4 text-[#2E7099]" /> : <CheckCircle2 className="h-4 w-4 text-[#2E7099]" />}
              </span>
              <div>
                <h2 className="font-heading text-[15px] leading-tight">{fi ? s.fi : s.en}</h2>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{fi ? s.descFi : s.descEn}</p>
              </div>
            </div>
            <Link
              to={s.to}
              className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] font-medium transition hover:border-[#4A89B5]/40"
            >
              {fi ? s.ctaFi : s.ctaEn} <ArrowRight className="h-3 w-3" />
            </Link>
          </article>
        ))}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        {t('overview.sampleNote')}
      </p>
    </div>
  );
}