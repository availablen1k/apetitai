import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Loader2, Bot, Download, ChevronDown, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, getReviewerLabel } from '@/api/client';
import StatusPill from '@/components/StatusPill';
import { useI18n } from '@/lib/i18n';
import { nf, shortDate } from '@/lib/format';
import { useToast } from '@/components/ui/use-toast';

const TEXT_STATUS = {
  extracted: { fi: 'teksti luettu', en: 'text read', tone: 'ok' },
  converted_and_extracted: { fi: 'muunnettu ja luettu', en: 'converted and read', tone: 'ok' },
  no_text_layer: { fi: 'ei tekstikerrosta (kuva/skannaus)', en: 'no text layer (image/scan)', tone: 'review' },
  not_readable_locally: { fi: 'ei luettavissa paikallisesti', en: 'not readable locally', tone: 'draft' },
  failed: { fi: 'lukeminen epäonnistui', en: 'reading failed', tone: 'error' },
};
const VERIFY = {
  verified_in_text: { fi: 'lainaus löytyy tiedostosta', en: 'quote found in file', tone: 'ok' },
  quote_not_found: { fi: 'lainausta ei löydy tiedostosta', en: 'quote not found in file', tone: 'error' },
  value_not_in_quote: { fi: 'arvo puuttuu lainauksesta', en: 'value not in quote', tone: 'error' },
  unit_not_in_quote: { fi: 'yksikkö ei täsmää lainaukseen', en: 'unit does not match quote', tone: 'error' },
  matched_in_ocr: { fi: 'löytyy OCR-tekstistä — tarkista skannaus', en: 'matches OCR — check the scan', tone: 'review' },
  no_local_text: { fi: 'ei tarkistettavissa (ei tekstiä)', en: 'unverified (no text)', tone: 'review' },
};

function Extraction({ x, fi }) {
  const r = x.result;
  return (
    <div className="mt-2 rounded-lg border border-[#EDDCC0] bg-[#FBF6EE] p-2.5 text-[11.5px]" data-testid="extraction">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="h-3.5 w-3.5 text-[#8A5A1E]" />
        <span className="font-medium text-[#8A5A1E]">{fi ? 'AI-poiminta — näyttöä, ei hyväksytty arvo' : 'AI extraction — evidence, not an approved value'}</span>
        <StatusPill tone={x.status === 'completed' ? 'ok' : 'error'} dot={false}>{x.status}</StatusPill>
        <span className="text-[10.5px] text-muted-foreground">{x.mode} · {x.model} · {shortDate(x.created_at)}</span>
      </div>
      {x.error && <p className="mt-1 text-[#8C3B2E]">{x.error}</p>}
      {r && (
        <>
          <p className="mt-1">{r.document_type}{r.issuer ? ` · ${r.issuer}` : ''}{r.subject ? ` · ${r.subject}` : ''} — {r.summary}</p>
          {r.instructions_found_in_document?.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[#8C3B2E]"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{fi ? 'Tiedostossa on ohjeita koneelle (ohitettu)' : 'The file contains instructions to the machine (ignored)'}: {r.instructions_found_in_document.join(' | ')}</p>
          )}
          <table className="mt-1.5 w-full text-left">
            <tbody>
              {r.values.map((v, i) => (
                <tr key={i} className="border-t border-[#EDDCC0]/70 align-top">
                  <td className="py-1 pr-2 font-medium">{v.field}</td>
                  <td className="py-1 pr-2 font-mono">{v.value} {v.unit || ''}{v.period ? ` · ${v.period}` : ''}</td>
                  <td className="py-1 pr-2"><StatusPill tone={VERIFY[v.verification]?.tone || 'draft'} dot={false}>{VERIFY[v.verification]?.[fi ? 'fi' : 'en'] || v.verification}</StatusPill></td>
                  <td className="py-1 text-muted-foreground">{v.found_on_page || v.page ? `${fi ? 's.' : 'p.'} ${v.found_on_page || v.page}: ` : ''}“{v.quote.slice(0, 200)}”</td>
                </tr>
              ))}
              {!r.values.length && <tr><td className="py-1 text-muted-foreground">{fi ? 'Ei arvoja löytynyt.' : 'No values found.'}</td></tr>}
            </tbody>
          </table>
          <p className="mt-1 text-[10.5px] text-muted-foreground">{fi ? 'Pohja' : 'Basis'}: {x.input_basis}</p>
        </>
      )}
    </div>
  );
}

