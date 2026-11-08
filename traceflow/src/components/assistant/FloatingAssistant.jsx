import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Bot, GitBranch, Loader2, MessageSquarePlus, Sparkles, X } from 'lucide-react';
import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import AssistantAnswer from './AssistantAnswer';
import RootCauseAnswer from './RootCauseAnswer';
import { PAGE_TITLES } from '@/lib/nav';

const validYear = (value) => Number.isInteger(Number(value)) && Number(value) >= 2000 && Number(value) <= 2100 ? Number(value) : null;
const threadKey = (context, year) => context.scope==='workspace' ? 'workspace' : context.issue_id ? `incident:${context.issue_id}` : JSON.stringify({ year, ...context, label: undefined });

export default function FloatingAssistant() {
  const { lang, t } = useI18n(); const fi = lang === 'fi';
  const location = useLocation(); const qc = useQueryClient(); const { toast } = useToast();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.overview() });
  const [open, setOpen] = useState(false);
  const [entity, setEntity] = useState(null);
  const [scope,setScope]=useState('workspace');
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const asking = useRef(false), saving = useRef(false), queued = useRef(null), askRef = useRef(null);
  const inputRef = useRef(null), log = useRef(null), launcher = useRef(null), sequence = useRef(0);
  const params = new URLSearchParams(location.search);
  const year = validYear(scope==='selection'?entity?.year:null) || validYear(params.get('year')) || overview.data?.year || new Date().getFullYear();
  const pageTitle = PAGE_TITLES[location.pathname] ? t(PAGE_TITLES[location.pathname]) : document.querySelector('main h1')?.textContent || (fi ? 'Nykyinen sivu' : 'Current page');
  const contextFor = (selection = entity, requestedScope = scope) => {
    const p = new URLSearchParams(window.location.search);
    if(requestedScope==='workspace')return {page:window.location.pathname,scope:'workspace',label:fi?'Kaikki työtilan tiedot':'All workspace data'};
    const incidentSection = document.querySelector('[data-ai-incidents]');
    const incidents = incidentSection ? JSON.parse(incidentSection.getAttribute('data-ai-incidents')) : undefined;
    if (selection?.page_only) return {page: window.location.pathname, scope:'selection',label: pageTitle, incidents};
    const c = { page: window.location.pathname, scope:'selection', label: pageTitle, incidents, action_id:window.location.pathname==='/actions'?p.get('action')||undefined:undefined,issue_id: p.get('issue') || undefined, run_id: p.get('run') || undefined, contribution_id: p.get('c') || undefined, query_id: p.get('query') || undefined, ...selection };
    delete c.year;
    if (selection?.node_id || selection?.record_id || selection?.finding_key || selection?.run_id) delete c.issue_id;
    if (c.node_id || c.record_id || c.finding_key) { delete c.run_id; delete c.contribution_id; }
    if (c.issue_id || c.record_id || c.finding_key || c.run_id) { delete c.node_id; delete c.flow; delete c.incidents; }
    if(c.issue_id||c.record_id||c.finding_key||c.node_id)delete c.action_id;
    if(c.action_id){delete c.issue_id;delete c.contribution_id;delete c.incidents;}
    if(c.issue_id||c.record_id||c.finding_key||c.node_id||c.action_id){delete c.target_id;delete c.category;}
    return c;
  };
  const context = contextFor();
  const currentLabel = scope==='workspace'?(fi?'Kaikki työtilan tiedot':'All workspace data'):entity?.label || pageTitle;

  useEffect(() => { setEntity(null); if (new URLSearchParams(location.search).get('assist') === '1') setOpen(true); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [turns.length, busy]);
  useEffect(() => {
    const observe = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('[data-assistant-ui]') || !target.closest('main, [data-testid="action-detail"]')) return;
      const ref = target.closest('[data-ai-context]');
      if (ref) {
        try {
          const next = JSON.parse(ref.getAttribute('data-ai-context'));
          const flow = ref.closest('[data-testid="footprint-flow"]');
          if (flow && next.node_id) {
            if (flow.getAttribute('aria-busy') === 'true') return;
            const d = flow.dataset;
            next.flow = { from_year: Number(d.fromYear), to_year: Number(d.toYear), scope: d.scope, land: d.land, q: d.query || '', group: d.group || undefined, source: d.source || undefined, scope2_basis: d.basis || 'market', run_id: d.runId || undefined };
          }
          const incidents = ref.closest('[data-ai-incidents]');
          if (incidents && next.node_id) {
            if (incidents.getAttribute('aria-busy') === 'true') return;
            next.incidents = JSON.parse(incidents.getAttribute('data-ai-incidents'));
          }
          setEntity((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
        } catch { /* invalid UI reference is not sent */ }
      } else if (event.type !== 'pointerover') {
        const el = target.closest('button, a, h2, h3, tr');
        const label = el?.getAttribute('aria-label') || el?.textContent;
        if (label?.trim()) setEntity({ label: label.trim().slice(0, 240) });
        else if (target.closest('input, select, textarea')) setEntity(null);
      }
    };
    const requested = (event) => {
      const action = event.detail || {};
      setOpen(true); setScope('selection');setEntity(action.context || null);
      const c = contextFor(action.context,'selection');
      const y = validYear(action.context?.year) || year;
      if (action.intent === 'root_cause') askRef.current?.({ question: fi ? 'Mikä voi selittää tämän havainnon juurisyyn?' : 'What could explain the root cause of this incident?', context: c, year: y, root: true });
      else if (action.intent !== 'open') askRef.current?.({ question: fi ? 'Selitä tämä valinta ja mitä minun pitäisi tarkistaa.' : 'Explain this selection and what I should check.', context: c, year: y });
    };
    document.addEventListener('pointerover', observe); document.addEventListener('focusin', observe); document.addEventListener('click', observe);
    window.addEventListener('traceflow:assistant', requested);
    return () => { document.removeEventListener('pointerover', observe); document.removeEventListener('focusin', observe); document.removeEventListener('click', observe); window.removeEventListener('traceflow:assistant', requested); };
  }, [location.pathname, location.search, year, lang, scope]);

  const ask = async ({ question, context: chosen, year: chosenYear = year, root = false, retry = null }) => {
    const value = question.trim();
    if (!value || value.length > 1000) return;
    chosen ||= contextFor();
    chosenYear = validYear(chosen.incidents?.year) || chosenYear;
    const task = { question: value, context: chosen, year: chosenYear, root, retry };
    if (asking.current) { queued.current = task; return; }
    asking.current = true; setBusy(true); setInput('');
    const key = threadKey(chosen, chosenYear);
    const turn = retry || { id: ++sequence.current, question: value, context: chosen, contextKey: key, year: chosenYear, lang, root, data: null, savedId: null };
    const previous = retry ? turns.slice(0, turns.findIndex((t) => t.id === turn.id)) : turns;
    const history = previous.filter((t) => (key==='workspace'||t.contextKey === key) && ['completed','degraded'].includes(t.data?.status) && (t.data.answer || t.data.analysis))
      .slice(-3).flatMap((t) => [{ role: 'user', content: t.question }, { role: 'assistant', content: (t.data.answer || `${t.data.analysis.summary}\n${t.data.analysis.suspected_cause}`).slice(0, 4000) }]);
    setTurns((items) => retry ? items.map((t) => t.id === turn.id ? { ...t, data: null } : t) : [...items, turn]);
    try {
      const data = root && turn.context.issue_id ? await api.rootCause(turn.context.issue_id, turn.lang) : await api.ask({ question: value, lang: turn.lang, year: turn.year, history, context: turn.context });
      setTurns((items) => items.map((t) => t.id === turn.id ? { ...t, data } : t));
    } catch (error) {
      setTurns((items) => items.map((t) => t.id === turn.id ? { ...t, data: { status: 'failed', message: error.message, facts: [], citations: [], insufficient: true } } : t));
    } finally {
      asking.current = false; setBusy(false);
      if (queued.current) { const next = queued.current; queued.current = null; setTimeout(() => askRef.current?.(next), 0); }
    }
  };
  askRef.current = ask;

  const save = async (turn) => {
    if (saving.current || turn.savedId || !turn.data?.answer) return;
    saving.current = true; setSavingId(turn.id);
    const d = turn.data, draftFi = turn.lang === 'fi', citations = d.citations || [];
    try {
      const report = await api.createDoc('reports', {
        title: `${draftFi ? 'AI-luonnos' : 'AI draft'}: ${turn.question.slice(0,70)}`, report_type: 'assistant_answer', status: 'draft',
        period: String(turn.year), year: turn.year, language: turn.lang, summary: d.answer.slice(0,400), generated_by: `Gemini · ${d.model}`, model: d.model,
        assistant_status: d.status, insufficient_evidence: !!(d.insufficient || d.status === 'degraded'), citations, context: turn.context,
        sections: [
          { heading: draftFi ? 'Kysymys' : 'Question', body: `${turn.question}\n${draftFi ? 'Raportointivuosi' : 'Reporting year'}: ${turn.year}` },
          { heading: draftFi ? 'Vastaus' : 'Answer', body: d.answer, citations: citations.map((c) => c.id) },
          { heading: draftFi ? 'Viitatut lähteet' : 'Cited evidence', body: citations.map((c) => `[${c.id}] ${c.label}: ${c.value} (${c.source})`).join('\n') },
          ...(d.interpretation ? [{ heading: draftFi ? 'AI-tulkinta' : 'AI interpretation', body: d.interpretation }] : []),
          { heading: draftFi ? 'Tarkistus ja rajoitukset' : 'Review and limitations', body: draftFi ? 'AI:n tuottama luonnos. Ihmisen tarkistus ja hyväksyntä vaaditaan.' : 'AI-generated draft. Human review and approval required.' },
        ],
      });
      setTurns((items) => items.map((t) => t.id === turn.id ? { ...t, savedId: report.id } : t));
      qc.invalidateQueries({queryKey:['reports']}); toast({title: draftFi ? 'Luonnos tallennettu' : 'Draft saved'});
    } catch (e) { toast({title: fi ? 'Tallennus epäonnistui' : 'Could not save draft',description:e.message,variant:'destructive'}); }
    finally { saving.current = false; setSavingId(null); }
  };
  const close = () => { setOpen(false); launcher.current?.focus(); };
  return <div data-assistant-ui="true" className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
    {open && <aside role="region" aria-label={fi ? 'AI-avustaja' : 'AI assistant'} data-testid="floating-assistant" className="mb-3 flex max-h-[calc(100dvh-150px)] w-[min(460px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[#C9DCE8] bg-white shadow-[0_12px_60px_rgba(23,57,78,0.22)]" onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-[#F2F7FA] px-4 py-3"><h2 className="flex items-center gap-2 text-[14px] font-semibold text-[#214A65]"><Bot className="h-4 w-4" />{fi ? 'AI-avustaja' : 'AI assistant'}</h2><div className="flex gap-1"><button title={fi ? 'Uusi keskustelu' : 'New conversation'} aria-label={fi ? 'Uusi keskustelu' : 'New conversation'} disabled={busy || !turns.length} onClick={() => {setTurns([]);setScope('workspace');setEntity(null);}} className="rounded-lg p-2 text-muted-foreground hover:bg-white disabled:opacity-30"><MessageSquarePlus className="h-4 w-4" /></button><button onClick={close} aria-label={fi ? 'Sulje avustaja' : 'Close assistant'} className="rounded-lg p-2 text-muted-foreground hover:bg-white" data-testid="assistant-close"><X className="h-4 w-4" /></button></div></div>
      <div className="flex gap-1 border-b border-border px-4 py-2" role="group" aria-label={fi?'Keskustelun rajaus':'Conversation scope'}>{['workspace','selection'].map(value=><button key={value} type="button" aria-pressed={scope===value} onClick={()=>setScope(value)} data-testid={`assistant-mode-${value}`} className={`rounded-full px-3 py-1.5 text-[11px] ${scope===value?'bg-[#1B4968] text-white':'border border-border hover:bg-muted'}`}>{value==='workspace'?(fi?'Koko työtila':'All workspace'):(fi?'Tämä sivu / valinta':'This page / selection')}</button>)}</div>
      <div className="border-b border-border px-4 py-2 text-[10.5px] text-muted-foreground" data-testid="assistant-context"><span className="font-medium text-[#355B73]">{fi ? 'Nykyinen näkymä' : 'Current context'}:</span> <span className="break-words">{currentLabel}</span> · {year}{scope==='selection' && entity && !entity.page_only && <button onClick={() => setEntity({page_only:true})} className="ml-2 font-medium text-[#2E7099]">{fi ? 'Koko sivu' : 'Whole page'}</button>}</div>
      <div ref={log} className="min-h-[130px] flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4" role="log" aria-label={fi ? 'Keskustelu' : 'Conversation'} data-testid="assistant-conversation">
        {!turns.length && <div className="space-y-3 text-[12px] leading-relaxed"><p>{fi?'Kysy työtilan tiedoista, toimittajista, tiloista, päästöistä, kustannuksista, tavoitteista tai raporteista. Voin myös selittää käsitteitä ja auttaa sovelluksen käytössä. Yritystä koskevat vastaukset perustuvat lähteisiin.':'Ask about any workspace data, suppliers, farms, emissions, costs, targets or reports. I can also explain concepts and help you use the app. Company-specific answers use the underlying evidence.'}</p><div className="flex flex-col items-start gap-2">{(scope==='selection'?[fi?'Selitä tämä valinta ja mitä minun pitäisi tarkistaa.':'Explain this selection and what I should check.']:fi?['Mitä tietoja työtilassa on?','Miksi vuoden 2025 päästöt ovat suuremmat kuin vuonna 2024?','Mitkä toimenpiteet vähentäisivät päästöjä ja mitä ne maksavat?','Mitä raportoinnin hyväksynnästä puuttuu?']:['What data do we have?','Why are 2025 emissions higher than 2024?','Which actions could reduce emissions and what do they cost?','What remains before reporting sign-off?']).map(question=><button key={question} className="rounded-xl border border-border px-3 py-2 text-left text-[#2E7099] hover:bg-muted" onClick={()=>ask({question})} data-testid="assistant-starter">{question}</button>)}</div><Link to="/actions#findings" className="block text-[#2E7099] hover:underline">{fi ? 'Katso löydökset ja seuraavat toimet →' : 'View discoveries and next steps →'}</Link></div>}
        {turns.map((turn) => <article key={turn.id} data-testid="assistant-turn" className="space-y-3"><div className="rounded-xl bg-[#1B4968] px-3 py-2.5 text-[12px] text-white"><p className="mb-1 text-[9.5px] text-[#C6DDEB]">{turn.context.label || turn.context.page} · {turn.year}</p><p>{turn.question}</p></div>{turn.data ? turn.root && turn.data.analysis ? <RootCauseAnswer result={turn.data} /> : <AssistantAnswer turn={turn} busy={busy} savingId={savingId} onSave={save} onAsk={(question) => ask({question,context:turn.context,year:turn.year})} onRetry={() => ask({question:turn.question,context:turn.context,year:turn.year,root:turn.root,retry:turn})} /> : <p role="status" className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{turn.root ? fi ? 'Tutkitaan juurisyytä ja lähteitä…' : 'Investigating the cause and source evidence…' : fi ? 'Tarkistetaan lähdetietoja…' : 'Checking the source evidence…'}</p>}</article>)}
      </div>
      <form onSubmit={(e) => {e.preventDefault();ask({question:input});}} className="border-t border-border p-3"><label htmlFor="floating-assistant-question" className="sr-only">{fi ? 'Kysymyksesi' : 'Your question'}</label><textarea id="floating-assistant-question" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => {if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy)ask({question:input});}}} rows={2} maxLength={1000} disabled={busy} placeholder={fi ? 'Kysy tiedoista tai tehtävästä…' : 'Ask about any data or task…'} data-testid="assistant-question" className="w-full resize-none rounded-xl border border-input bg-white px-3 py-2 text-[12px] disabled:bg-muted" /><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[9.5px] text-muted-foreground">{fi ? 'Ehdotukset vaativat ihmisen tarkistuksen.' : 'Suggestions require human review.'}</span><Button type="submit" size="sm" disabled={busy || !input.trim()} data-testid="assistant-send"><ArrowUp className="h-3.5 w-3.5" /><span className="sr-only">{fi ? 'Lähetä' : 'Send'}</span></Button></div></form>
    </aside>}
    <button ref={launcher} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={fi ? 'Avaa AI-avustaja' : 'Open AI assistant'} data-testid="assistant-launcher" className="ml-auto flex min-h-12 items-center gap-2 rounded-full border border-white/30 bg-[#1B4968] px-4 py-3 text-[12px] font-semibold text-white shadow-lg hover:bg-[#235B7E]"><Sparkles className="h-4 w-4" />{fi ? 'Kysy AI:lta' : 'Ask AI'}{context.issue_id && <GitBranch className="h-3.5 w-3.5" />}</button>
  </div>;
}
