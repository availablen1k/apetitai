import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import StatusPill from '@/components/StatusPill';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate } from '@/lib/format';
import { useNatureJob } from './useNatureJob';

const TONE = { queued: 'review', running: 'running', succeeded: 'ok', failed: 'error', interrupted: 'error' };

// Build state, rebuild and the Python job log. A rebuild replaces the whole database file.
export default function NatureModelPanel({ status }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [reviewer, setReviewer] = useState(() => { const n = getReviewerLabel(); return n === 'Local reviewer' ? '' : n; });
  const [confirm, setConfirm] = useState(false);
  const rebuild = useNatureJob();
  const jobs = useQuery({ queryKey: ['nature', 'jobs'], queryFn: api.natureJobs, refetchInterval: (q) => ((q.state.data || []).some((j) => ['queued', 'running'].includes(j.status)) ? 2000 : false) });
  const s = status;
  const atRisk = s?.counts ? s.counts.saved_runs + s.counts.reviews + s.counts.proposals : 0;
  const start = () => { setReviewerLabel(reviewer); rebuild.submit({ kind: 'rebuild', requested_by: reviewer.trim(), confirm_discard: atRisk > 0 ? confirm : undefined }); };

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      <section className="surface p-5">
        <h2 className="font-heading text-[17px]">{fi ? 'Luontomallin tietokanta' : 'Nature model database'}</h2>
        <dl className="mt-3 space-y-1.5 text-[12px]">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{fi ? 'Tila' : 'State'}</dt><dd><StatusPill tone={s?.state === 'ready' ? 'ok' : 'error'}>{s?.state || '—'}</StatusPill></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{fi ? 'Rakennettu' : 'Built'}</dt><dd>{s?.build ? `${s.build.build_id} · ${shortDate(s.build.built_at_utc)}` : '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{fi ? 'Koko' : 'Size'}</dt><dd>{s?.bytes ? `${nf(s.bytes / 1048576)} MB` : '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Python</dt><dd>{s?.python?.available ? `${s.python.version} · SQLite ${s.python.sqlite}` : s?.python?.error || '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{fi ? 'Tallennetut ajot' : 'Saved runs'}</dt><dd>{s?.counts ? nf(s.counts.saved_runs) : '—'}</dd></div>
          <div className="break-all pt-1 text-[11px] text-muted-foreground">{s?.db_path}</div>
        </dl>
        {s?.message && <p className="mt-2 text-[12px] text-[#9E3B2C]">{s.message}</p>}

        <h3 className="mt-5 text-[13px] font-medium">{fi ? 'Rakenna uudelleen lähdedatasta' : 'Rebuild from the source dataset'}</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{fi ? 'Ajaa nature_model/tools/build_nature_model.py ja tarkistuksen (noin minuutti). Uusi tiedosto korvaa vanhan vasta onnistuneen rakennuksen jälkeen. Kirjoittaa myös analysis/nature-kyselytulosteet uudelleen.' : 'Runs nature_model/tools/build_nature_model.py and the preflight check (about a minute). The new file replaces the old one only after a successful build. Also rewrites the analysis/nature query exports.'}</p>
        {atRisk > 0 && (
          <label className="mt-2 flex items-start gap-2 rounded-xl border border-[#EDDCC0] bg-[#F8EEDF] p-2.5 text-[11.5px] text-[#8A5A1E]">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
            <span><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{fi ? `Uudelleenrakennus poistaa ${s.counts.saved_runs} tallennettua ajoa, ${s.counts.reviews} tarkistusta ja ${s.counts.proposals} ehdotusta. Tilannevedos backups/-kansioon otetaan ensin.` : `Rebuilding drops ${s.counts.saved_runs} saved run(s), ${s.counts.reviews} review(s) and ${s.counts.proposals} proposal(s). A snapshot is written to backups/ first.`}</span>
          </label>
        )}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[11.5px]"><span className="font-medium">{fi ? 'Nimesi' : 'Your name'}</span><input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={80} className="mt-1 block rounded-lg border border-input bg-card px-2.5 py-1.5" /></label>
          <button onClick={start} disabled={!reviewer.trim() || rebuild.busy || (atRisk > 0 && !confirm) || !s?.python?.available} className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12.5px] font-medium text-[#EFF6FC] disabled:opacity-50" data-testid="nature-rebuild">
            {rebuild.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{s?.state === 'ready' ? (fi ? 'Rakenna uudelleen' : 'Rebuild') : (fi ? 'Rakenna' : 'Build')}
          </button>
        </div>
        {rebuild.error && <p className="mt-2 text-[12px] text-[#9E3B2C]">{rebuild.error}</p>}
      </section>

      <section className="surface p-5">
        <h2 className="font-heading text-[17px]">{fi ? 'Python-ajot' : 'Python jobs'}</h2>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{fi ? 'Yksi kerrallaan. Palvelimen uudelleenkäynnistys merkitsee käynnissä olleen ajon keskeytyneeksi.' : 'One at a time. A server restart marks a running job as interrupted.'}</p>
        <ul className="mt-3 space-y-2 text-[11.5px]">
          {(jobs.data || []).map((j) => (
            <li key={j.id} className="rounded-xl border border-border/70 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{j.kind}</span><StatusPill tone={TONE[j.status] || 'new'}>{j.status}{j.status === 'running' ? ` · ${j.phase}` : ''}</StatusPill></div>
              <p className="mt-1 text-muted-foreground">{shortDate(j.created_at)} · {j.requested_by} · {JSON.stringify(j.params)}</p>
              {j.result?.saved_run_id && <p className="mt-1 font-mono">{j.result.saved_run_id}</p>}
              {j.result?.snapshot && <p className="mt-1 break-all">{fi ? 'Tilannevedos' : 'Snapshot'}: {j.result.snapshot}</p>}
              {j.error && <p className="mt-1 text-[#9E3B2C]">{j.error}</p>}
              {j.stderr_tail && j.status !== 'succeeded' && <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">stderr</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-secondary/60 p-2 text-[10.5px]">{j.stderr_tail}</pre></details>}
            </li>
          ))}
          {!jobs.data?.length && <li className="text-muted-foreground">{fi ? 'Ei ajoja.' : 'No jobs.'}</li>}
        </ul>
      </section>
    </div>
  );
}