export function EvidenceDocument({ d, issueId = undefined, fi }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const full = useQuery({ queryKey: ['evidence', d.id], queryFn: () => api.evidence(d.id), enabled: open });
  const ts = TEXT_STATUS[d.text_status] || { fi: d.text_status, en: d.text_status, tone: 'draft' };
  const extract = async () => {
    setBusy(true);
    try {
      const r = await api.extractEvidence(d.id, issueId);
      if (r.status === 'not_configured' || r.status === 'failed') toast({ title: fi ? 'Poiminta ei onnistunut' : 'Extraction not possible', description: r.message || r.error });
      qc.invalidateQueries({ queryKey: ['evidence-list'] });
      qc.invalidateQueries({ queryKey: ['evidence', d.id] });
      qc.invalidateQueries({ queryKey: ['upload-detail'] });
    } catch (e) {
      toast({ title: fi ? 'Poiminta epäonnistui' : 'Extraction failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const ocr = async () => {
    setBusy(true);
    try {
      const r = await api.ocrEvidence(d.id);
      toast({ title: r.status === 'completed' ? (fi ? 'OCR valmis — tarkista skannaus' : 'OCR complete — check the scan') : (fi ? 'OCR ei onnistunut' : 'OCR unavailable or failed'), description: r.error || r.note });
      qc.invalidateQueries({ queryKey: ['evidence-list'] });
      qc.invalidateQueries({ queryKey: ['evidence', d.id] });
      qc.invalidateQueries({ queryKey: ['upload-detail'] });
    } catch (e) {
      toast({ title: 'OCR', description: e.message, variant: 'destructive' });
    } finally { setBusy(false); }
  };
  const latest = d.extractions?.find((x) => !issueId || x.issue_id === issueId) || d.extractions?.[0];
  return (
    <li className="rounded-xl border border-border bg-card p-3" data-testid="evidence-doc">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <FileText className="h-3.5 w-3.5 text-[#2E7099]" />
        <span className="font-medium">{d.filename}</span>
        <span className="text-[10.5px] text-muted-foreground">{d.kind} · {nf(d.size_bytes / 1024, 0)} kB{d.page_count ? ` · ${d.page_count} ${fi ? 'sivua' : 'pages'}` : ''} · {nf(d.text_chars)} {fi ? 'merkkiä' : 'chars'}</span>
        <StatusPill tone={ts.tone} dot={false}>{ts[fi ? 'fi' : 'en']}</StatusPill>
        <span className="font-mono text-[10px] text-muted-foreground">{d.id}</span>
        <span className="ml-auto flex gap-1.5">
          <a href={api.evidenceFileUrl(d.id)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px]"><Download className="h-3 w-3" />{fi ? 'Lataa' : 'Download'}</a>
          <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px]"><ChevronDown className={`h-3 w-3 transition ${open ? 'rotate-180' : ''}`} />{fi ? 'Teksti' : 'Text'}</button>
          {(d.kind === 'pdf' || d.kind === 'image') && <button onClick={ocr} disabled={busy} className="rounded-full border border-border px-2.5 py-1 text-[11px] disabled:opacity-50" data-testid="run-ocr">{busy ? '…' : fi ? 'Lue OCR:llä' : 'Read with OCR'}</button>}
          <button onClick={extract} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-[#EDDCC0] bg-[#FBF6EE] px-2.5 py-1 text-[11px] font-medium text-[#8A5A1E] disabled:opacity-60" data-testid="extract">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}{fi ? 'Poimi Geminillä' : 'Extract with Gemini'}
          </button>
        </span>
      </div>
      {d.note && <p className="mt-1 text-[11px] text-muted-foreground">{d.note}</p>}
      {d.text_runs?.[0] && <p className="mt-1 text-[11px] text-[#8A5A1E]">OCR: {d.text_runs[0].status}{d.text_runs[0].error ? ` · ${d.text_runs[0].error}` : fi ? ' · koneellinen teksti; tarkista alkuperäinen' : ' · machine transcription; check the original'}</p>}
      {(d.kind === 'pdf' || d.kind === 'image') && !d.ocr?.[d.kind === 'pdf' ? 'pdf' : 'images'] && <p className="mt-1 text-[11px] text-muted-foreground">{fi ? 'Paikallinen OCR tarvitsee Tesseractin. Gemini-poiminta on käytettävissä API-avaimella.' : 'Local OCR needs Tesseract. Gemini extraction is available with an API key.'}</p>}
      {d.links?.length > 0 && <p className="mt-1 text-[10.5px] text-muted-foreground">{fi ? 'Linkitetty' : 'Linked to'}: {d.links.map((l) => `${l.entity_type} ${l.entity_id}`).join(', ')}</p>}
      {open && (
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-2 text-[10.5px]">
          {full.isLoading ? '…' : (full.data?.pages || []).map((p) => `${p.page !== null ? `— ${fi ? 'sivu' : 'page'} ${p.page} —\n` : ''}${p.text}`).join('\n\n').slice(0, 8000) || (fi ? '(ei paikallista tekstiä)' : '(no local text)')}
        </pre>
      )}
      {latest && <Extraction x={latest} fi={fi} />}
    </li>
  );
}

// Upload any file as evidence (optionally linked to an entity) and list the linked documents.
export default function EvidencePanel({ entityType = undefined, entityId = undefined, issueId = undefined, compact = false, onQueued = undefined }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [linked, setLinked] = useState('');
  const list = useQuery({ queryKey: ['evidence-list', entityType, entityId, q, kind, linked], queryFn: () => api.evidenceList({ ...(entityType && entityId ? { entity_type: entityType, entity_id: entityId } : {}), q, kind, linked }) });
  const upload = async (files) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const contextual = entityType && entityId;
      const r = contextual ? await api.addEvidence(files, { entity_type: entityType, entity_id: entityId, label: getReviewerLabel() }) : await api.queueUploads(files);
      qc.invalidateQueries({ queryKey: ['evidence-list'] });
      qc.invalidateQueries({ queryKey: ['upload-inbox'] });
      toast({ title: contextual ? (fi ? 'Tiedosto tallennettu näytöksi' : 'File stored as evidence') : (fi ? 'Lisätty Tiedostot-välilehdelle — vahvista luokittelu' : 'Added to Uploads — confirm classification'), description: r.results.map((x) => x.error ? `${x.filename}: ${x.error}` : x.evidence?.filename || x.filename).join(', ') });
      if (!contextual) onQueued?.();
    } catch (e) {
      toast({ title: fi ? 'Tallennus epäonnistui' : 'Upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const docs = list.data || [];
  return (
    <div>
      {!compact && (
        <p className="mb-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {fi
            ? 'Mikä tahansa tiedosto (PDF, Word, Excel, kuva, sähköposti, teksti…) tallennetaan muuttumattomana SHA-256-tiivisteen kanssa. Teksti luetaan paikallisesti; Gemini voi poimia arvot, ja jokainen lainaus tarkistetaan tiedoston omasta tekstistä. Poiminta on näyttöä — laskentaan ei muutu mitään ilman hyväksyntää.'
            : 'Any file (PDF, Word, Excel, image, e-mail, text…) is stored unchanged with its SHA-256. Text is read locally; Gemini can extract values, and every quote is checked against the file’s own text. An extraction is evidence — nothing in the calculation changes without approval.'}
        </p>
      )}
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/40 px-3 py-2 text-[12px]">
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-[#2E7099]" /> : <Paperclip className="h-4 w-4 text-[#2E7099]" />}
        <span>{entityId ? (fi ? 'Liitä tiedosto tähän' : 'Attach a file here') : fi ? 'Lisää tiedostoja Tiedostot-välilehdelle' : 'Add files to Uploads'}</span>
        <input type="file" multiple className="hidden" onChange={(e) => { upload(Array.from(e.target.files || [])); e.target.value = ''; }} data-testid="evidence-file" />
      </label>
      {!compact && <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={fi ? 'Hae tiedostosta, tekstistä tai tunnisteesta…' : 'Search filename, text or linked ID…'} aria-label={fi ? 'Hae asiakirjoja' : 'Search documents'} className="min-w-52 flex-1 rounded-lg border border-border bg-card px-3 py-2" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={fi ? 'Tiedostotyyppi' : 'File type'} className="rounded-lg border border-border bg-card px-2 py-1"><option value="">{fi ? 'Kaikki tyypit' : 'All file types'}</option>{['pdf', 'docx', 'text', 'spreadsheet', 'office', 'image', 'other'].map((k) => <option key={k}>{k}</option>)}</select>
        <select value={linked} onChange={(e) => setLinked(e.target.value)} aria-label={fi ? 'Linkitys' : 'Link status'} className="rounded-lg border border-border bg-card px-2 py-1"><option value="">{fi ? 'Kaikki linkitykset' : 'Any link status'}</option><option value="linked">{fi ? 'Linkitetty' : 'Linked'}</option><option value="unlinked">{fi ? 'Ei linkitetty' : 'Unlinked'}</option></select>
      </div>}
      {list.error && <p className="mt-2 text-[12px] text-[#8C3B2E]">{list.error.message}</p>}
      <ul className="mt-2 space-y-2">
        {docs.map((d) => <EvidenceDocument key={d.id} d={d} issueId={issueId} fi={fi} />)}
        {!docs.length && !list.isLoading && <li className="text-[11.5px] text-muted-foreground">{fi ? 'Ei liitettyjä tiedostoja.' : 'No files attached.'}</li>}
      </ul>
      {docs.some((d) => d.extractions?.some((x) => x.result?.values?.some((v) => v.verification === 'verified_in_text'))) && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-[#1C5B85]"><CheckCircle2 className="h-3 w-3" />{fi ? 'Vihreät arvot löytyvät tiedostosta sanatarkasti.' : 'Green values were found verbatim in the file.'}</p>
      )}
    </div>
  );
}
