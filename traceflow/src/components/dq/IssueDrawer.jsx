import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, Loader2, Bot, Calculator } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { openAssistant } from '@/lib/assistantContext';
import DecisionBlock from '@/components/decisions/DecisionBlock';
import RootCauseButton from '@/components/assistant/RootCauseButton';
import StatusPill from '@/components/StatusPill';
import EvidencePanel from '@/components/dq/EvidencePanel';
import { Explainer } from '@/components/Term';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { issueLabel, nf, shortDate } from '@/lib/format';
import { datasetName, fieldName, priorityName, reviewGuidance, reviewStatus } from '@/lib/reviewLanguage';
import { useToast } from '@/components/ui/use-toast';

function KV({ k, v, mono = false }) {
  return <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-b border-border/50 py-1.5 text-[12px] last:border-0"><span className="text-muted-foreground">{k}</span><span className={`max-w-full break-all text-right ${mono ? 'font-mono text-[10.5px]' : ''}`}>{v ?? '—'}</span></div>;
}

const parseEntry = (value) => {
  try { const entry = JSON.parse(value); return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null; }
  catch { return null; }
};

export function ReviewDialog({ issue, open, onOpenChange, decision, proposal, onDone }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const [reviewer, setReviewer] = useState(() => { const name = getReviewerLabel(); return name === 'Local reviewer' ? '' : name; });
  const [reason, setReason] = useState('');
  const [value, setValue] = useState(proposal?.value ?? issue?.candidate_value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!issue) return null;
  const requesting = decision === 'request_evidence';
  const approving = decision === 'approve';
  const agentConcern = issue.rule_id?.startsWith('agent.');
  const needsValue = approving && (issue.action === 'set_value' || issue.action === 'add_record');
  const entry = issue.action === 'add_record' ? parseEntry(value) : null;
  const flatEntry = entry && Object.values(entry).every((item) => item === null || typeof item !== 'object');
  const title = requesting ? (fi ? 'Mitä lisätietoa tarvitset?' : 'What information do you need?')
    : !approving ? (fi ? 'Säilytä tiedot ennallaan' : 'Keep data unchanged')
      : issue.action === 'add_record' ? (fi ? 'Lisää varmistettu merkintä' : 'Add a confirmed entry')
        : issue.action === 'exclude_record' ? (fi ? 'Vahvista merkinnän poisjättäminen' : 'Confirm leaving this entry out')
          : issue.action === 'acknowledge' ? (fi ? 'Merkitse tarkistetuksi' : 'Mark as checked')
            : (fi ? 'Tallenna varmistettu korjaus' : 'Save a confirmed correction');
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = { decision, reviewer_label: reviewer, reason: reason || undefined, expected_revision: issue.revision };
      if (needsValue) body.approved_value = String(value);
      if (proposal?.investigation_id) Object.assign(body, { proposed_by: 'ai_investigation', investigation_id: proposal.investigation_id });
      const result = requesting ? await api.requestIssueEvidence(issue.id, { reviewer_label: reviewer, reason, expected_revision: issue.revision }) : await api.reviewIssue(issue.id, body);
      setReviewerLabel(reviewer);
      toast({ title: requesting ? (fi ? 'Lisätietopyyntö kirjattu' : 'Information request recorded') : (fi ? 'Päätös tallennettu' : 'Decision saved'), description: result.recalculation_required ? (fi ? 'Laske päästöt uudelleen ja luo uusi raportti, jotta muutos tulee mukaan.' : 'Calculate emissions again and create a new report to include the change.') : undefined });
      onDone?.();
      onOpenChange(false);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto"><DialogHeader>
    <DialogTitle>{title}</DialogTitle>
    <DialogDescription>{requesting
      ? fi ? 'Kirjaa, mitä asiakirjaa tai vahvistusta tarvitset. Ota itse yhteyttä toimittajaan tai kollegaan; sovellus ei lähetä viestiä. Kohta jää odottamaan tarkistusta.' : 'Record the document or confirmation you need. Contact the supplier or colleague yourself; the app does not send a message. This item stays open.'
      : approving ? fi ? 'Varmista tiedot alkuperäisestä asiakirjasta ennen tallennusta. Alkuperäiset tiedot säilyvät, ja päätös tallennetaan nimelläsi.' : 'Check the information against the original document before saving. Original information is kept, and the decision is recorded with your name.'
        : fi ? 'Ehdotettua muutosta ei tehdä. Päätöksesi ja nimesi tallennetaan, ja tämä tarkistus suljetaan.' : 'The suggested change will not be made. Your decision and name are recorded, and this review item is closed.'}</DialogDescription>
  </DialogHeader>
    <div className="space-y-4 text-[12.5px]">
      {needsValue && issue.action === 'set_value' && <label className="block"><span className="font-medium">{fi ? 'Varmistettu arvo' : 'Confirmed value'} · {fieldName(issue.field, lang)}{issue.candidate_unit ? ` (${issue.candidate_unit})` : ''}</span><input value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 block w-full rounded-lg border border-input bg-card px-3 py-2.5" data-testid="approved-value" /><span className="mt-1 block text-[11.5px] text-muted-foreground">{fi ? 'Ehdotus on täytetty valmiiksi, jos se on saatavilla. Muuta arvo tarvittaessa lähdeasiakirjan mukaiseksi.' : 'A suggestion is prefilled when available. Change it to match the source document if needed.'}</span></label>}
      {needsValue && issue.action === 'add_record' && (flatEntry ? <fieldset className="space-y-2.5"><legend className="mb-2 font-medium">{fi ? 'Varmista lisättävät tiedot' : 'Confirm the information to add'}</legend>{Object.entries(entry).map(([key, item]) => <label key={key} className="block"><span className="text-[12px]">{fieldName(key, lang)}</span><input value={String(item ?? '')} onChange={(event) => setValue(JSON.stringify({ ...entry, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2" data-entry-field={key} /></label>)}</fieldset>
        : <details><summary className="cursor-pointer">{fi ? 'Merkinnän lisätiedot (asiantuntijalle)' : 'Entry details (for a specialist)'}</summary><textarea value={value} onChange={(event) => setValue(event.target.value)} rows={5} aria-label={fi ? 'Lisättävä merkintä JSON-muodossa' : 'Entry to add as JSON'} className="mt-2 w-full rounded-lg border border-input bg-card p-3 font-mono text-[11px]" /></details>)}
      {approving && issue.action === 'exclude_record' && <p className="rounded-xl bg-secondary/50 p-3 leading-relaxed">{fi ? 'Tämä merkintä jätetään pois tulevasta laskelmasta. Varmista, että kyse on kaksoiskappaleesta.' : 'This entry will be left out when you calculate again. Confirm that it is a duplicate.'}</p>}
      {proposal?.investigation_id && <p className="text-[12px] text-[#8A5A1E]">{fi ? 'AI:n ehdotus vaatii tarkistuksen alkuperäistä asiakirjaa vasten.' : 'The AI suggestion needs checking against the original document.'}</p>}
      <label className="block"><span className="font-medium">{fi ? 'Nimesi' : 'Your name'}</span><input value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5" data-testid="reviewer-label" /></label>
      <label className="block"><span className="font-medium">{requesting ? fi ? 'Tarvittava lisätieto (pakollinen)' : 'Information needed (required)' : fi ? 'Miten tarkistit tiedon?' : 'How did you check this?'}{!requesting && (agentConcern && approving ? fi ? ' (pakollinen)' : ' (required)' : fi ? ' (valinnainen)' : ' (optional)')}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} placeholder={fi ? 'Esimerkiksi asiakirjan viite ja mitä siitä varmistit.' : 'For example, the document reference and what you confirmed.'} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5" data-testid="review-reason" /></label>
      {error && <p role="alert" className="rounded-lg bg-[#F5E4E1] p-3 text-[12px] text-[#8C3B2E]">{error}</p>}
    </div>
    <DialogFooter><button onClick={() => onOpenChange(false)} className="rounded-full border border-border px-4 py-2 text-[12px]">{fi ? 'Peruuta' : 'Cancel'}</button><button onClick={submit} disabled={busy || !reviewer.trim() || (needsValue && !String(value).trim()) || (needsValue && issue.action === 'add_record' && !entry) || ((requesting || agentConcern && approving) && reason.trim().length < 5)} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50" data-testid="confirm-review">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{requesting ? fi ? 'Tallenna lisätietopyyntö' : 'Save information request' : approving ? fi ? 'Vahvista päätös' : 'Confirm decision' : fi ? 'Säilytä tiedot ennallaan' : 'Keep data unchanged'}</button></DialogFooter>
  </DialogContent></Dialog>;
}

function Investigation({ inv, fi, onUseProposal, canUse }) {
  const result = inv.result;
  const impact = result?.calculated_impact;
  return <div className="rounded-xl border border-[#EDDCC0] bg-[#FBF6EE] p-3 text-[12px]" data-testid="investigation">
    <p className="flex items-center gap-2 font-medium text-[#8A5A1E]"><Bot className="h-4 w-4" />{fi ? 'AI:n selitys · tarkistettava' : 'AI explanation · needs checking'}</p>
    {inv.error && <p className="mt-2 text-[#8C3B2E]">{inv.error}</p>}
    {result && <div className="mt-3 space-y-2 leading-relaxed"><p>{result.summary}</p><KV k={fi ? 'Tarkista seuraavaksi' : 'Check next'} v={result.next_human_action} />{result.proposed_value !== null && <KV k={fi ? 'Vahvistamaton ehdotus' : 'Unconfirmed suggestion'} v={`${result.proposed_value} ${result.proposed_unit || ''}`} />}{impact && Number.isFinite(impact.value) && <KV k={fi ? 'Arvioitu vaikutus, jos muutos vahvistetaan' : 'Estimated effect if the change is confirmed'} v={`${nf(impact.value, 2)} tCO₂e`} />}{result.missing_evidence?.length > 0 && <p>{fi ? 'Tarvittava lisätieto' : 'Information still needed'}: {result.missing_evidence.join('; ')}</p>}
      {result.validation_notes?.length > 0 && <p className="text-[#8C3B2E]">{result.validation_notes.join(' ')}</p>}
      {canUse && result.proposed_value !== null && <button onClick={() => onUseProposal({ value: result.proposed_value, investigation_id: inv.id })} className="rounded-full border border-[#EDDCC0] bg-white px-3 py-2 text-[12px] font-medium">{fi ? 'Tarkista ehdotus ennen vahvistusta' : 'Review the suggestion before confirming'}</button>}
    </div>}
    <details className="mt-3 text-[11px] text-muted-foreground"><summary className="cursor-pointer">{fi ? 'AI-tarkistuksen lisätiedot' : 'AI check details'}</summary><p className="mt-2 break-all">{inv.status} · {inv.model} · {shortDate(inv.started_at || inv.finished_at)}</p>{result && <><p>{result.status} · {result.confidence}</p><p className="break-all">{(result.evidence_ids || []).join(', ')}</p><p>{impact?.basis}</p></>}<p className="break-all">{(inv.tool_calls || []).map((call) => call.name).join(', ')}</p></details>
  </div>;
}

export default function IssueDrawer({ issueId, onClose }) {
  const { t, lang } = useI18n();
  const fi = lang === 'fi';
  const qc = useQueryClient();
  const { toast } = useToast();
  const [review, setReview] = useState(null);
  const [whatIf, setWhatIf] = useState(null);
  useEffect(() => { setReview(null); setWhatIf(null); }, [issueId]);
  const query = useQuery({ queryKey: ['issue', issueId], queryFn: () => api.issue(issueId), enabled: !!issueId });
  const data = query.data;
  const issue = data?.issue;
  const isOpen = issue?.status === 'open';
  const guidance = issue ? reviewGuidance(issue, lang) : null;
  const refresh = () => {
    for (const queryKey of [['issue', issueId], ['dq-issues'], ['dq-stats'], ['overview'], ['data-reviews'], ['data-review']]) qc.invalidateQueries({ queryKey });
  };
  const runWhatIf = async () => {
    try { setWhatIf({ loading: true }); setWhatIf(await api.whatIf(issueId, String(issue.candidate_value ?? ''))); }
    catch (error) { setWhatIf({ error: error.message }); }
  };
  const payload = data?.record?.payload || {};
  const preferred = [issue?.field, 'unit', 'uom', 'year', 'month', 'doc_no', 'shipment_id', 'supplier_id', 'material_id', 'mode', 'quantity', 'value', 't', 'km'];
  const fields = [...new Set([...preferred, ...Object.keys(payload)])].filter((key) => key && key !== '_document' && key in payload).slice(0, 10);
  return <Sheet open={!!issueId} onOpenChange={(open) => !open && onClose()}><SheetContent className="w-full overflow-y-auto sm:max-w-xl">
    <SheetHeader><SheetTitle className="pr-4 font-heading text-[21px]">{issue ? issueLabel(issue.issue_type, lang) : fi ? 'Tarkista tieto' : 'Check this information'}</SheetTitle><SheetDescription>{issue ? `${datasetName(issue.table_name, lang)}${issue.year ? ` · ${issue.year}` : ''}` : fi ? 'Haetaan alkuperäisiä tietoja.' : 'Loading the original information.'}</SheetDescription></SheetHeader>
    {!data ? <p role="status" className="py-4 text-[13px] text-muted-foreground">{query.error ? query.error.message : t('common.loading')}</p>
      : <div className="mt-5 space-y-6" data-testid="guided-review" data-ai-context={JSON.stringify({issue_id:issue.id,year:issue.year,label:issueLabel(issue.issue_type,lang)})}>
        <div className="flex flex-wrap gap-2"><StatusPill tone={issue.criticality || issue.severity}>{priorityName(issue.criticality || issue.severity, lang)}</StatusPill><StatusPill tone={isOpen ? 'review' : 'draft'} dot={false}>{reviewStatus(issue, lang)}</StatusPill></div>
        <RootCauseButton issue={issue} onBeforeOpen={onClose} />
        <section><h3 className="text-[14px] font-semibold">{fi ? '1. Mikä tarvitsee tarkistuksen?' : '1. What needs checking?'}</h3><p className="mt-2 text-[13px] leading-relaxed">{guidance.why}</p><p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{guidance.next}</p>
          <details className="mt-3 text-[12px]"><summary className="cursor-pointer font-medium">{fi ? 'Miksi tämä tieto nostettiin tarkistukseen?' : 'Why was this flagged?'}</summary><p className="mt-2 whitespace-pre-line break-words leading-relaxed text-muted-foreground">{fi ? issue.explanation : issue.explanation_en || issue.explanation}</p></details>
          <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <div className="rounded-xl border border-border p-3"><p className="text-[11px] font-medium text-muted-foreground">{fi ? 'Kirjattu tieto' : 'Recorded information'}</p><p className="mt-1 break-all text-[14px] font-medium">{issue.observed_value ?? '—'}</p></div>
            <div className="rounded-xl border border-border p-3"><p className="text-[11px] font-medium text-muted-foreground">{fi ? 'Mahdollinen muutos · vahvistamaton' : 'Possible change · unconfirmed'}</p><p className="mt-1 break-words text-[12px]">{issue.action === 'add_record' ? fi ? 'Lisää puuttuvat tiedot' : 'Add missing information' : issue.action === 'exclude_record' ? fi ? 'Jätä mahdollinen kaksoiskappale pois' : 'Leave out a possible duplicate' : issue.action === 'acknowledge' ? fi ? 'Tarkista, muutosta ei ehdoteta' : 'Check the information; no replacement is suggested' : issue.candidate_value ?? (fi ? 'Oikea arvo pitää varmistaa lähteestä.' : 'The correct value needs checking against the source.')}</p></div>
          </div>
        </section>

        <DecisionBlock title={fi?'Mikä muuttuisi, jos korjaus hyväksytään?':'What changes if this correction is approved?'}>
          <p className="mb-3 text-muted-foreground">{fi?'Vaikutus koskee raportoitua inventaariota. Toiminnan fyysistä päästövähennystä, rahavaikutusta tai tavoitehyvitystä ei ole todennettu.':'This affects the reported inventory. Physical emissions savings, financial effects and eligible target contributions are not verified by a data correction.'}</p>
          {issue.action !== 'acknowledge' && issue.year && issue.candidate_value !== null && <div className="text-[12px]"><button onClick={runWhatIf} disabled={whatIf?.loading} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-3 py-2"><Calculator className="h-3.5 w-3.5" />{fi ? 'Miten ehdotus muuttaisi raporttia?' : 'How would the suggestion change the report?'}</button>{whatIf?.loading && <p className="mt-2">{t('common.loading')}</p>}{whatIf?.basis && <p className="mt-2">{fi ? 'Arvioitu muutos, jos ehdotus vahvistetaan' : 'Estimated change if the suggestion is confirmed'}: {whatIf.value === null ? '—' : `${whatIf.value > 0 ? '+' : ''}${nf(whatIf.value, 2)} tCO₂e`} <Explainer concept="tco2e" /></p>}{whatIf?.error && <p role="alert" className="mt-2 text-[#8C3B2E]">{whatIf.error}</p>}</div>}
          <p className="mt-2 text-[11px] text-muted-foreground">{data.record?(fi?'Alkuperäinen lähderivi on saatavilla. Tarkista asiakirjan yksikkö ja ajanjakso.':'The original source entry is available. Check its unit and reporting period.'):(fi?'Alkuperäinen merkintä puuttuu. Pyydä näyttö ennen korjauksen vahvistamista.':'The original entry is missing. Request evidence before confirming a replacement.')}</p>
        </DecisionBlock>
        <section><h3 className="text-[14px] font-semibold">{fi ? '2. Tarkista alkuperäiset tiedot' : '2. Check the original information'}</h3>
          {data.record ? <details className="mt-3 rounded-xl border border-border" data-testid="original-entry"><summary className="cursor-pointer break-words px-3 py-3 text-[12px] font-medium">{fi ? 'Näytä kirjattu merkintä' : 'View the recorded entry'}<span className="mt-1 block text-[11px] font-normal text-muted-foreground">{data.record.source_file} · {fi ? 'rivi' : 'line'} {data.record.source_row}</span></summary><div className="border-t border-border px-3 py-2">{fields.map((key) => <KV key={key} k={fieldName(key, lang)} v={String(payload[key] ?? '—')} />)}</div></details>
            : <p className="mt-2 text-[12px] text-muted-foreground">{fi ? 'Tälle puuttuvalle merkinnälle ei ole alkuperäistä riviä. Varmista tarvittavat tiedot asiakirjoista.' : 'There is no original entry for this missing item. Confirm the information using supporting documents.'}</p>}
          <p className="mb-2 mt-4 text-[12px] font-medium">{fi ? 'Asiakirjat tueksi' : 'Supporting documents'}</p><EvidencePanel entityType="dq_issue" entityId={issue.id} issueId={issue.id} compact />
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{fi ? 'Esimerkiksi lasku, toimitusasiakirja tai toimittajan päästöilmoitus. Voit liittää asiakirjan tarkistuksen tueksi.' : 'For example, an invoice, delivery note or supplier footprint declaration. Attach a document to support the review.'}</p>
        </section>

        <section><h3 className="mb-3 text-[14px] font-semibold">{fi ? '3. Päätä, mitä tehdään' : '3. Choose what to do'}</h3>
          {isOpen ? <div className="flex flex-wrap gap-2">
            <button onClick={() => setReview({ decision: 'approve' })} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground" data-testid="approve"><Check className="h-3.5 w-3.5" />{issue.action === 'exclude_record' ? fi ? 'Vahvista kaksoiskappale' : 'Confirm a duplicate' : issue.action === 'add_record' ? fi ? 'Lisää varmistetut tiedot' : 'Add confirmed information' : issue.action === 'acknowledge' ? fi ? 'Merkitse tarkistetuksi' : 'Mark as checked' : fi ? 'Syötä varmistettu korjaus' : 'Enter a confirmed correction'}</button>
            <button onClick={() => setReview({ decision: 'reject' })} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-border px-3 py-2 text-[12px]" data-testid="reject"><X className="h-3.5 w-3.5" />{fi ? 'Säilytä tiedot ennallaan' : 'Keep data unchanged'}</button>
            <button onClick={() => setReview({ decision: 'request_evidence' })} className="min-h-10 rounded-full border border-border px-3 py-2 text-[12px]" data-testid="request-evidence">{fi ? 'Pyydä lisätietoa' : 'Ask for information'}</button>
          </div> : <div className="rounded-xl bg-secondary/40 p-3 text-[12px] leading-relaxed"><p>{fi ? 'Tämä kohta on käsitelty. Päätös säilyy tarkistushistoriassa.' : 'This item has been reviewed. The decision stays in the review history.'}</p>{data.correction && <p className="mt-1 text-muted-foreground">{data.correction.reviewer_label} · {shortDate(data.correction.decided_at)}</p>}{data.correction?.status === 'approved' && issue.action !== 'acknowledge' && <><p className="mt-2">{fi ? 'Laske päästöt uudelleen, jotta vahvistettu muutos tulee mukaan. Luo sen jälkeen uusi raportti.' : 'Calculate emissions again to include the confirmed change. Then create a new report.'}</p><Link to="/sustainability" className="mt-2 inline-block font-medium text-[#2E7099] hover:underline">{fi ? 'Avaa päästölaskenta →' : 'Open emissions calculations →'}</Link></>}</div>}
        </section>

        <details className="rounded-xl border border-border px-3 py-3"><summary className="cursor-pointer text-[12px] font-medium">{fi ? 'Apua tulkintaan ja vaikutuksen arviointiin' : 'Help understanding this and its possible effect'}</summary>
          <div className="mt-3 space-y-3">
            <button onClick={() => { onClose(); openAssistant({issue_id: issue.id, year: issue.year, label: issueLabel(issue.issue_type, lang)}); }} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-3 py-2 text-[12px]" data-testid="investigate"><Bot className="h-3.5 w-3.5" />{fi ? 'Pyydä AI:lta selitys' : 'Ask AI to explain'}</button>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">{fi ? 'AI voi lukea liitettyjä asiakirjoja selitystä varten. Se ei vahvista muutoksia puolestasi.' : 'AI may read attached documents to help explain the item. You still decide whether to confirm a change.'}</p>

            {(data.investigations || []).map((inv) => <Investigation key={inv.id} inv={inv} fi={fi} canUse={isOpen && ['set_value', 'add_record'].includes(issue.action)} onUseProposal={(proposal) => setReview({ decision: 'approve', proposal })} />)}
          </div>
        </details>

        <details className="border-t border-border pt-4 text-[12px]" data-testid="review-details"><summary className="cursor-pointer font-medium">{fi ? 'Tarkistuksen lisätiedot ja historia' : 'Check details and history'}</summary><div className="mt-3 space-y-4">
          <div><KV k={fi ? 'Merkinnän viite' : 'Entry reference'} v={issue.record_key} mono /><KV k={fi ? 'Tarkistuksen viite' : 'Check reference'} v={issue.id} mono /><KV k={fi ? 'Tarkistussääntö' : 'Check rule'} v={`${issue.rule_id} ${issue.rule_version}`} mono /><KV k={fi ? 'Tallennettu versio' : 'Saved revision'} v={issue.revision} /><KV k="SHA-256" v={data.batch?.sha256} mono /></div>
          {Object.keys(payload).length > 0 && <details><summary className="cursor-pointer">{fi ? 'Kaikki alkuperäiset kentät' : 'All original fields'}</summary><div className="mt-2">{Object.entries(payload).filter(([key]) => key !== '_document').map(([key, value]) => <KV key={key} k={key} v={String(value)} mono />)}</div></details>}
          {data.data_reviews?.map((finding) => <div key={finding.id} className="rounded-lg border border-border p-3" data-testid="agent-finding"><p className="font-medium">{fi ? 'Automaattisen tarkistuksen perustelu' : 'Why the automated check flagged this'}</p><p className="mt-1 leading-relaxed">{finding.explanation}</p><p className="mt-1">{finding.next_action}</p><p className="mt-2 break-all text-[10.5px] text-muted-foreground">{finding.concern_status} · {finding.confidence} · {finding.model} · {finding.evidence_ids.join(', ')}</p></div>)}
          <div><p className="mb-2 font-medium">{fi ? 'Vertailuun käytetyt merkinnät' : 'Supporting entries'}</p><ul className="space-y-2">{data.evidence.map((entry) => <li key={entry.id} className="break-all text-[11px] text-muted-foreground">{entry.source_file}:{entry.source_row} · {entry.record_key} · {entry.id}</li>)}</ul></div>
          {data.correction && <div><KV k={fi ? 'Tallennettu päätös' : 'Recorded decision'} v={data.correction.status} /><KV k={fi ? 'Varmistettu arvo' : 'Confirmed value'} v={data.correction.approved_value} /><KV k={fi ? 'Tarkistajan perustelu' : 'Reviewer explanation'} v={data.correction.reason} /></div>}
          <div><p className="mb-1 font-medium">{fi ? 'Tarkistushistoria' : 'Review history'}</p><ul className="space-y-1 text-[11.5px] text-muted-foreground">{data.history.map((event, index) => <li key={index}>{shortDate(event.at)} · {event.change === 'evidence_requested' ? fi ? 'Lisätietoa pyydetty' : 'Information requested' : event.change === 'created' ? fi ? 'Lisätty tarkistukseen' : 'Added for review' : event.change === 'approved' ? fi ? 'Päätös tallennettu' : 'Decision saved' : event.change === 'rejected' ? fi ? 'Suljettu ilman muutosta' : 'Closed without a change' : event.change.replace(/_/g, ' ')}</li>)}</ul></div>
        </div></details>
      </div>}
    {review && issue && <ReviewDialog key={`${issue.id}-${review.decision}-${review.proposal?.investigation_id || ''}`} issue={issue} open={!!review} onOpenChange={(open) => !open && setReview(null)} decision={review.decision} proposal={review.proposal} onDone={refresh} />}
  </SheetContent></Sheet>;
}
