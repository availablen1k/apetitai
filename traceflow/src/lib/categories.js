// Labels for GHG inventory categories (ids match the calculation engine and the challenge benchmark).
export const CATEGORY_LABELS = {
  stationary_and_mobile_combustion: { fi: 'Polttoaineiden palaminen', en: 'Fuel combustion' },
  fugitive_refrigerants: { fi: 'Kylmäainevuodot', en: 'Refrigerant leakage' },
  purchased_electricity: { fi: 'Ostosähkö', en: 'Purchased electricity' },
  purchased_heat_steam: { fi: 'Ostolämpö ja -höyry', en: 'Purchased heat and steam' },
  cat01_purchased_goods: { fi: 'Ostetut tuotteet ja raaka-aineet', en: 'Purchased goods and raw materials' },
  cat01_purchased_services: { fi: 'Ostetut palvelut', en: 'Purchased services' },
  cat02_capital_goods: { fi: 'Investointihyödykkeet', en: 'Capital goods' },
  cat03_fuel_energy: { fi: 'Polttoaineiden ja energian tuotantoketjut', en: 'Fuel and energy supply chains' },
  cat04_upstream_transport: { fi: 'Saapuvat kuljetukset', en: 'Inbound transport' },
  cat05_waste: { fi: 'Jätteet', en: 'Waste' },
  cat06_business_travel: { fi: 'Liikematkat', en: 'Business travel' },
  cat07_employee_commuting: { fi: 'Kodin ja työpaikan väliset matkat', en: 'Employee commuting' },
  cat09_downstream_transport: { fi: 'Lähtevät kuljetukset', en: 'Outbound transport' },
  cat11_use_of_sold_products: { fi: 'Myytyjen tuotteiden käyttö', en: 'Use of sold products' },
  cat12_end_of_life: { fi: 'Myytyjen tuotteiden elinkaaren loppu', en: 'End of life of sold products' },
  biogenic_co2_scope1: { fi: 'Biogeeninen CO₂ (muistio)', en: 'Biogenic CO₂ (memo)' },
};

export const SCOPE_LABELS = {
  scope1: { fi: 'Scope 1', en: 'Scope 1' },
  scope2_location: { fi: 'Scope 2 sijaintiperusteinen', en: 'Scope 2 location-based' },
  scope2_market: { fi: 'Scope 2 markkinaperusteinen', en: 'Scope 2 market-based' },
  scope3: { fi: 'Scope 3', en: 'Scope 3' },
  memo: { fi: 'Muistio', en: 'Memo' },
};

export const catLabel = (c, lang = 'fi') => CATEGORY_LABELS[c]?.[lang] || c;
export const scopeName = (s, lang = 'fi') => SCOPE_LABELS[s]?.[lang] || s;

// Run category rows → the line shape used by the existing charts.
export const runLines = (run) =>
  ((run?.completeness?.by_category) || []).map((c) => ({
    id: `${c.scope}|${c.category}`,
    scope: c.scope,
    category: c.category,
    label: CATEGORY_LABELS[c.category]?.fi || c.category,
    label_en: CATEGORY_LABELS[c.category]?.en || c.category,
    tco2e: c.tco2e,
    count: c.count,
    in_total: c.in_total,
    status: c.in_total ? 'final' : 'insufficient',
  }));
