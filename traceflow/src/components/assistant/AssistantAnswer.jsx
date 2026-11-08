import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { AlertTriangle, CheckCircle2, ChevronRight, FileText, Lightbulb, Loader2, RotateCcw, Save } from 'lucide-react';
import StatusPill from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { periodLink } from '@/lib/decisions';

export default function AssistantAnswer({ turn, busy, savingId, onSave, onAsk, onRetry }) {
  const { t, lang } = useI18n();
  const fi = lang === 'fi';
  const data = turn.data;
  const failed = data.status === 'failed';
  const unavailable = data.status === 'not_configured';
  const answered = ['completed', 'degraded'].includes(data.status) && !!data.answer;
  const limited = data.insufficient || data.status === 'degraded';
  const evidence = answered ? data.citations || [] : data.facts || [];
  const followups = data.followups || data.follow_ups || [];

  return (
    <div className="space-y-3" data-testid="assistant-response">
      <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
        <span>{data.model ? `Gemini · ${data.model}` : fi ? 'Tietokannan lähdetiedot' : 'Database context'} · {turn.year}</span>
        {answered && <StatusPill tone="draft" dot={false}>{data.response_type==='guidance'?(fi?'Yleinen ohje':'General guidance'):fi ? 'AI-vastaus' : 'AI response'}</StatusPill>}
        {answered && limited && <StatusPill tone="review">{fi ? 'Puutteellinen näyttö' : 'Limited evidence'}</StatusPill>}
      </div>

      {(failed || unavailable) && (
        <div role="alert" className={`rounded-xl border p-4 ${failed ? 'border-[#EBD0CB] bg-[#FBF0EE] text-[#8C3B2E]' : 'border-[#EDDCC0] bg-[#FBF4E7] text-[#7A5A2E]'}`}>
          <p className="flex items-center gap-2 text-[13px] font-medium"><AlertTriangle className="h-4 w-4" />{failed ? fi ? 'Vastausta ei saatu' : 'Could not generate an answer' : fi ? 'AI-vastausta ei ole saatavilla' : 'AI answer unavailable'}</p>
          <p className="mt-2 break-words text-[12px] leading-relaxed">{data.message}</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={onRetry} className="mt-3 gap-1.5" data-testid="assistant-retry"><RotateCcw className="h-3.5 w-3.5" />{fi ? 'Yritä uudelleen' : 'Retry'}</Button>
        </div>
      )}

      {answered && (
        <>
          <div className="break-words text-[13px] leading-7 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_code]:break-all [&_pre]:whitespace-pre-wrap" data-testid="assistant-answer"><ReactMarkdown skipHtml disallowedElements={['img']} components={{a:({children})=><span>{children}</span>}}>{data.answer}</ReactMarkdown></div>
          {limited && <p className="rounded-xl border border-[#EDDCC0] bg-[#FBF4E7] p-3 text-[12px] leading-relaxed text-[#7A5A2E]">{fi ? 'Lähteet eivät täysin tue vastausta. Tarkista puuttuvat tiedot ennen käyttöä.' : 'The evidence does not fully support this answer. Check the missing information before using it.'}</p>}
          {data.message && <p role="status" className="text-[12px] text-[#7A5A2E]">{data.message}</p>}
        </>
      )}

      {evidence.length > 0 ? (
        <details className="rounded-xl border border-border bg-muted/20" open={!answered} data-testid="assistant-evidence">
          <summary className="cursor-pointer px-3.5 py-3 text-[12px] font-medium">{answered ? fi ? 'Viitatut lähteet' : 'Cited evidence' : fi ? 'Saatavilla olevat lähdetiedot' : 'Available database context'} <span className="text-muted-foreground">({evidence.length})</span></summary>
          <ul className="max-h-[280px] space-y-2 overflow-y-auto border-t border-border px-3.5 py-3">
            {evidence.map((item) => (
              <li key={item.id} className="rounded-lg border border-border/60 bg-card p-3 text-[12px] leading-relaxed">
                <div className="flex items-start gap-2"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="font-medium">{item.label}</span></div>
                <p className="mt-1 break-words">{item.value}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{item.source} · {item.id}</p>
                {item.link && <Link to={item.link} className="mt-1.5 inline-flex items-center gap-1 font-medium text-[#2E7099] hover:underline">{fi ? 'Avaa lähdenäkymä' : 'Open source view'}<ChevronRight className="h-3 w-3" /></Link>}
              </li>
            ))}
          </ul>
        </details>
      ) : answered && <p className="text-[12px] text-muted-foreground">{data.response_type==='guidance'?(fi?'Yleinen selitys, ei todennettu yritystulos.':'General explanation, not a verified company result.'):t('assistant.noEvidence')}</p>}

      {answered && data.interpretation && (
        <details className="rounded-xl border border-[#EDDCC0] bg-[#FDF8EE]" data-testid="assistant-interpretation">
          <summary className="cursor-pointer px-3.5 py-3 text-[12px] font-medium text-[#6B4A16]"><Lightbulb className="mr-1.5 inline h-3.5 w-3.5" />{fi ? 'AI-tulkinta' : 'AI interpretation'}</summary>
          <div className="border-t border-[#EDDCC0] px-3.5 py-3">
            <p className="mb-2 text-[10.5px] text-[#8A5A1E]">{fi ? 'Mallin tuottama tulkinta; vaatii tarkistuksen.' : 'Model-generated interpretation; requires review.'}</p>
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[#5E4526]">{data.interpretation}</p>
          </div>
        </details>
      )}

      {data.links?.length > 0 && <div className="flex flex-wrap gap-2">{data.links.map((item) => <Link key={item.to} to={item.to} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] hover:bg-muted">{item.label}<ChevronRight className="h-3 w-3" /></Link>)}</div>}

      {answered && followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t('assistant.followups')}>
          {followups.map((question, index) => <button key={index} disabled={busy || question.length > 1000} onClick={() => onAsk(question)} className="rounded-full border border-border bg-muted/50 px-3 py-1.5 text-left text-[11.5px] hover:border-[#9EC4DE] disabled:opacity-50" data-testid="assistant-followup">{question}</button>)}
        </div>
      )}

      {answered && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          {turn.savedId ? (
            <Link to={periodLink('/reports',turn.year)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1E5578] hover:underline" data-testid="assistant-saved"><CheckCircle2 className="h-4 w-4" />{fi ? 'Luonnos tallennettu · avaa Raportit' : 'Draft saved · view in Reports'}<ChevronRight className="h-3 w-3" /></Link>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onSave(turn)} disabled={savingId !== null} className="gap-2" data-testid="assistant-save">
              {savingId === turn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{fi ? 'Tallenna raporttiluonnokseksi' : 'Save as report draft'}
            </Button>
          )}
          <span className="text-[10.5px] text-muted-foreground">{fi ? 'Ihmisen tarkistus ennen hyväksyntää.' : 'Human review before approval.'}</span>
        </div>
      )}
    </div>
  );
}
