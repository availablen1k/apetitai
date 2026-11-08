import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getReviewerLabel, setReviewerLabel } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { amount, runName, targetMetric } from '@/lib/decisions';

const empty={name:'',metric:'scope1_2',baseline_run_id:'',target_year:'',target_tco2e:'',boundary:''};
export default function TargetEditor(){
  const {lang}=useI18n();const fi=lang==='fi';const qc=useQueryClient();const [params]=useSearchParams();
  const [form,setForm]=useState(empty),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const [reviewer,setReviewer]=useState(()=>{const value=getReviewerLabel();return value==='Local reviewer'?'':value;});
  const settings=useQuery({queryKey:['app-settings'],queryFn:async()=> (await api.docs('app_settings',{sort:'-created_date',limit:1}))[0]||null});
  const runs=useQuery({queryKey:['target-runs'],queryFn:()=>api.runs({kind:'inventory',limit:200})});
  const all=runs.data||[];const current=all.find(r=>r.year===Number(params.get('year')))||all[0];
  const targets=Array.isArray(settings.data?.decision_targets)?settings.data.decision_targets:[];
  const latestByYear=new Map([...all].sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(r=>[r.year,r.id]));
  const change=(key)=>(event)=>{setSaved(false);setForm(previous=>({...previous,[key]:event.target.value}));};
  const save=async(event)=>{
    event.preventDefault();if(busy)return;
    const base=all.find(r=>r.id===form.baseline_run_id);const targetYear=Number(form.target_year),targetAmount=Number(form.target_tco2e);
    if(!base||!form.name.trim()||!form.boundary.trim()||!form.target_tco2e.trim()||!Number.isFinite(targetAmount)||targetAmount<0||!Number.isInteger(targetYear)||targetYear<=base.year||targetYear>2100){setError(fi?'Tarkista nimi, rajaus, vertailulaskelma ja sitä myöhempi tavoitevuosi sekä päästömäärä.':'Enter a name, boundary, baseline calculation, a later target year and a non-negative target amount.');return;}
    if(confirmed&&!reviewer.trim()){setError(fi?'Kirjaa vertailukelpoisuuden tarkistaja.':'Name the reviewer who checked comparability.');return;}
    setBusy(true);setError('');
    try{
      const latest=(await api.docs('app_settings',{sort:'-created_date',limit:1}))[0]||{};
      const previous=Array.isArray(latest.decision_targets)?latest.decision_targets:[];
      const target={id:form.id||crypto.randomUUID(),name:form.name.trim(),metric:form.metric,baseline_run_id:base.id,target_year:targetYear,target_tco2e:targetAmount,boundary:form.boundary.trim(),comparable_run_ids:confirmed&&current?[current.id]:[],boundary_reviewed_by:confirmed?reviewer.trim():undefined};
      const {id:settingsId,created_date,updated_date,...values}=latest;
      void settingsId;void created_date;void updated_date;
      await api.createDoc('app_settings',{...values,decision_targets:[...previous.filter(t=>t.id!==target.id),target]});
      if(confirmed)setReviewerLabel(reviewer.trim());setForm(empty);setConfirmed(false);setSaved(true);
      qc.invalidateQueries({queryKey:['app-settings']});qc.invalidateQueries({queryKey:['decision-workspace']});qc.invalidateQueries({queryKey:['action-options']});
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const field='mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-[12px]';
  return <section id="targets" className="surface mt-5 scroll-mt-24 p-5" data-testid="target-settings"><h2 className="font-heading text-[21px]">{fi?'Yrityksen määrittelemät tavoitteet':'Company-defined targets'}</h2><p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">{fi?'Määrittele absoluuttinen päästötavoite tallennetun inventaarion rajaukselle. Tavoitevuoden päästömäärä ei oleta vuosittaista polkua. Sovellus ei määrittele yrityksen tavoitetta puolestasi.':'Define an absolute emissions endpoint for a saved inventory boundary. No annual pathway is assumed. The app does not choose the company target for you.'}</p>
    {targets.length>0&&<ul className="mt-4 divide-y divide-border rounded-xl border border-border">{targets.map((target,index)=><li key={target.id||index} className="flex flex-wrap items-center justify-between gap-3 p-3 text-[12px]"><span>{target.name} · {targetMetric(target.metric,fi)} · {target.target_year}: {amount(target.target_tco2e,lang)} tCO₂e</span><button onClick={()=>{setForm({...empty,...target,target_year:String(target.target_year),target_tco2e:String(target.target_tco2e)});setConfirmed(false);setSaved(false);}} className="font-medium text-[#2E7099]">{fi?'Muokkaa määritelmää':'Edit definition'}</button></li>)}</ul>}
    {(settings.error||runs.error)&&<p role="alert" className="mt-3 text-[12px] text-[#8C3B2E]">{settings.error?.message||runs.error?.message}</p>}
    {runs.isSuccess&&!all.length?<p className="mt-4 text-[12px]">{fi?'Tallenna ensin inventaariolaskelma vertailuvuodelle.':'Save an inventory calculation for the baseline year first.'}</p>:<form onSubmit={save} className="mt-5 space-y-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><label className="text-[12px]">{fi?'Tavoitteen nimi':'Target name'}<input required maxLength={160} value={form.name} onChange={change('name')} className={field} data-testid="target-name" /></label><label className="text-[12px]">{fi?'Laskennan rajaus':'Accounting boundary'}<select value={form.metric} onChange={change('metric')} className={field} data-testid="target-metric">{['scope1','scope2','scope1_2','scope3','total'].map(metric=><option key={metric} value={metric}>{targetMetric(metric,fi)}</option>)}</select></label><label className="text-[12px]">{fi?'Vertailuvuoden tallennettu laskelma':'Saved baseline calculation'}<select required value={form.baseline_run_id} onChange={change('baseline_run_id')} className={field} data-testid="target-baseline"><option value="">{fi?'Valitse laskelma':'Select a calculation'}</option>{[...all].sort((a,b)=>b.year-a.year||b.created_at.localeCompare(a.created_at)).map(run=><option key={run.id} value={run.id}>{runName(run,lang,latestByYear.get(run.year))}</option>)}</select></label><label className="text-[12px]">{fi?'Tavoitevuosi':'Target year'}<input required type="number" min="2000" max="2100" value={form.target_year} onChange={change('target_year')} className={field} data-testid="target-year" /></label><label className="text-[12px]">{fi?'Tavoitevuoden päästömäärä (tCO₂e)':'Target endpoint (tCO₂e)'}<input required type="number" min="0" step="any" value={form.target_tco2e} onChange={change('target_tco2e')} className={field} data-testid="target-amount" /></label></div>
      <label className="block text-[12px]">{fi?'Mitä toimintoja, maita ja luokkia rajaus sisältää?':'Which operations, countries and categories does this boundary cover?'}<textarea required maxLength={500} rows={2} value={form.boundary} onChange={change('boundary')} className={field} data-testid="target-boundary" /></label>
      <details className="rounded-xl border border-border p-3 text-[12px]"><summary className="cursor-pointer font-medium">{fi?'Vertailukelpoisuuden tarkistus':'Review comparability'}</summary><p className="mt-2 text-muted-foreground">{fi?'Uusi laskelmaversio vaatii uuden rajauksen tarkistuksen. Menetelmän, Scope 2 -perustan ja tietopuutteiden tarkistukset pysyvät käytössä.':'A new calculation version needs a new boundary review. Method, Scope 2 basis and data-gap checks still apply.'}</p>{current&&<label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-0.5" /><span>{fi?'Olen varmistanut saman rajauksen vertailuvuoden ja valitun laskelman välillä':'I have checked that the baseline and selected calculation use the same target boundary'}: {runName(current,lang,latestByYear.get(current.year))}.</span></label>}{confirmed&&<label className="mt-3 block">{fi?'Tarkistajan nimi':'Reviewer name'}<input required maxLength={80} value={reviewer} onChange={e=>setReviewer(e.target.value)} className={field} /></label>}</details>
      <p className="text-[11px] text-muted-foreground">{fi?'Intensiteettitavoitteita, erillistä FLAG-tavoitetta tai toimenpiteiden hyväksyttävää tavoitehyvitystä ei lasketa tällä määritelmällä.':'This definition does not calculate intensity targets, a separate FLAG target or eligible credits for operational measures.'}</p>
      {error&&<p role="alert" className="text-[12px] text-[#8C3B2E]">{error}</p>}{saved&&<p role="status" className="text-[12px] text-[#36866B]">{fi?'Tavoitemääritelmä tallennettu uutena asetusversiona.':'Target definition saved as a new settings version.'}</p>}
      <button disabled={busy||settings.isLoading||runs.isLoading} type="submit" className="rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-40" data-testid="target-save">{busy?(fi?'Tallennetaan…':'Saving…'):(fi?'Tallenna tavoitemääritelmä':'Save target definition')}</button>
    </form>}
  </section>;
}
