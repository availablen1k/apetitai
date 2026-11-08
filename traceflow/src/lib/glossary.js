// Plain-language layer: region codes, scenario codes and the technical terms
// shown in the UI, each with a short explanation for non-specialist readers.

export const REGIONS = {
  FI_SW: { fi: 'Varsinais-Suomi', en: 'Southwest Finland' },
  SE_SKANE: { fi: 'Skåne', en: 'Skåne' },
  FI: { fi: 'Suomi', en: 'Finland' },
  SE: { fi: 'Ruotsi', en: 'Sweden' },
};

export const regionName = (code, lang = 'fi') => {
  if (!code) return '—';
  const hit = REGIONS[code];
  return hit ? hit[lang] || hit.fi : code.replace(/_/g, ' ');
};

export const SCENARIOS = [
  { id: 'ssp126', code: 'SSP1-2.6', label: { fi: 'Matalat päästöt', en: 'Low emissions' } },
  { id: 'ssp245', code: 'SSP2-4.5', label: { fi: 'Nykyinen kehitys', en: 'Current trajectory' } },
  { id: 'ssp585', code: 'SSP5-8.5', label: { fi: 'Korkeat päästöt', en: 'High emissions' } },
];

export const scenarioLabel = (id, lang = 'fi') => {
  const hit = SCENARIOS.find((s) => s.id === id);
  if (!hit) return id === 'historical' ? (lang === 'fi' ? 'Toteutunut' : 'Observed') : id;
  return hit.label[lang] || hit.label.fi;
};

export const RISK_LABELS = {
  high: { fi: 'Korkea riski', en: 'High risk' },
  medium: { fi: 'Keskitaso riski', en: 'Medium risk' },
  low: { fi: 'Matala riski', en: 'Low risk' },
};

export const riskLabel = (level, lang = 'fi') => {
  const hit = RISK_LABELS[level];
  return hit ? hit[lang] || hit.fi : level || '—';
};

export const SCOPE_LABELS = {
  scope1: { fi: 'Omat päästöt', en: 'Own emissions' },
  scope2_market: { fi: 'Ostoenergia (markkina)', en: 'Purchased energy (market)' },
  scope2_location: { fi: 'Ostoenergia (sijainti)', en: 'Purchased energy (location)' },
  scope3: { fi: 'Arvoketju', en: 'Value chain' },
};

export const scopeLabel = (scope, lang = 'fi') => {
  const hit = SCOPE_LABELS[scope];
  return hit ? hit[lang] || hit.fi : (scope || '').replace(/_/g, ' ');
};

export const SEVERITY_LABELS = {
  high: { fi: 'Kiireellinen', en: 'Urgent' },
  medium: { fi: 'Seurattava', en: 'Watch' },
  low: { fi: 'Vähäinen', en: 'Minor' },
};

export const severityLabel = (level, lang = 'fi') => {
  const hit = SEVERITY_LABELS[level];
  return hit ? hit[lang] || hit.fi : level || '—';
};

