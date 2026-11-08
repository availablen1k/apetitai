// Plain-language labels over stored findings. A flag remains a hypothesis until a person reviews it.
const DATASETS = {
  erp_purchase_lines: ['Ostot', 'Purchases'], shipments: ['Kuljetukset', 'Deliveries'], energy_meter_readings: ['Energiamittaukset', 'Energy readings'],
  refrigerant_service_log: ['Kylmäainehuollot', 'Refrigerant servicing'], travel_bookings: ['Liikematkat', 'Business travel'],
  supplier_pcf: ['Toimittajien tuotepäästöt', 'Supplier product footprints'], farm_registry: ['Tilarekisteri', 'Farm register'],
  parcels: ['Peltolohkot', 'Field parcels'], farm_survey: ['Tilakyselyt', 'Farm surveys'], emission_factors: ['Päästöjen laskentakertoimet', 'Emissions conversion factors'],
  fuel_deliveries: ['Polttoainetoimitukset', 'Fuel deliveries'], waste_transfer_notes: ['Jätemerkinnät', 'Waste records'], sales_volumes: ['Tuotemyynti', 'Product sales'],
};
const FIELDS = {
  year: ['Vuosi', 'Year'], month: ['Kuukausi', 'Month'], value: ['Arvo', 'Value'], unit: ['Yksikkö', 'Unit'], quantity: ['Määrä', 'Quantity'],
  pcf_value: ['Tuotteen päästöarvo', 'Product footprint value'], kg_co2e_per_declared_unit: ['Päästöt ilmoitettua yksikköä kohti', 'Emissions per declared unit'],
  t: ['Kuorman paino (tonnia)', 'Load weight (tonnes)'], km: ['Matka (km)', 'Distance (km)'], tkm: ['Kuljetussuorite (tonnikilometriä)', 'Weight × distance (tonne-km)'],
  shipment_id: ['Kuljetuksen viite', 'Delivery reference'], ref_doc: ['Asiakirjan viite', 'Document reference'], direction: ['Kuljetuksen suunta', 'Delivery direction'],
  mode: ['Kuljetustapa', 'Transport type'], ef_id: ['Päästöjen laskentakerroin', 'Emissions conversion factor'], site_id: ['Toimipaikan viite', 'Site reference'],
  carrier: ['Energialähde', 'Energy source'], gas: ['Kylmäaine', 'Refrigerant'], kg: ['Määrä (kg)', 'Amount (kg)'],
  kg_added: ['Lisätty kylmäaine (kg)', 'Refrigerant added (kg)'], kg_recovered: ['Talteen otettu kylmäaine (kg)', 'Refrigerant recovered (kg)'],
  event_id: ['Huollon viite', 'Service reference'], event_date: ['Huoltopäivä', 'Service date'], estimate_basis: ['Mihin ehdotettu arvio perustuu', 'How the suggested estimate was made'],
  supplier_id: ['Toimittajan viite', 'Supplier reference'], material_id: ['Raaka-aineen viite', 'Material reference'], doc_no: ['Asiakirjan numero', 'Document number'],
  lat: ['Leveysaste', 'Latitude'], lon: ['Pituusaste', 'Longitude'], currency: ['Valuutta', 'Currency'], area_ha: ['Pinta-ala (ha)', 'Area (hectares)'],
  yield_t_ha: ['Sato (t/ha)', 'Crop yield (t/ha)'], n_mineral_kg_ha: ['Väkilannoitteen typpi (kg/ha)', 'Mineral nitrogen (kg/ha)'],
  n_manure_kg_ha: ['Lannan typpi (kg/ha)', 'Manure nitrogen (kg/ha)'], p_kg_ha: ['Fosfori (kg/ha)', 'Phosphorus (kg/ha)'],
  diesel_l_ha: ['Dieselin käyttö (l/ha)', 'Diesel use (litres/ha)'], lime_t_ha: ['Kalkitus (t/ha)', 'Lime use (t/ha)'],
  soil_type_reported: ['Ilmoitettu maalaji', 'Reported soil type'], catch_crop_share: ['Kerääjäkasvien osuus', 'Cover crop share'],
  crop: ['Viljelykasvi', 'Crop'], farm_id: ['Tilan viite', 'Farm reference'], survey_id: ['Kyselyn viite', 'Survey reference'],
};
export const datasetName = (id, lang = 'en') => DATASETS[id]?.[lang === 'fi' ? 0 : 1] || String(id || '').replace(/_/g, ' ');
export const fieldName = (id, lang = 'en') => FIELDS[id]?.[lang === 'fi' ? 0 : 1] || String(id || '').replace(/_/g, ' ');
export const priorityName = (severity, lang = 'en') => (lang === 'fi'
  ? { critical: 'Kriittinen', high: 'Korkea', medium: 'Keskitaso', low: 'Matala' }
  : { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' })[severity] || severity;
export const reviewStatus = (issue, lang = 'en') => {
  if (issue.status === 'open') return lang === 'fi' ? 'Odottaa tarkistusta' : 'Needs checking';
  if (issue.status === 'approved') return lang === 'fi' ? 'Päätös tallennettu' : 'Decision saved';
  if (issue.status === 'rejected') return lang === 'fi' ? 'Suljettu ilman muutosta' : 'Closed without a change';
  return issue.status;
};

export function reviewGuidance(issue, lang = 'en') {
  const fi = lang === 'fi';
  if (issue.action === 'exclude_record') return fi
    ? { why: 'Tämä merkintä voi olla toisen merkinnän kaksoiskappale. Vertaa viitteitä, päivämääriä ja määriä.', next: 'Tarkista alkuperäiset tiedot ennen kuin jätät merkinnän pois laskennasta.' }
    : { why: 'This entry may describe the same activity as another entry. Compare references, dates and amounts.', next: 'Check the original information before leaving an entry out of the calculation.' };
  if (issue.action === 'add_record') return fi
    ? { why: 'Osa tapahtuman tiedoista saattaa puuttua. Ehdotettu lisäys pitää varmistaa lähdeasiakirjoista.', next: 'Tarkista toimitusasiakirjat ja lisää vain varmistetut puuttuvat tiedot.' }
    : { why: 'Part of the activity information may be missing. The suggested addition needs supporting documents.', next: 'Check the delivery documents and add only confirmed missing information.' };
  if (issue.rule_id?.startsWith('agent.')) return fi
    ? { why: 'Automaattinen tarkistus löysi poikkeavaa tietoa. Se voi olla oikein, mutta tarvitsee ihmisen tarkistuksen.', next: 'Vertaa tietoa alkuperäiseen asiakirjaan. Jos oikea arvo ei ole tiedossa, pyydä lisätietoa.' }
    : { why: 'An automated check found unusual information. It may be correct, but a person needs to check it.', next: 'Compare it with the original document. If the correct value is unclear, ask for more information.' };
  if (/unit|decimal|spike|pcf/.test(issue.issue_type || '')) return fi
    ? { why: 'Arvo, yksikkö tai ajanjakso voi poiketa vertailutiedoista. Tarkistus ei vielä vahvista virhettä.', next: 'Tarkista luku, yksikkö ja ajanjakso laskusta, mittariraportista tai toimittajan ilmoituksesta.' }
    : { why: 'The value, unit or reporting period may differ from the comparison information. This flag does not establish an error.', next: 'Check the number, unit and period against the invoice, meter statement or supplier declaration.' };
  return fi
    ? { why: 'Merkinnän tiedot tarvitsevat tarkistuksen ennen kuin niihin voi luottaa raportoinnissa.', next: 'Avaa alkuperäiset tiedot ja niitä tukevat asiakirjat. Tallenna muutos vain, kun se on varmistettu.' }
    : { why: 'Some information in this entry needs checking before it can be relied on in a report.', next: 'Read the original entry and supporting documents. Save a change only after confirming it.' };
}
