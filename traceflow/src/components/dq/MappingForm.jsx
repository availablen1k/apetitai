import { useState } from 'react';
import { Loader2, Bot, Columns3 } from 'lucide-react';
import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';

// Maps the columns of an unfamiliar CSV/XLSX to a known dataset. Gemini may suggest a mapping;
// the person confirms it, and the normal importer then reads every value.
export default function MappingForm({ file, headers, sample = [], defaultDataset = '', catalog = [], onImported }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [dataset, setDataset] = useState(defaultDataset || '');
  const [mapping, setMapping] = useState({});
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const def = catalog.find((d) => d.id === dataset);
  const columns = def ? def.columns : [];

  const suggest = async () => {
    setBusy('suggest');
    setError(null);
    try {
      const r = await api.suggestMapping(file, dataset || undefined);
      if (r.dataset) setDataset(r.dataset);
      setMapping(r.mapping || {});
      setInfo(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const doImport = async () => {
    setBusy('import');
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
      const r = await api.importFiles([file], { dataset, mapping: clean });
      onImported?.(r.results || []);
    } catch (e) {
      setError(e.details?.errors ? e.details.errors.join('; ') : e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-border bg-card p-3 text-[12px]" data-testid="mapping-form">
      <div className="mb-2 flex items-center gap-2 font-medium"><Columns3 className="h-3.5 w-3.5 text-[#2E7099]" />{fi ? 'Yhdistä sarakkeet aineistoon' : 'Map the columns to a dataset'}</div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={dataset} onChange={(e) => { setDataset(e.target.value); setMapping({}); setInfo(null); }} className="rounded-lg border border-border bg-card px-2 py-1.5 text-[12px]" data-testid="mapping-dataset">
          <option value="">{fi ? 'Valitse aineisto…' : 'Choose dataset…'}</option>
          {catalog.map((d) => <option key={d.id} value={d.id}>{d.label} ({d.id})</option>)}
        </select>
        <button onClick={suggest} disabled={!!busy} className="inline-flex items-center gap-1 rounded-full border border-[#EDDCC0] bg-[#FBF6EE] px-3 py-1.5 text-[11.5px] font-medium text-[#8A5A1E] disabled:opacity-60" data-testid="suggest-mapping">
          {busy === 'suggest' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}{fi ? 'Ehdota Geminillä' : 'Suggest with Gemini'}
        </button>
      </div>
      {info && (
        <p className={`mt-2 text-[11.5px] ${info.status === 'suggested' ? 'text-[#8A5A1E]' : 'text-muted-foreground'}`}>
          {info.status === 'suggested' ? `${fi ? 'AI-ehdotus' : 'AI suggestion'} (${info.model}, ${info.confidence}) — ${fi ? 'tarkista ennen tuontia' : 'check before importing'}. ` : ''}{info.notes}
          {info.dropped?.length ? ` ${fi ? 'Hylätty (sarake ei tiedostossa)' : 'Dropped (column not in file)'}: ${info.dropped.join(', ')}.` : ''}
        </p>
      )}
      {def && (
        <table className="mt-2 w-full text-left text-[11.5px]">
          <thead className="text-muted-foreground"><tr><th className="py-1 font-medium">{fi ? 'Aineiston sarake' : 'Dataset column'}</th><th className="py-1 font-medium">{fi ? 'Tiedoston sarake' : 'File column'}</th><th className="py-1 font-medium">{fi ? 'Esimerkki' : 'Example'}</th></tr></thead>
          <tbody>
            {columns.map((c) => {
              const src = mapping[c] || (headers.includes(c) ? c : '');
              const idx = headers.indexOf(src);
              return (
                <tr key={c} className="border-t border-border/60">
                  <td className="py-1 pr-2 font-mono">{c}{def.required_columns.includes(c) ? ' *' : ''}</td>
                  <td className="py-1 pr-2">
                    <select value={src} onChange={(e) => setMapping({ ...mapping, [c]: e.target.value })} className="w-full rounded border border-border bg-card px-1.5 py-1 text-[11.5px]" data-testid={`map-${c}`}>
                      <option value="">{fi ? '— ei —' : '— none —'}</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                  <td className="max-w-[160px] truncate py-1 text-muted-foreground">{idx >= 0 ? sample[0]?.[idx] ?? '' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {error && <p className="mt-2 rounded bg-[#F5E4E1] px-2 py-1 text-[11.5px] text-[#8C3B2E]">{error}</p>}
      <button onClick={doImport} disabled={!def || !!busy} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#1B4968] px-3.5 py-1.5 text-[12px] font-medium text-[#EFF6FC] disabled:opacity-50" data-testid="import-mapped">
        {busy === 'import' && <Loader2 className="h-3 w-3 animate-spin" />}{fi ? 'Tuo tällä yhdistämisellä' : 'Import with this mapping'}
      </button>
      <p className="mt-1 text-[10.5px] text-muted-foreground">{fi ? '* pakollinen. Arvot luetaan tiedostosta sellaisinaan; AI ei käsittele lukuja.' : '* required. Values are read from the file as-is; the AI never handles the numbers.'}</p>
    </div>
  );
}
