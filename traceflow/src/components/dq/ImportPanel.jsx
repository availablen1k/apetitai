import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, Loader2, CheckCircle2, AlertTriangle, ScanSearch } from 'lucide-react';
import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { nf } from '@/lib/format';
import { useToast } from '@/components/ui/use-toast';
import StatusPill from '@/components/StatusPill';
import MappingForm from '@/components/dq/MappingForm';

// The browser only sends the file; the backend parses and stores every row of it.
export default function ImportPanel() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dataset, setDataset] = useState('auto');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState([]);
  const [sent, setSent] = useState({});
  const catalog = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });

  const submit = async () => {
    if (!files.length) return;
    setBusy(true);
    setSent(Object.fromEntries(files.map((f) => [f.name, f])));
    try {
      const res = await api.importFiles(files, { dataset });
      setResults(res.results || []);
      qc.invalidateQueries();
      const ok = (res.results || []).filter((r) => r.batch);
      toast({ title: fi ? 'Tuonti valmis' : 'Import finished', description: `${ok.length}/${files.length} ${fi ? 'tiedostoa' : 'files'} · ${nf(ok.reduce((s, r) => s + r.batch.imported_rows, 0))} ${fi ? 'uutta riviä' : 'new rows'}` });
      setFiles([]);
    } catch (e) {
      setResults([{ error: e.message, details: e.details, filename: files.length === 1 ? files[0].name : files.map((f) => f.name).join(', ') }]);
      toast({ title: fi ? 'Tuonti epäonnistui' : 'Import failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const s = await api.scan();
      qc.invalidateQueries();
      toast({ title: fi ? 'Laatusäännöt ajettu' : 'Quality rules ran', description: `${nf(s.findings)} ${fi ? 'havaintoa' : 'findings'} · ${nf(s.created)} ${fi ? 'uutta' : 'new'} · ${nf(s.unchanged)} ${fi ? 'ennallaan' : 'unchanged'}` });
    } catch (e) {
      toast({ title: fi ? 'Ajo epäonnistui' : 'Scan failed', description: e.message, variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="surface p-5">
      <h2 className="font-heading text-[18px]">{fi ? 'Tuo CSV-, Excel- tai PCF-tiedostoja' : 'Import CSV, Excel or PCF files'}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        {fi
          ? 'Palvelin käsittelee koko tiedoston: jokainen rivi tallennetaan muuttumattomana lähderivinä tiedoston SHA-256-tiivisteen, rivinumeron ja tuontierän kanssa. Saman tiedoston uusi tuonti ei luo kaksoisrivejä.'
          : 'The server processes the whole file: every row is stored unchanged with the file SHA-256, row number and import batch. Importing the same file again creates no duplicate rows.'}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow">{fi ? 'Aineisto' : 'Dataset'}</span>
          <select value={dataset} onChange={(e) => setDataset(e.target.value)} className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px]">
            <option value="auto">{fi ? 'Tunnista sarakkeista (suositus)' : 'Detect from columns (recommended)'}</option>
            {(catalog.data?.catalog || []).map((d) => (
              <option key={d.id} value={d.id}>{d.label} ({d.id})</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow">{fi ? 'Taulukot (.csv, .xlsx, PACT .json)' : 'Tables (.csv, .xlsx, PACT .json)'}</span>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/40 px-3 py-2">
            <UploadCloud className="h-4 w-4 shrink-0 text-[#2E7099]" />
            <input
              type="file"
              multiple
              
              onChange={(e) => { setFiles(Array.from(e.target.files || [])); setResults([]); }}
              className="w-full text-[12px] file:mr-2 file:rounded-full file:border-0 file:bg-[#1B4968] file:px-2.5 file:py-1 file:text-[11px] file:text-[#EFF6FC]"
              data-testid="import-file"
            />
          </div>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={submit} disabled={busy || !files.length} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] transition hover:bg-[#22557A] disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {fi ? `Tuo ${files.length || ''} tiedosto(a)` : `Import ${files.length || ''} file(s)`}
        </button>
        <button onClick={scan} disabled={scanning} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] font-medium transition hover:border-[#2E7099]/40 disabled:opacity-50">
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
          {fi ? 'Aja laatusäännöt' : 'Run quality rules'}
        </button>
      </div>

      {results.map((r, i) => (
        <div key={i} className="mt-4 rounded-xl border border-border bg-secondary/30 p-3 text-[12px]">
          {r.error ? (
            <div>
              <div className="flex items-start gap-2 text-[#8C3B2E]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <div className="font-medium">{r.filename}: {r.error}</div>
                  {r.details?.headers && <div className="mt-1 text-muted-foreground">{fi ? 'Sarakkeet' : 'Columns'}: {r.details.headers.join(', ')}</div>}
                </div>
              </div>
              {(r.details?.reason === 'unknown_layout' || r.details?.reason === 'missing_columns') && sent[r.filename] && (
                <MappingForm file={sent[r.filename]} headers={r.details.headers} sample={r.details.sample} defaultDataset={r.details.dataset} catalog={catalog.data?.catalog || []}
                  onImported={(res) => { setResults((prev) => prev.map((x, j) => (j === i ? res[0] : x))); qc.invalidateQueries(); }} />
              )}
              {r.details?.reason === 'not_tabular' && sent[r.filename] && (
                <button onClick={async () => { try { await api.addEvidence([sent[r.filename]]); qc.invalidateQueries(); toast({ title: fi ? 'Tallennettu näytöksi' : 'Stored as evidence', description: r.filename }); } catch (e) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); } }}
                  className="mt-2 rounded-full border border-border px-3 py-1.5 text-[11.5px]" data-testid="store-as-evidence">
                  {fi ? 'Tallenna asiakirjana (Asiakirjat-välilehti)' : 'Store as a document (Documents tab)'}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#2E7099]" />
                <span className="font-medium">{r.batch.filename}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{r.batch.dataset}</span>
                <StatusPill tone={r.batch.status === 'imported' ? 'ok' : r.batch.status === 'duplicate_upload' ? 'draft' : 'review'} dot={false}>{r.batch.status}</StatusPill>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
                <div><dt className="text-muted-foreground">{fi ? 'Rivejä tiedostossa' : 'Rows in file'}</dt><dd className="numeral">{nf(r.batch.expected_rows)}</dd></div>
                <div><dt className="text-muted-foreground">{fi ? 'Tuotu' : 'Imported'}</dt><dd className="numeral">{nf(r.batch.imported_rows)}</dd></div>
                <div><dt className="text-muted-foreground">{fi ? 'Jo olemassa' : 'Already present'}</dt><dd className="numeral">{nf(r.batch.duplicate_rows)}</dd></div>
                <div><dt className="text-muted-foreground">{fi ? 'Hylätty' : 'Rejected'}</dt><dd className="numeral">{nf(r.batch.rejected_rows)}</dd></div>
                <div><dt className="text-muted-foreground">SHA-256</dt><dd className="truncate font-mono text-[10.5px]">{r.batch.sha256.slice(0, 16)}…</dd></div>
              </dl>
              {r.batch.errors?.length > 0 && (
                <ul className="mt-2 max-h-32 overflow-auto rounded-lg bg-[#F5E4E1]/60 p-2 text-[11px] text-[#8C3B2E]">
                  {r.batch.errors.slice(0, 20).map((e, j) => <li key={j}>{fi ? 'Rivi' : 'Line'} {e.line}: {e.reason}</li>)}
                  {r.batch.errors.length > 20 && <li>… +{r.batch.errors.length - 20}</li>}
                </ul>
              )}
              {r.preview?.rows?.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <p className="mb-1 text-[11px] text-muted-foreground">{fi ? 'Esikatselu: 10 ensimmäistä riviä (koko tiedosto käsiteltiin)' : 'Preview: first 10 rows (the whole file was processed)'}</p>
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-muted-foreground"><tr>{r.preview.headers.slice(0, 8).map((h) => <th key={h} className="pr-3 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {r.preview.rows.slice(0, 10).map((row, k) => (
                        <tr key={k} className="border-t border-border/60">{row.slice(0, 8).map((c, ci) => <td key={ci} className="max-w-[160px] truncate py-1 pr-3">{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
