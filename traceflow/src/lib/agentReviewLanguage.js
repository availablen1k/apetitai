import { datasetName, fieldName } from './reviewLanguage.js';

const CROPS = {
  pea: ['Herne', 'Peas'], peas: ['Herne', 'Peas'], turnip_rape: ['Rypsi', 'Turnip rape'], rapeseed: ['Rapsi', 'Rapeseed'],
  carrot: ['Porkkana', 'Carrots'], potato: ['Peruna', 'Potatoes'], sugar_beet: ['Sokerijuurikas', 'Sugar beet'],
  wheat: ['Vehnä', 'Wheat'], barley: ['Ohra', 'Barley'], oats: ['Kaura', 'Oats'], oat: ['Kaura', 'Oats'], spinach: ['Pinaatti', 'Spinach'],
};
export const cropName = (crop, lang = 'en') => CROPS[crop]?.[lang === 'fi' ? 0 : 1] || String(crop || '').replace(/_/g, ' ');
export const reviewSearch = (query) => Object.entries(CROPS).find(([, names]) => names.some((name) => name.toLowerCase() === query.trim().toLowerCase()))?.[0] || query.trim();

export const reviewRunLabel = (status, lang = 'en') => ({
  queued: ['Odottaa tarkistusta', 'Waiting to start'], running: ['Tarkistus käynnissä', 'Checking information'],
  completed: ['Tarkistus valmis', 'Checks finished'], rules_only: ['Perustarkistukset valmiit', 'Built-in checks finished'],
  degraded: ['AI-tarkistuksessa on rajoituksia', 'AI review has limitations'], failed: ['Tarkistus jäi kesken', 'Review needs attention'],
  interrupted: ['Tarkistus keskeytyi', 'Review interrupted'],
})[status]?.[lang === 'fi' ? 0 : 1] || (lang === 'fi' ? 'Tarkistuksen tila ei ole tiedossa' : 'Review status unavailable');

export function findingStatus(finding, lang = 'en') {
  const fi = lang === 'fi';
  // Human decisions take precedence over an older automated concern status.
  if (finding.review_status === 'approved') return fi ? 'Päätös tallennettu' : 'Decision saved';
  if (finding.review_status === 'rejected') return fi ? 'Suljettu ilman muutosta' : 'Closed without a change';
  if (finding.withdrawn) return fi ? 'Ei enää poikkeamaa' : 'No longer flagged';
  if (finding.concern_status === 'NEEDS_EVIDENCE' || finding.related_checks?.some((check) => check.concern_status === 'NEEDS_EVIDENCE')) return fi ? 'Tarvitsee lisätietoa' : 'More information needed';
  return fi ? 'Odottaa tarkistusta' : 'Needs checking';
}

export function findingContext(finding, dataset, lang = 'en') {
  const fi = lang === 'fi';
  const reference = finding.survey_id || String(finding.record_key || '').split(':').slice(1).join(':');
  return [datasetName(finding.table_name || dataset, lang), finding.farm_id && `${fi ? 'Tila' : 'Farm'} ${finding.farm_id}`,
    finding.crop && cropName(finding.crop, lang), finding.year, reference && `${finding.survey_id ? fi ? 'Kysely' : 'Survey' : fi ? 'Viite' : 'Reference'} ${reference}`].filter(Boolean).join(' · ');
}

export function findingExplanation(finding, lang = 'en') {
  const fi = lang === 'fi';
  let text = fi && finding.origin === 'local' && !finding.rule_id?.startsWith('agent.') ? finding.explanation_fi || finding.explanation : finding.explanation;
  text = String(text || '');
  // Replace known identifiers only; quantities, comparisons and caveats stay in the saved text.
  text = text.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (token) => CROPS[token] ? cropName(token, lang) : fieldName(token, lang));
  for (const crop of Object.keys(CROPS)) text = text.replace(new RegExp(`\\b${crop}\\b`, 'g'), cropName(crop, lang));
  if (!fi) text = text.replace(/the crop median/g, 'the middle value for this crop').replace(/the decimal has probably shifted/g, 'check whether the decimal point is in the right place');
  return text;
}

export function findingSummary(finding, lang = 'en') {
  const fi = lang === 'fi';
  if (finding.withdrawn && finding.review_status === 'open') return fi ? 'Aiempi huoli ei ole enää uusien tarkistusten tukema. Voit katsoa alkuperäisen havainnon ja myöhemmän arvion.' : 'The latest checks no longer support this concern. You can still view the original finding and the later assessment.';
  if (finding.rule_id === 'farm.soil_map_vs_survey') return fi ? 'Kysely ja maaperäkartta ilmoittavat eri maalajin. Kartta on arvio. Laskenta käyttää jo kartan osuutta; varmista tiedot molemmista lähteistä.' : 'The survey and soil map show different soil types. The map is an estimate. The calculation already uses the map’s share; check both sources.';
  return findingExplanation(finding, lang);
}
