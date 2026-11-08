import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import StatusPill from '@/components/StatusPill';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate } from '@/lib/format';

export default function DatasetTable() {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const { data, isLoading, error } = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });
  if (isLoading) return <p className="p-6 text-[13px] text-muted-foreground">{fi ? 'Ladataan…' : 'Loading…'}</p>;
  if (error) return <p className="p-6 text-[13px] text-[#8C3B2E]">{error.message}</p>;
  const batches = data?.batches || [];
  const datasets = (data?.datasets || []).filter((d) => d.record_count > 0);

  return (
    <div className="space-y-3.5">
      <div className="surface overflow-hidden">
        <div className="border-b border-border px-4 py-3 font-heading text-[16px]">{fi ? 'Aineistot ja kattavuus' : 'Datasets and coverage'}</div>
        {datasets.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-secondary/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{fi ? 'Aineisto' : 'Dataset'}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{fi ? 'Rivit' : 'Rows'}</th>
                  <th className="px-3 py-2.5 font-medium">{fi ? 'Vuodet' : 'Years'}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{fi ? 'Tuontierät' : 'Batches'}</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id} className="border-t border-border/60">
                    <td className="px-4 py-2"><div className="font-medium">{d.label}</div><div className="font-mono text-[10.5px] text-muted-foreground">{d.id}</div></td>
                    <td className="px-3 py-2 text-right numeral">{nf(d.record_count)}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">{d.years.length ? `${d.years[0]}–${d.years[d.years.length - 1]}` : '—'}</td>
                    <td className="px-3 py-2 text-right numeral">{nf(d.batches)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-6 text-[13px] text-muted-foreground">{fi ? 'Ei tuotuja aineistoja. Aloita Tiedostot-välilehdeltä.' : 'No datasets imported yet. Start in the Uploads tab.'}</p>
        )}
      </div>

      <div className="surface overflow-hidden">
        <div className="border-b border-border px-4 py-3 font-heading text-[16px]">{fi ? 'Tuontierät' : 'Import batches'}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-secondary/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">{fi ? 'Tiedosto' : 'File'}</th>
                <th className="px-3 py-2.5 font-medium">{fi ? 'Aineisto' : 'Dataset'}</th>
                <th className="px-3 py-2.5 font-medium">{fi ? 'Välilehti / sarakkeet' : 'Worksheet / columns'}</th>
                <th className="px-3 py-2.5 text-right font-medium">{fi ? 'Tiedostossa' : 'In file'}</th>
                <th className="px-3 py-2.5 text-right font-medium">{fi ? 'Tuotu' : 'Imported'}</th>
                <th className="px-3 py-2.5 text-right font-medium">{fi ? 'Jo olemassa' : 'Duplicates'}</th>
                <th className="px-3 py-2.5 text-right font-medium">{fi ? 'Hylätty' : 'Rejected'}</th>
                <th className="px-3 py-2.5 font-medium">{fi ? 'Tila' : 'Status'}</th>
                <th className="px-3 py-2.5 font-medium">SHA-256</th>
                <th className="px-4 py-2.5 font-medium">{fi ? 'Tuotu' : 'Imported at'}</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-border/60">
                  <td className="max-w-[220px] truncate px-4 py-2 font-medium" title={b.filename}>{b.filename}</td>
                  <td className="px-3 py-2 font-mono text-[10.5px] text-muted-foreground">{b.dataset}</td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">{b.sheet_name || '—'}{b.mapping && <details className="mt-1"><summary className="cursor-pointer">{fi ? 'Tallennettu yhdistäminen' : 'Saved mapping'}</summary>{Object.entries(b.mapping).map(([target, source]) => <div key={target} className="whitespace-nowrap font-mono text-[10px]">{String(source)} → {target}</div>)}</details>}</td>
                  <td className="px-3 py-2 text-right numeral">{nf(b.expected_rows)}</td>
                  <td className="px-3 py-2 text-right numeral">{nf(b.imported_rows)}</td>
                  <td className="px-3 py-2 text-right numeral">{nf(b.duplicate_rows)}</td>
                  <td className="px-3 py-2 text-right numeral">{nf(b.rejected_rows)}</td>
                  <td className="px-3 py-2"><StatusPill tone={b.status === 'imported' ? 'ok' : b.status === 'duplicate_upload' ? 'draft' : 'review'} dot={false}>{b.status}</StatusPill></td>
                  <td className="px-3 py-2 font-mono text-[10.5px] text-muted-foreground">{b.sha256.slice(0, 12)}</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">{shortDate(b.imported_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
