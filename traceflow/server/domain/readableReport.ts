// A deterministic reading layer over one immutable calculation. These texts never ask a model
// to invent figures, and report snapshots retain the exact calculation and source references.
import type { RunRow } from '../services/calculations.ts';

const CATEGORY_NAMES: Record<string, [string, string]> = {
  stationary_and_mobile_combustion: ['Polttoaineet omassa toiminnassa', 'Fuels used in our operations'],
  fugitive_refrigerants: ['Kylmäainevuodot', 'Refrigerant leaks'],
  purchased_electricity: ['Ostettu sähkö', 'Electricity we buy'],
  purchased_heat_steam: ['Ostettu lämpö ja höyry', 'Heat and steam we buy'],
  cat01_purchased_goods: ['Ostetut tuotteet ja raaka-aineet', 'Purchased goods and raw materials'],
  cat01_purchased_services: ['Ostetut palvelut', 'Purchased services'],
  cat02_capital_goods: ['Laitteet ja muut investoinnit', 'Equipment and other capital purchases'],
  cat03_fuel_energy: ['Polttoaineiden ja energian toimitusketju', 'Fuel and energy supply chains'],
  cat04_upstream_transport: ['Saapuvat kuljetukset', 'Inbound deliveries'],
  cat05_waste: ['Jätteiden käsittely', 'Waste treatment'],
  cat06_business_travel: ['Liikematkat', 'Business travel'],
  cat07_employee_commuting: ['Työntekijöiden työmatkat', 'Employee commuting'],
  cat09_downstream_transport: ['Lähtevät kuljetukset', 'Outbound deliveries'],
  cat11_use_of_sold_products: ['Myytyjen tuotteiden käyttö', 'Use of sold products'],
  cat12_end_of_life: ['Myytyjen tuotteiden jätteenkäsittely', 'Disposal of sold products'],
};

export function reportComparison(current: RunRow, previous: RunRow | null) {
  const sameSources = previous && JSON.stringify(current.dataset_hashes) === JSON.stringify(previous.dataset_hashes);
  const sameFactors = previous && JSON.stringify(current.factor_versions) === JSON.stringify(previous.factor_versions);
  // Describe revisions of the same reporting year only. The app has no reviewed organisational
  // boundary comparison that would justify treating year-on-year differences as a trend.
  if (!previous || previous.year !== current.year || previous.kind !== current.kind || previous.scope2_basis !== current.scope2_basis || previous.method_version !== current.method_version || !sameSources || !sameFactors) {
    return { available: false as const, previous_run_id: previous?.id || null, difference_tco2e: null, difference_pct: null };
  }
  const before = previous.totals.grand_total;
  const after = current.totals.grand_total;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return { available: false as const, previous_run_id: previous.id, difference_tco2e: null, difference_pct: null };
  return { available: true as const, previous_run_id: previous.id, difference_tco2e: after - before, difference_pct: before === 0 ? null : ((after - before) / Math.abs(before)) * 100 };
}

// Facts about the reporting year that are not inside the saved calculation itself. Captured when
// the draft is created and frozen in its snapshot.
export type ReportContext = {
  prior?: { year: number; grand_total: number; comparable: boolean; change_tco2e: number; change_pct: number | null } | null;
  open_issue_tco2e?: number; open_issue_share_pct?: number | null; critical_incidents?: number;
  missing_activity?: string[];
  next_steps?: { found: string; suggest: string; tco2e: number | null }[];
};

const DATASET_NAMES: Record<string, [string, string]> = {
  fuel_deliveries: ['Polttoainetoimitukset', 'Fuel deliveries'], waste_transfer_notes: ['Jätteet', 'Waste records'],
  travel_bookings: ['Liikematkat', 'Business travel'], sales_volumes: ['Myyntimäärät', 'Product sales'],
};

