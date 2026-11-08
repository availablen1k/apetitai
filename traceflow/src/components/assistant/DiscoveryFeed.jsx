import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Loader2, RefreshCw } from 'lucide-react';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import RootCauseButton from './RootCauseButton';
import { useI18n } from '@/lib/i18n';

export default function DiscoveryFeed({ year }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const qc = useQueryClient();
  const feed = useQuery({ queryKey: ['discovery', year, lang], queryFn: () => api.discovery(year, lang), refetchInterval: 3000 });
  const [filter, setFilter] = useState('open');
  const [limit, setLimit] = useState(6);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState(null);
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const requestId = useRef(null);
  const data = feed.data;
  const pending = starting || !!data?.pending;
  const findings = data?.findings || [];
  const visible = findings.filter((f) => filter === 'all' || f.state === filter);
  const format = (n) => new Intl.NumberFormat(fi ? 'fi-FI' : 'en-GB', { maximumFractionDigits: 2 }).format(n);
  const start = async () => {
    setStarting(true); setError('');
    requestId.current ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { await api.startDiscovery(year, requestId.current); requestId.current = null; await qc.invalidateQueries({ queryKey: ['discovery', year] }); }
    catch (e) { setError(e.message); }
    finally { setStarting(false); }
  };
  const decide = async (event) => {
    event.preventDefault();
    if (saving || !reviewer.trim()) return;
    setSaving(true); setError('');
    try {
      await api.decideFinding(decision.key, { year: decision.year, decision: decision.action, reviewer_label: reviewer.trim(), note });
      setReviewerLabel(reviewer.trim());
      setDecision(null);
      await qc.invalidateQueries({ queryKey: ['discovery'] });
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  const chooseDecision = (finding, action) => {
    setDecision({ key: finding.key, year, action }); setNote(''); setError('');
    const previous = getReviewerLabel(); setReviewer(previous === 'Local reviewer' ? '' : previous);
  };

  return (
    <section className="surface mb-6 overflow-hidden" data-testid="discovery-feed" aria-labelledby="discovery-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 id="discovery-title" className="font-heading text-[21px]">{fi ? 'Löydökset ja seuraavat askeleet' : 'Findings and next steps'}</h2>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">{fi ? 'Mitä datasta löytyi, mitä kannattaa tehdä ja miten se liittyy päästöihin.' : 'What your data shows, what to do next and how it relates to your footprint.'}</p>
        </div>
        <Button variant="outline" onClick={start} disabled={pending || !data?.calculation_id} className="gap-2" data-testid="discovery-run">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {pending ? fi ? 'Tietoja tarkastellaan…' : 'Reviewing data…' : fi ? 'Etsi seuraavat askeleet' : 'Find next steps'}
        </Button>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        {(error || feed.error) && <p role="alert" className="text-[12.5px] text-[#8C3B2E]">{error || feed.error.message}</p>}
        {feed.isLoading && <p className="text-[13px] text-muted-foreground">{fi ? 'Ladataan…' : 'Loading…'}</p>}
        {data?.stale && <p role="status" className="text-[12px] text-[#7A5A2E]">{fi ? 'Uudempi laskelma on saatavilla. Päivitä löydökset ennen käyttöä.' : 'A newer calculation is available. Refresh these findings before using them.'}</p>}
        {data?.last_failure && <p role="status" className="text-[12px] text-[#8C3B2E]">{fi ? 'Viimeisin tarkastelu epäonnistui. Aiemmat löydökset säilyvät.' : 'The latest review did not finish. Earlier findings are retained.'} {data.last_failure.error}</p>}
        {data && !data.calculation_id && <p className="text-[13px] leading-relaxed text-muted-foreground">{fi ? 'Tallenna ensin tämän vuoden päästölaskelma.' : 'Save an emissions calculation for this year first.'} <Link className="font-medium text-[#2E7099] hover:underline" to={`/sustainability?year=${year}`}>{fi ? 'Avaa laskenta →' : 'Open calculations →'}</Link></p>}
        {data?.calculation_id && !data.run && !pending && <p className="text-[13px] leading-relaxed text-muted-foreground">{fi ? 'Etsi löydöksiä tallennetusta laskelmasta. AI selkeyttää tekstiä, jos se on käytössä; vaikutusluvut tulevat laskennasta.' : 'Find opportunities in your saved calculation. AI simplifies the wording when available; effect figures come from calculations.'}</p>}
        {pending && <p role="status" className="text-[12px] text-muted-foreground">{fi ? 'Voit jatkaa muuta työtä. Löydökset päivittyvät, kun tarkastelu valmistuu.' : 'You can keep working. Findings will update when the review finishes.'}</p>}
        {!!findings.length && <div className="flex flex-wrap gap-2" role="group" aria-label={fi ? 'Löydösten tila' : 'Finding status'}>
          {[['open', fi ? 'Käsiteltävät' : 'To do'], ['done', fi ? 'Käsitellyt' : 'Handled'], ['dismissed', fi ? 'Ohitetut' : 'Dismissed'], ['all', fi ? 'Kaikki' : 'All']].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setLimit(6); }} className={`rounded-full border px-3 py-1.5 text-[12px] ${filter === id ? 'border-[#1B4968] bg-[#1B4968] text-white' : 'border-border hover:bg-muted'}`} data-testid={`discovery-filter-${id}`}>{label} ({id === 'all' ? findings.length : findings.filter((f) => f.state === id).length})</button>)}
        </div>}
        {data?.run && !visible.length && <p className="text-[13px] text-muted-foreground">{findings.length ? fi ? 'Ei löydöksiä tässä tilassa.' : 'No findings with this status.' : fi ? 'Näillä lähtötiedoilla ei löytynyt ehdotuksia. Tämä ei vahvista datan virheettömyyttä.' : 'No suggestions were found with these inputs. This does not establish that the data is error-free.'}</p>}
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.slice(0, limit).map((finding) => {
            const effect = finding.effect;
            const scenario = ['what_if', 'recomputed'].includes(effect.basis);
            return <article data-ai-context={JSON.stringify({finding_key: finding.key, year, label: finding.found.slice(0,240)})} key={finding.key} className="flex min-w-0 flex-col rounded-xl border border-border p-4 sm:p-5" data-testid="discovery-finding">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{fi ? 'Mitä löytyi' : 'What we found'}</p>
              <p className="mt-2 break-words text-[14px] font-medium leading-relaxed">{finding.found}</p>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{fi ? 'Mitä ehdotamme' : 'What we suggest'}</p>
              <p className="mt-2 break-words text-[12.5px] leading-relaxed">{finding.suggest}</p>
              <p className="mt-2 text-[11.5px] text-muted-foreground">{fi ? 'Kenen kanssa' : 'Discuss with'}: {finding.who}</p>
              <div className="my-4 rounded-xl bg-[#F0F5F8] p-3.5" data-testid="discovery-effect">
                <p className="text-[11px] text-muted-foreground">{fi ? 'Vaikutus päästöihin' : 'Effect on the footprint'} · {effect.note?.[lang]}</p>
                <p className="mt-1 text-[20px] font-semibold tabular-nums">{effect.tco2e === null ? fi ? 'Ei vielä laskettu' : 'Not yet calculated' : `${scenario && effect.tco2e > 0 ? '+' : ''}${format(effect.tco2e)} tCO₂e`}</p>
                {scenario && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{fi ? 'Laskennallinen vaihtoehto. Toimenpiteitä ei ole toteutettu; vaikutuksia ei voi laskea suoraan yhteen.' : 'Calculated scenario. No action has been applied; effects cannot be added together.'}</p>}
                {['exposure', 'driver_size'].includes(effect.basis) && <p className="mt-1 text-[11px] text-muted-foreground">{fi ? 'Päästöjen määrä, ei vähennysarvio.' : 'Amount of emissions, not an estimate of savings.'}</p>}
                {effect.catalogue_tco2e != null && <p className="mt-1 text-[11px]">{fi ? 'Luettelon suunnitteluarvio vuodelle 2030' : 'Catalogue design estimate for 2030'}: {format(effect.catalogue_tco2e)} tCO₂e</p>}
                {effect.ceiling_tco2e != null && <p className="mt-1 text-[11px]">{fi ? 'Vaikutettavissa olevat päästöt' : 'Addressable emissions'}: {format(effect.ceiling_tco2e)} tCO₂e</p>}
              </div>
              <details className="mb-4 text-[11.5px]">
                <summary className="cursor-pointer font-medium text-muted-foreground">{fi ? 'Lähteet ja laskennan peruste' : 'Sources and calculation basis'}</summary>
                <ul className="mt-2 space-y-2">{finding.evidence.map((e) => <li key={e.id} className="break-words"><p>{e.label}: {e.value}</p>{e.link && <Link to={e.link} className="text-[#2E7099] hover:underline">{fi ? 'Avaa lähde →' : 'Open source →'}</Link>}</li>)}</ul>
              </details>
              <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-border pt-3 text-[12px]">
                {finding.facts?.issue_id && <RootCauseButton issue={{id:finding.facts.issue_id,year}} />}
                <Link to={finding.facts?.lever_id?`/actions?year=${year}&action=${encodeURIComponent(finding.facts.lever_id)}${data?.run?.calc_run_id?`&run=${data.run.calc_run_id}`:''}`:finding.action.to} className="inline-flex items-center gap-1 font-medium text-[#2E7099] hover:underline" data-testid="discovery-action">{finding.facts?.lever_id?(fi?'Arvioi toimenpide ja rahavaikutus':'Assess the measure and finances'):finding.action.label[lang]}<ArrowRight className="h-3.5 w-3.5" /></Link>
                {finding.state === 'open' ? <>
                  <button className="inline-flex items-center gap-1 hover:underline" onClick={() => chooseDecision(finding, 'done')} data-testid="discovery-done"><Check className="h-3.5 w-3.5" />{fi ? 'Merkitse käsitellyksi' : 'Mark handled'}</button>
                  <button className="text-muted-foreground hover:underline" onClick={() => chooseDecision(finding, 'dismissed')}>{fi ? 'Ohita' : 'Dismiss'}</button>
                </> : <button onClick={() => chooseDecision(finding, 'reopened')} className="hover:underline">{fi ? 'Avaa uudelleen' : 'Reopen'}</button>}
              </div>
              {finding.decided_by && <p className="mt-2 break-words text-[11px] text-muted-foreground">{finding.decided_by}{finding.note ? ` · ${finding.note}` : ''}</p>}
            </article>;
          })}
        </div>
        {visible.length > limit && <Button variant="outline" onClick={() => setLimit(limit + 6)}>{fi ? 'Näytä lisää' : 'Show more'} ({visible.length - limit})</Button>}
        {data?.run && <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">{fi ? 'Tarkastelun tiedot ja rajaukset' : 'Review details and limitations'}</summary><p className="mt-2">{data.run.mode === 'local' ? fi ? 'Paikallinen laskenta; AI:ta ei käytetty.' : 'Local calculations; AI was not used.' : fi ? 'AI on selkeyttänyt tekstiä. Numerot tarkistetaan laskennan arvoja vasten.' : 'AI helped simplify the wording. Numeric values are checked against the calculated values.'}</p><p className="mt-1 break-all">{data.run.calc_run_id}</p>{data.run.notes.map((n, i) => <p key={i} className="mt-1 break-words">{n}</p>)}</details>}
      </div>
      <Dialog open={!!decision} onOpenChange={(open) => { if (!open && !saving) setDecision(null); }}>
        <DialogContent className="max-w-[min(480px,calc(100vw-32px))]">
          <DialogHeader><DialogTitle>{fi ? 'Kirjaa käsittelypäätös' : 'Record your decision'}</DialogTitle><DialogDescription>{fi ? 'Tämä päivittää löydöksen tilan. Datan korjaukset hyväksytään Poikkeamat-välilehdellä ja päästöt lasketaan uudelleen erikseen.' : 'This updates the finding status. Data corrections need a separate decision in Incidents and a new calculation.'}</DialogDescription></DialogHeader>
          <form onSubmit={decide} className="space-y-4">
            <label className="block text-[12px]">{fi ? 'Nimesi' : 'Your name'}<input required maxLength={80} value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="mt-1 block w-full rounded-lg border border-input bg-card p-2.5" data-testid="discovery-reviewer" /></label>
            <label className="block text-[12px]">{fi ? 'Muistiinpano (valinnainen)' : 'Note (optional)'}<textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-full rounded-lg border border-input bg-card p-2.5" /></label>
            {error && <p role="alert" className="text-[12px] text-[#8C3B2E]">{error}</p>}
            <Button type="submit" disabled={saving || !reviewer.trim()} data-testid="discovery-confirm">{saving ? fi ? 'Tallennetaan…' : 'Saving…' : fi ? 'Tallenna päätös' : 'Save decision'}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