// concept -> { term, text } in both languages
const CONCEPTS = {
  area: {
    fi: { term: 'Hehtaari (ha)', text: 'Hehtaari on 10 000 neliömetriä eli sata aaria. Peltoalat ilmoitetaan hehtaareina.' },
    en: { term: 'Hectare (ha)', text: 'A hectare is 10,000 square metres. Field areas are given in hectares.' },
  },
  yield: {
    fi: { term: 'Sato tonnia hehtaarilta', text: 'Kertoo, montako tonnia satoa saadaan yhdeltä hehtaarilta. Suurempi luku on parempi.' },
    en: { term: 'Yield in tonnes per hectare', text: 'How many tonnes of harvest come from one hectare. A larger number is better.' },
  },
  drought: {
    fi: { term: 'Kuivuusriski', text: 'Asteikko 0–100. Mitä suurempi luku, sitä todennäköisemmin pellolla kärsitään kuivuudesta kasvukaudella.' },
    en: { term: 'Drought risk', text: 'Scale 0–100. The higher the number, the more likely the field suffers from drought during the growing season.' },
  },
  nutrient: {
    fi: { term: 'Ravinneriski', text: 'Asteikko 0–100. Kuvaa, miten helposti ravinteita valuu pelloilta vesistöihin.' },
    en: { term: 'Nutrient risk', text: 'Scale 0–100. How easily nutrients run off the fields into waterways.' },
  },
  p_test: {
    fi: { term: 'Fosforiluku (P, mg/l)', text: 'Maa-analyysin fosforipitoisuus. Korkea luku tarkoittaa suurempaa fosforin valumisriskiä.' },
    en: { term: 'Phosphorus test (P, mg/l)', text: 'Phosphorus level from the soil analysis. A high level means a higher risk of phosphorus runoff.' },
  },
  gdd: {
    fi: { term: 'Kasvuastepäivä (GDD)', text: 'Päivän keskilämpötila 5 °C:n yläpuolella lasketaan kasvua edistäväksi asteiksi. Mitä enemmän asteita, sitä pidemmälle kasvi ehtii kehittyä.' },
    en: { term: 'Growing degree day (GDD)', text: 'Each degree of a day’s mean temperature above 5 °C counts as growth energy. More degree days means the crop can develop further.' },
  },
  pet: {
    fi: { term: 'Haihdunta (PET)', text: 'Potentiaalinen haihdunta eli vesimäärä, joka haihtuu maasta ja kasveista, jos vettä riittää.' },
    en: { term: 'Evapotranspiration (PET)', text: 'Potential evapotranspiration: the water that evaporates from soil and plants when water is available.' },
  },
  frost_free: {
    fi: { term: 'Hallaton jakso', text: 'Aika viimeisestä keväthallasta ensimmäiseen syyshallaan. Pidempi jakso antaa kasville enemmän aikaa.' },
    en: { term: 'Frost-free period', text: 'The time from the last spring frost to the first autumn frost. A longer period gives crops more time.' },
  },
  water_balance: {
    fi: { term: 'Vesitase', text: 'Sade miinus haihdunta. Negatiivinen luku tarkoittaa, että vettä kuluu enemmän kuin sitä tulee.' },
    en: { term: 'Water balance', text: 'Rainfall minus evapotranspiration. A negative figure means more water is used than arrives.' },
  },
  heat_days: {
    fi: { term: 'Helteinen päivä', text: 'Päivä, jolloin ylin lämpötila on vähintään 27 °C. Helteet rasittavat kasveja ja lisäävät haihduntaa.' },
    en: { term: 'Heat day', text: 'A day when the maximum temperature reaches 27 °C. Heat stresses crops and increases evaporation.' },
  },
  tco2e: {
    fi: { term: 'Hiilidioksidiekvivalenttitonni (tCO₂e)', text: 'Eri kasvihuonekaasut muunnettuna samaan yksikköön, jotta niitä voi laskea yhteen.' },
    en: { term: 'Tonne of CO₂ equivalent (tCO₂e)', text: 'Different greenhouse gases converted into one unit so they can be added up.' },
  },
  scope1: {
    fi: { term: 'Scope 1 – omat suorat päästöt', text: 'Päästöt omasta toiminnasta: polttoaineet, kylmäaineet ja oma kalusto.' },
    en: { term: 'Scope 1 – own direct emissions', text: 'Emissions from your own operations: fuels, refrigerants and own vehicles.' },
  },
  scope2: {
    fi: { term: 'Scope 2 – ostoenergia', text: 'Ostetun sähkön ja lämmön tuottamisen päästöt.' },
    en: { term: 'Scope 2 – purchased energy', text: 'Emissions from producing the electricity and heat you buy.' },
  },
  scope3: {
    fi: { term: 'Scope 3 – arvoketju', text: 'Epäsuorat päästöt toimitusketjusta: hankinnat, kuljetukset, jätteet ja matkustus.' },
    en: { term: 'Scope 3 – value chain', text: 'Indirect emissions from the supply chain: procurement, transport, waste and travel.' },
  },
  ssp: {
    fi: { term: 'SSP-skenaario', text: 'Vaihtoehtoja maailman päästökehitykselle. Pienempi numero tarkoittaa vähäisempiä päästöjä ja vähäisempää lämpenemistä.' },
    en: { term: 'SSP scenario', text: 'Alternative paths for global emissions. A lower number means lower emissions and less warming.' },
  },
  risk: {
    fi: { term: 'Riskitaso', text: 'Yhdistää kuivuus- ja ravinnetekijät sekä satotason kolmeen luokkaan: korkea, keskitaso tai matala.' },
    en: { term: 'Risk level', text: 'Combines drought, nutrient and yield factors into three levels: high, medium or low.' },
  },
  organic_share: {
    fi: { term: 'Eloperäinen maa', text: 'Turve- ja multamaat. Ne sitovat paljon hiiltä, mutta niistä syntyy myös enemmän päästöjä viljelyssä.' },
    en: { term: 'Organic soil', text: 'Peat and mull soils. They store a lot of carbon but also release more emissions when cultivated.' },
  },
  buffer_strip: {
    fi: { term: 'Puskurikaista', text: 'Vesistön reunaan jätettävä kasvipeitteinen kaista, joka estää ravinteiden ja maa-aineksen valumista.' },
    en: { term: 'Buffer strip', text: 'A vegetated strip left along a waterway that keeps nutrients and soil from running off.' },
  },
  catchment: {
    fi: { term: 'Valuma-alue', text: 'Alue, jolta vedet valuvat samaan jokeen, järveen tai mereen.' },
    en: { term: 'Catchment', text: 'The area whose water drains into the same river, lake or sea.' },
  },
  completeness: {
    fi: { term: 'Datan kattavuus', text: 'Osuus tarvittavista tiedoista, jotka ovat jo käytettävissä laskennassa.' },
    en: { term: 'Data completeness', text: 'The share of the required data that is already available for the calculation.' },
  },
};

export default CONCEPTS;