export const unwrap = (r) => (Array.isArray(r) ? r : r?.items || []);

let LOCALE = 'fi-FI';

export const setLocale = (lang) => {
  LOCALE = lang === 'en' ? 'en-GB' : 'fi-FI';
};

export const nf = (n, d = 0) =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: d, minimumFractionDigits: d }).format(Number(n) || 0);

export const pct = (n, d = 0) => {
  const v = nf(n, d);
  return LOCALE === 'en-GB' ? `${v}%` : `${v} %`;
};

export const shortDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const ISSUE_LABELS = {
  ai_suspicious_input: { fi: 'Poikkeava tieto tarvitsee tarkistuksen', en: 'Unusual information to check' },
  unit_error: { fi: 'Tarkista arvo ja yksikkö', en: 'Check the value and unit' },
  decimal_shift: { fi: 'Luku voi olla väärässä mittakaavassa', en: 'The number may use the wrong scale' },
  meter_spike: { fi: 'Tavallista suurempi mittarilukema', en: 'Unusually high meter reading' },
  duplicate_record: { fi: 'Mahdollinen kaksoiskappale', en: 'Possible duplicate entry' },
  currency_error: { fi: 'Tarkista valuutta', en: 'Check the currency' },
  double_counting: { fi: 'Tämä voi tulla lasketuksi kahdesti', en: 'This may be counted twice' },
  unknown_source_reference: { fi: 'Tuntematon viitetieto', en: 'Unknown reference' },
  outlier_implausible: { fi: 'Epäuskottava arvo', en: 'Implausible value' },
  missing_record: { fi: 'Puuttuva rivi', en: 'Missing row' },
  missing_value: { fi: 'Puuttuva arvo', en: 'Missing value' },
  invalid_unit: { fi: 'Virheellinen yksikkö', en: 'Invalid unit' },
  impossible_date: { fi: 'Virheellinen päivä', en: 'Impossible date' },
  certificate_mismatch: { fi: 'Sertifikaattien täsmäytys', en: 'Certificate mismatch' },
  total_mismatch: { fi: 'Summa ei täsmää', en: 'Totals do not match' },
  soil_misreport: { fi: 'Maalajitieto ristiriidassa', en: 'Soil class conflict' },
  area_mismatch: { fi: 'Pinta-alatieto ristiriidassa', en: 'Area conflict' },
  missing_emissions_factor: { fi: 'Puuttuva päästökerroin', en: 'Missing emission factor' },
  wrong_gas_code: { fi: 'Tuntematon kylmäaine', en: 'Unknown refrigerant' },
  pcf_unit_error: { fi: 'Tarkista toimittajan päästöarvon yksikkö', en: 'Check the supplier footprint unit' },
  pcf_stale_period: { fi: 'Toimittajan päästötieto voi olla vanhentunut', en: 'Supplier footprint information may be out of date' },
  material_mismatch: { fi: 'Materiaalitieto ristiriidassa', en: 'Material conflict' },
  coordinate_swap: { fi: 'Koordinaatit väärin päin', en: 'Swapped coordinates' },
  missing_leg: { fi: 'Osa kuljetuksesta voi puuttua', en: 'Part of the delivery journey may be missing' },
  mode_mislabel: { fi: 'Kerroin ei vastaa kulkumuotoa', en: 'Factor does not match mode' },
  conflicting_record: { fi: 'Ristiriitainen rivi', en: 'Conflicting row' },
  outdated_data: { fi: 'Vanhentunut tieto', en: 'Outdated data' },
  unknown_reference: { fi: 'Tuntematon viite', en: 'Unknown reference' },
  missing_factor: { fi: 'Puuttuva kerroin', en: 'Missing factor' },
};

export const issueLabel = (code, lang = 'fi') => {
  const hit = ISSUE_LABELS[code];
  return hit ? hit[lang] || hit.fi : (code || '').replace(/_/g, ' ');
};
export const tco2 = (n, d = 1) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : nf(n, d));
export const shortId = (id) => (id ? String(id).slice(0, 14) : '—');