export function readableReport(r: RunRow, previous: RunRow | null, lang: 'fi' | 'en', ctx: ReportContext = {}) {
  const fi = lang === 'fi';
  const n = (value: number, digits = 1) => new Intl.NumberFormat(fi ? 'fi-FI' : 'en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  const pct = (value: number) => value > 0 && value < 0.1 ? '<0.1 %' : `${n(value, Math.abs(value) < 10 ? 1 : 0)} %`;
  const signed = (value: number, text: string) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${text}`;
  const total = r.totals.grand_total;
  const relatedIssues = r.open_issue_count + Number(r.completeness.open_missing_record_issues || 0);
  const estimated = Number(r.completeness.estimated_contributions || 0);
  const failedChecks = r.checks.filter((check) => !check.passed).length;
  const demo = !!r.completeness.contains_demo_data;
  const provisional = demo || r.status !== 'complete' || relatedIssues > 0 || estimated > 0 || r.gaps.length > 0 || failedChecks > 0;
  const positive = ((r.completeness.by_category || []) as { tco2e: number; in_total: boolean }[]).filter((c) => c.in_total && c.tco2e > 0).reduce((sum, c) => sum + c.tco2e, 0);
  const categories = ((r.completeness.by_category || []) as { category: string; tco2e: number; in_total: boolean }[])
    .filter((item) => item.in_total && Number.isFinite(item.tco2e))
    .sort((a, b) => b.tco2e - a.tco2e)
    .slice(0, 5)
    .map((item) => ({ ...item, share_pct: positive > 0 && item.tco2e >= 0 ? item.tco2e / positive * 100 : null, label: CATEGORY_NAMES[item.category]?.[fi ? 0 : 1] || item.category.replace(/_/g, ' ') }));
  const comparison = reportComparison(r, previous);
  const prior = ctx.prior ?? null;
  const exposure = ctx.open_issue_tco2e ?? 0;
  const share = ctx.open_issue_share_pct ?? null;
  const critical = ctx.critical_incidents ?? 0;
  const missing = ctx.missing_activity ?? [];

  const result = fi
    ? `Vuoden ${r.year} kasvihuonekaasupäästöt ovat ${n(total)} tCO₂e.`
    : `Greenhouse gas emissions for ${r.year} are ${n(total)} tCO₂e.`;
  const split = `Scope 1 ${n(r.totals.scope1_total)} · Scope 2 ${n(r.totals.scope2_reported)} · Scope 3 ${n(r.totals.scope3_total)} tCO₂e`;
  const yoy = !prior ? null : prior.comparable
    ? (fi ? `Muutos vuodesta ${prior.year}: ` : `Change from ${prior.year}: `) + signed(prior.change_tco2e, `${n(Math.abs(prior.change_tco2e))} tCO₂e`) + (prior.change_pct == null ? '' : ` (${signed(prior.change_pct, pct(Math.abs(prior.change_pct)))})`) + '.'
    : fi ? `Ei vertailukelpoinen vuoden ${prior.year} kanssa (eri laskentatapa tai Scope 2 -perusta).` : `Not comparable with ${prior.year} (different method or Scope 2 basis).`;
  const verdict = (provisional
    ? fi ? 'Alustava.' + (exposure > 0 && share != null ? ` ${pct(share)} luvusta perustuu tietoihin, joissa on avoin poikkeama.` : ' Tarkistettavia kohtia on vielä avoinna.') : 'Provisional.' + (exposure > 0 && share != null ? ` ${pct(share)} of the total rests on records with open incidents.` : ' Review items remain open.')
    : fi ? 'Avoimia tarkistuksia ei ole kirjattu. Raportti odottaa ihmisen tarkistusta.' : 'No open review items are recorded. The report awaits human review.')
    + (demo ? fi ? ' Sisältää synteettistä esimerkkitietoa.' : ' Includes synthetic example data.' : '');

  const checks: string[] = [];
  if (exposure > 0) checks.push(fi ? `${n(exposure)} tCO₂e${share != null ? ` (${pct(share)})` : ''} perustuu tietoihin, joissa on avoin poikkeama${critical ? ` (${n(critical, 0)} kriittistä)` : ''}.` : `${n(exposure)} tCO₂e${share != null ? ` (${pct(share)})` : ''} rests on records with open incidents${critical ? ` (${n(critical, 0)} critical)` : ''}.`);
  else if (relatedIssues > 0) checks.push(fi ? `${n(relatedIssues, 0)} avointa kohtaa liittyi laskelmaan tallennushetkellä.` : `${n(relatedIssues, 0)} open items were linked to this calculation when it was saved.`);
  if (estimated > 0) checks.push(fi ? `${n(estimated, 0)} laskentariviä käyttää arvioituja arvoja.` : `${n(estimated, 0)} calculation entries use estimated values.`);
  if (r.gaps.length > 0) {
    const areas: Record<string, [string, string]> = {
      energy: ['Energiatiedot', 'Energy information'], scope1: ['Oma toiminta', 'Our own operations'], scope2: ['Ostettu energia', 'Purchased energy'],
      cat01: ['Ostot', 'Purchases'], cat01_farm: ['Sopimustilat', 'Contract farms'], cat02: ['Investoinnit', 'Capital purchases'],
      cat03: ['Energian toimitusketju', 'Energy supply chains'], transport: ['Kuljetukset', 'Transport'], cat05: ['Jätteet', 'Waste'],
      cat11: ['Tuotteiden käyttö', 'Product use'], factors: ['Päästöjen laskentakertoimet', 'Emissions conversion factors'],
    };
    const affected = [...new Set(r.gaps.map((gap) => areas[gap.area]?.[fi ? 0 : 1] || (fi ? 'Muut laskentatiedot' : 'Other calculation information')))];
    checks.push(fi ? `Puuttuvia tai puutteellisia tietoja: ${affected.join(', ')}.` : `Missing or incomplete information affecting: ${affected.join(', ')}.`);
  }
  if (missing.length) checks.push(fi ? `Ei tuotu: ${missing.map((d) => DATASET_NAMES[d]?.[0] || d).join(', ')}. Puuttuva tieto ei tarkoita nollapäästöjä.` : `Not imported: ${missing.map((d) => DATASET_NAMES[d]?.[1] || d).join(', ')}. Missing data does not mean zero emissions.`);
  if (failedChecks > 0) checks.push(fi ? `${n(failedChecks, 0)} laskennan tarkistusta vaatii selvityksen.` : `${n(failedChecks, 0)} calculation checks need attention.`);
  if (!checks.length) checks.push(fi ? 'Avoimia tarkistuksia tai tietopuutteita ei ole kirjattu.' : 'No open review items or information gaps are recorded.');

  const steps = (ctx.next_steps || []).slice(0, 3);
  const next = steps.length
    ? steps.map((s, i) => `${i + 1}. ${s.found} ${s.suggest}`).join('\n')
    : provisional
      ? fi ? 'Käy avoimet poikkeamat läpi Validointi-sivulla, laske päästöt uudelleen ja luo uusi raportti.' : 'Work through the open incidents in Validation, recalculate, and create a new report.'
      : fi ? 'Tarkista tulos ja lähteet. Nimetty tarkastaja voi sitten hyväksyä raportin.' : 'Review the result and sources. A named reviewer can then approve the report.';
  const revision = comparison.available && comparison.difference_tco2e !== 0
    ? fi ? `Saman vuoden edelliseen vertailukelpoiseen laskelmaan verrattuna: ${signed(comparison.difference_tco2e!, `${n(Math.abs(comparison.difference_tco2e!))} tCO₂e`)}.` : `Compared with the previous like-for-like calculation for ${r.year}: ${signed(comparison.difference_tco2e!, `${n(Math.abs(comparison.difference_tco2e!))} tCO₂e`)}.`
    : null;
  const basis = r.scope2_basis === 'market'
    ? fi ? 'Ostoenergian luku perustuu sopimuksiin ja toimittajatietoihin (markkinaperusteinen Scope 2).' : 'Purchased-energy emissions use supply contracts and supplier information (market-based Scope 2).'
    : fi ? 'Ostoenergian luku perustuu alueelliseen keskimääräiseen energiantuotantoon (sijaintiperusteinen Scope 2).' : 'Purchased-energy emissions use regional average energy production (location-based Scope 2).';
  const scopes = [
    `${fi ? 'Oma toiminta (Scope 1)' : 'Our own operations (Scope 1)'}: ${n(r.totals.scope1_total)} tCO₂e`,
    `${fi ? 'Ostettu energia (Scope 2)' : 'Energy we buy (Scope 2)'}: ${n(r.totals.scope2_reported)} tCO₂e`,
    `${fi ? 'Muut epäsuorat päästöt (Scope 3)' : 'Other indirect emissions (Scope 3)'}: ${n(r.totals.scope3_total)} tCO₂e`,
    basis,
    fi ? 'Vuosimuutos vertaa tallennettuja laskelmia; organisaatiorajausta ei ole tarkistettu.' : 'Year-on-year change compares saved calculations; the organisational boundary has not been reviewed.',
  ].join('\n');
  const sections = [
    { key: 'result', heading: fi ? 'Päätulos' : 'Main result', body: [result, split, yoy, revision, verdict].filter(Boolean).join('\n') },
    { key: 'contributors', heading: fi ? 'Suurimmat lähteet' : 'Largest sources', body: categories.length ? categories.map((item) => `${item.label}: ${n(item.tco2e)} tCO₂e${item.share_pct != null ? ` (${pct(item.share_pct)})` : ''}`).join('\n') : (fi ? 'Päästöluokkien erittelyä ei ole tässä laskelmassa.' : 'No category breakdown is available in this calculation.') },
    { key: 'review', heading: fi ? 'Mitä pitää tarkistaa?' : 'What needs checking', body: checks.join('\n') },
    { key: 'next', heading: fi ? 'Seuraavat askeleet' : 'Next steps', body: next },
    { key: 'coverage', heading: fi ? 'Mitä luku sisältää?' : 'What is included?', body: scopes },
    { key: 'unit', heading: fi ? 'Mitä tCO₂e tarkoittaa?' : 'What does tCO₂e mean?', body: fi ? 'Eri kasvihuonekaasut muunnetaan yhteiseen yksikköön, jotta niitä voidaan laskea yhteen. tCO₂e tarkoittaa hiilidioksidiekvivalenttitonnia.' : 'Different greenhouse gases are expressed in one common unit so they can be added together. tCO₂e means tonnes of carbon dioxide equivalent.' },
  ];
  const technicalSections = [
    { heading: fi ? 'Ostoenergian vaihtoehtoiset laskentatavat' : 'Alternative purchased-energy calculations', body: `Scope 2 location: ${n(r.totals.scope2_location_total)} tCO₂e\nScope 2 market: ${n(r.totals.scope2_market_total)} tCO₂e\n${basis}\n${fi ? 'Vain valittu laskentatapa sisältyy kokonaissummaan.' : 'Only the selected calculation basis is included in the total.'}` },
    { heading: fi ? 'Tallennetun laskelman tiedot' : 'Saved calculation details', body: `${fi ? 'Tunniste' : 'Reference'}: ${r.id}\n${fi ? 'Tallennettu' : 'Saved'}: ${r.created_at}\n${fi ? 'Menetelmäversio' : 'Method version'}: ${r.method_version}\nScope 2: ${r.scope2_basis}\n${fi ? 'Hyväksyttyjä korjauksia tässä laskelmassa' : 'Approved corrections included in this calculation'}: ${r.correction_ids.length}\n${fi ? 'Vertailun tunniste' : 'Comparison reference'}: ${comparison.previous_run_id || '—'}` },
    { heading: fi ? 'Alkuperäiset laskentahuomiot' : 'Original calculation notes', body: r.gaps.map((gap) => `[${gap.area}] ${gap.message}`).join('\n') || (fi ? 'Ei kirjattuja tietopuutteita.' : 'No recorded information gaps.') },
    { heading: fi ? 'Lähdetiedostot' : 'Source files', body: r.dataset_hashes.map((file) => `${file.filename} · ${file.dataset} · SHA-256 ${file.sha256}`).join('\n') },
  ];
  return { sections, technicalSections, result, snapshot: { total_tco2e: total, provisional, review_items: relatedIssues, gap_count: r.gaps.length, estimated_entries: estimated, failed_checks: failedChecks, categories, comparison, prior, open_issue_tco2e: exposure, open_issue_share_pct: share, critical_incidents: critical, missing_activity: missing, next_steps: steps, saved_at: r.created_at } };
}
