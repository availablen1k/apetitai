import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';

// Row-level ancestry of one saved query result: the same report the nature model's
// `query_nature_model.py lineage` command writes.
export default function LineagePanel({ target, onClose }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const q = useQuery({ queryKey: ['nature', 'lineage', target], queryFn: () => api.natureLineage(target.queryId, target.resultKey, target.runId), enabled: !!target });
  const d = q.data;
  const byTable = {};
  for (const e of d?.entities || []) byTable[e.table_name] = (byTable[e.table_name] || 0) + 1;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `lineage-${target.queryId}-${String(target.resultKey).replace(/[^A-Za-z0-9_-]+/g, '_')}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const methods = d?.method_context?.methods || [];

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="nature-lineage">
        <SheetHeader>
          <SheetTitle className="pr-4 font-heading text-[21px]">{fi ? 'Mistä tämä tulos tulee?' : 'Where does this result come from?'}</SheetTitle>
          <SheetDescription>{target ? `${target.queryId} · ${target.resultKey}` : ''}</SheetDescription>
        </SheetHeader>
        {q.isLoading && <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{fi ? 'Haetaan lähteitä…' : 'Loading sources…'}</p>}
        {q.error && <p className="mt-4 text-[12.5px] text-[#9E3B2C]">{q.error.message}</p>}
        {d && (
          <div className="mt-4 space-y-4 text-[12px]">
            <p className="leading-relaxed text-muted-foreground">{d.scope}</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Rivit mallissa' : 'Model rows'}</p><p className="text-[15px] font-semibold">{nf(d.entities.length)}</p></div>
              <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Lähderivit' : 'Source rows'}</p><p className="text-[15px] font-semibold">{nf(d.source_records.length)}</p></div>
              <div className="rounded-xl bg-secondary/60 px-2.5 py-2"><p className="text-muted-foreground">{fi ? 'Tiedostot' : 'Files'}</p><p className="text-[15px] font-semibold">{nf(d.source_files.length)}</p></div>
            </div>
            <section>
              <h3 className="mb-1.5 font-medium">{fi ? 'Lähdetiedostot' : 'Source files'}</h3>
              <ul className="space-y-1">{d.source_files.map((f) => <li key={f.source_id} className="rounded-lg border border-border/70 px-2.5 py-1.5"><span className="font-medium">{f.relative_path}</span><span className="ml-2 font-mono text-[10.5px] text-muted-foreground">sha256 {String(f.sha256).slice(0, 12)}…</span></li>)}</ul>
            </section>
            <section>
              <h3 className="mb-1.5 font-medium">{fi ? 'Mallin taulut' : 'Model tables'}</h3>
              <ul className="flex flex-wrap gap-1.5">{Object.entries(byTable).map(([t, n]) => <li key={t} className="rounded-full bg-secondary px-2.5 py-1">{t} · {n}</li>)}</ul>
            </section>
            {methods.length > 0 && <section>
              <h3 className="mb-1.5 font-medium">{fi ? 'Menetelmäkonteksti' : 'Method context'}</h3>
              <p className="mb-1.5 text-muted-foreground">{d.method_context.scope}</p>
              <ul className="space-y-1">{methods.map((m) => <li key={m.method_id} className="rounded-lg border border-border/70 px-2.5 py-1.5"><span className="font-medium">{m.name || m.method_id}</span>{m.implementation_status ? <span className="ml-1 text-muted-foreground">({m.implementation_status}{m.review_status ? ` · ${m.review_status}` : ''})</span> : null}{m.interpretation && <p className="mt-0.5 text-muted-foreground">{m.interpretation}</p>}</li>)}</ul>
            </section>}
            <section>
              <h3 className="mb-1.5 font-medium">{fi ? 'Ajo' : 'Execution'}</h3>
              <p className="text-muted-foreground">{d.query_run.query_run_id} · {d.query_run.executed_at_utc} · {fi ? 'parametrit' : 'parameters'} {d.query_run.parameters_json}</p>
              <p className="mt-1 text-muted-foreground">{fi ? 'Rakennus' : 'Build'} {d.build?.build_id} · {d.build?.built_at_utc}</p>
              {d.reviews_at_execution.length > 0 && <p className="mt-1">{fi ? 'Tarkistuksia ajohetkellä' : 'Reviews at execution'}: {d.reviews_at_execution.length}</p>}
            </section>
            <button onClick={download} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 hover:bg-secondary"><Download className="h-3.5 w-3.5" />{fi ? 'Lataa koko jäljitys (JSON)' : 'Download full lineage (JSON)'}</button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
