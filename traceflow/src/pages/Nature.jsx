import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import { useI18n } from '@/lib/i18n';
import NatureOverview from '@/components/nature/NatureOverview';
import QueryExplorer from '@/components/nature/QueryExplorer';
import NutrientRuns from '@/components/nature/NutrientRuns';
import NatureModelPanel from '@/components/nature/NatureModelPanel';

const TABS = [
  { id: 'overview', fi: 'Valuma-alueet', en: 'Catchments' },
  { id: 'queries', fi: 'Kyselyt ja lähteet', en: 'Queries and sources' },
  { id: 'nutrient', fi: 'Ravinnekokeilut', en: 'Nutrient experiments' },
  { id: 'model', fi: 'Malli ja ajot', en: 'Model and jobs' },
];

export default function Nature() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [params, setParams] = useSearchParams();
  const status = useQuery({ queryKey: ['nature', 'status'], queryFn: api.natureStatus, refetchInterval: 15000 });
  const ready = status.data?.state === 'ready';
  const requested = params.get('tab');
  const tab = !ready && status.data ? 'model' : TABS.some((x) => x.id === requested) ? requested : 'overview';
  const setTab = (id) => setParams((p) => { p.set('tab', id); return p; });
  const openQuery = (id) => setParams((p) => { p.set('tab', 'queries'); p.set('query', id); return p; });

  return (
    <div>
      <PageHeader title={fi ? 'Luonto ja vesistöt' : 'Nature and water'} description={fi ? 'Missä sopimusviljelyalueilla vesistöt ovat heikossa tilassa, ja mistä niillä kannattaa keskustella tilojen kanssa?' : 'Where do Apetit contract areas meet weak water status, and what could be discussed with the farms there?'} />
      {status.error && <div className="surface mb-4 p-4 text-[12.5px] text-[#9E3B2C]">{status.error.message}</div>}
      {status.data && !ready && (
        <div className="surface mb-4 p-4 text-[12.5px]" data-testid="nature-not-built">
          <p className="font-medium">{status.data.state === 'not_built' ? (fi ? 'Luontomallin tietokantaa ei ole vielä rakennettu.' : 'The nature model database has not been built yet.') : (fi ? 'Luontomallin tietokantaa ei voi lukea.' : 'The nature model database cannot be read.')}</p>
          <p className="mt-1 text-muted-foreground">{status.data.message} {fi ? 'Rakenna se alta tai komennolla npm run nature:build.' : 'Build it below or with npm run nature:build.'}</p>
        </div>
      )}
      {ready && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-card p-1">
          {TABS.map((x) => (
            <button key={x.id} data-tab={x.id} onClick={() => setTab(x.id)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${tab === x.id ? 'bg-[#1B4968] text-[#EFF6FC]' : 'text-muted-foreground hover:text-foreground'}`}>{fi ? x.fi : x.en}</button>
          ))}
        </div>
      )}
      {ready && tab === 'overview' && <NatureOverview onOpenQuery={openQuery} />}
      {ready && tab === 'queries' && <QueryExplorer queryId={params.get('query')} onQueryChange={openQuery} />}
      {ready && tab === 'nutrient' && <NutrientRuns />}
      {tab === 'model' && <NatureModelPanel status={status.data} />}
    </div>
  );
}
