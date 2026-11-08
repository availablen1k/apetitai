export const periodLink = (path, year, values = {}) => {
  const [base, hash] = path.split('#'); const [pathname, query] = base.split('?');
  const params = new URLSearchParams(query || '');
  if (year) params.set('year',String(year));
  for (const [key,value] of Object.entries(values)) if(value !== undefined && value !== null && value !== '')params.set(key,String(value));
  return `${pathname}${params.size ? `?${params}`:''}${hash ? `#${hash}`:''}`;
};
export const money = (value,lang='en') => value == null ? (lang==='fi'?'Ei arvioitu':'Not assessed') : new Intl.NumberFormat(lang==='fi'?'fi-FI':'en-GB',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value);
export const amount = (value,lang='en') => value == null ? '—' : new Intl.NumberFormat(lang==='fi'?'fi-FI':'en-GB',{maximumFractionDigits:Math.abs(value)<10?2:0}).format(value);
export const actionCarbon = (effect,lang='en') => {
  const delta=effect.inventory_delta_tco2e;
  if(delta==null)return lang==='fi'?'Ei laskettu':'Not quantified';
  const direction=delta>0?(lang==='fi'?'lisäystä':'increase'):delta<0?(lang==='fi'?'vähennystä':'reduction'):(lang==='fi'?'ei muutosta':'no change');
  return `${amount(Math.abs(delta),lang)} tCO₂e/${lang==='fi'?'v':'yr'} · ${direction}`;
};
export const actionBasis = (basis,fi) => ({recomputed:fi?'Laskettu skenaario':'Recomputed scenario',ceiling:fi?'Vaikutettavissa olevat päästöt, ei säästöarvio':'Addressable footprint, savings not assessed',catalogue_estimate:fi?'Luettelon suunnitteluarvio':'Catalogue design estimate'})[basis] || basis;
export const targetMetric = (metric,fi) => ({scope1:'Scope 1',scope2:'Scope 2',scope1_2:'Scope 1 + 2',scope3:'Scope 3',total:fi?'Koko inventaario':'Whole inventory'})[metric] || metric;
export const contextLink = (path,search) => {
  const current=new URLSearchParams(search);const year=Number(current.get('year'));
  return periodLink(path,Number.isInteger(year)&&year>=2000&&year<=2100?year:undefined,{target:current.get('target')||undefined});
};

// A readable name for a saved inventory calculation, e.g.
// "2025 · saved 08.11.2026 02:03 · 18,360,870 tCO₂e · market-based · 6 corrections · latest".
export const runName = (run, lang = 'en', latestId = null) => {
  const fi = lang === 'fi';
  const saved = new Intl.DateTimeFormat(fi ? 'fi-FI' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(run.created_at));
  const corrections = run.correction_ids?.length || 0;
  return [
    `${run.year}`, `${fi ? 'tallennettu' : 'saved'} ${saved}`, `${amount(run.totals?.grand_total, lang)} tCO₂e`,
    run.scope2_basis === 'location' ? (fi ? 'sijaintiperusteinen' : 'location-based') : (fi ? 'markkinaperusteinen' : 'market-based'),
    corrections ? `${corrections} ${fi ? 'korjausta' : corrections === 1 ? 'correction' : 'corrections'}` : (fi ? 'ei korjauksia' : 'no corrections'),
    run.completeness?.contains_demo_data ? 'DEMO' : null,
    run.id === latestId ? (fi ? 'uusin' : 'latest') : null,
  ].filter(Boolean).join(' · ');
};
