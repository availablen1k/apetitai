// Method constants of the challenge reference calculator, copied from
// tools/ccn_tools/factors.py and docs/METHODOLOGY.md of the Apetit × Since AI 2026 package.
// They are versioned so every calculation run records which constants it used.
// Activity-specific emission factors (kg CO2e per unit) are NOT here: they come from the
// imported emission_factor_library.csv so each one traces to a source row.

export const METHOD_VERSION = 'traceflow-ghg-1.1 (site/year electricity factors; reference: ccn_tools/reference_calculator.py, METHODOLOGY.md 2026-11-04)';
export const METHOD_SOURCE = 'Apetit × Since AI 2026 challenge package: tools/ccn_tools/factors.py';

export const GRID_FI_LB: Record<number, number> = { 2019: 0.09, 2020: 0.068, 2021: 0.075, 2022: 0.066, 2023: 0.038, 2024: 0.03, 2025: 0.026 };
export const RESIDUAL_FI: Record<number, number> = { 2019: 0.354, 2020: 0.37, 2021: 0.38, 2022: 0.39, 2023: 0.4, 2024: 0.406, 2025: 0.406 };
export const GRID_SE_LB: Record<number, number> = { 2019: 0.012, 2020: 0.012, 2021: 0.012, 2022: 0.012, 2023: 0.012, 2024: 0.012, 2025: 0.012 };
export const RESIDUAL_SE: Record<number, number> = { 2019: 0.04, 2020: 0.045, 2021: 0.04, 2022: 0.04, 2023: 0.038, 2024: 0.036, 2025: 0.035 };
export const HEAT_LB_EF: Record<number, number> = { 2019: 0.16, 2020: 0.15, 2021: 0.15, 2022: 0.14, 2023: 0.13, 2024: 0.12, 2025: 0.11 };

// t CO2 per MWh (fossil part only); biogenic CO2 is a memo item.
export const FUEL_EF_T_PER_MWH: Record<string, number> = {
  natural_gas: 0.2009, lng: 0.1991, lpg: 0.2336, light_fuel_oil: 0.2668, heavy_fuel_oil: 0.284, diesel: 0.211,
  milled_peat: 0.3874, wood_chips: 0, wood_pellets: 0, biogas: 0, hvo: 0, oilseed_sidestream: 0,
};
export const FUEL_BIOGENIC_T_PER_MWH: Record<string, number> = {
  wood_chips: 0.4032, wood_pellets: 0.4032, biogas: 0.198, hvo: 0.264, oilseed_sidestream: 0.45, diesel: 0.035,
};
export const REFRIGERANT_GWP: Record<string, number> = {
  R717_ammonia: 0, R744_co2: 1, R404A: 4728, R507A: 4775, R449A: 1504, R410A: 2256, R134a: 1530, R32: 771,
};
// MWh per native unit (METHODOLOGY §2 canonical energy table).
export const NCV: Record<string, { unit: string; mwh_per_unit: number }> = {
  lng: { unit: 't', mwh_per_unit: 13.5 },
  lpg: { unit: 't', mwh_per_unit: 12.8 },
  light_fuel_oil: { unit: 'l', mwh_per_unit: 0.01 },
  diesel: { unit: 'l', mwh_per_unit: 0.0099 },
  hvo: { unit: 'l', mwh_per_unit: 0.0095 },
  wood_chips: { unit: 'm3', mwh_per_unit: 0.8 },
};
export const FUEL_WTT: Record<string, string> = {
  lng: 'EF-WTT-LNG', lpg: 'EF-WTT-LPG', light_fuel_oil: 'EF-WTT-LFO', diesel: 'EF-WTT-DIESEL', natural_gas: 'EF-WTT-NG',
  wood_chips: 'EF-WTT-WOOD', oilseed_sidestream: 'EF-WTT-WOOD', biogas: 'EF-WTT-BIOGAS', hvo: 'EF-WTT-HVO',
};
export const NON_FUEL_CARRIERS = new Set(['electricity', 'steam', 'district_heat']);
export const HEAT_CARRIERS = new Set(['steam', 'district_heat']);

export const FX_PER_EUR: Record<string, number> = { EUR: 1, SEK: 11.4, USD: 1.08 };

export const FARM_EF = {
  ef1_synthetic: 0.016, ef1_organic: 0.006, frac_gasf: 0.05, frac_gasm: 0.21, frac_leach: 0.24, ef4_n2o_n: 0.014, ef5_n2o_n: 0.011,
  n2o_gwp: 273, n2o_n_to_n2o: 44 / 28, fert_n_prod: 3.7, fert_n_prod_lowcarbon: 0.9, fert_p_prod: 1.6, fert_k_prod: 0.5,
  diesel_ttw: 2.1, diesel_wtt: 0.61, lime: 0.44, org_soil_co2_t_ha: 29.0, org_soil_co2_grass_t_ha: 20.9, org_soil_n2o_n_kg_ha: 13.0,
  spray_pass: 8.0, irrigation_kwh_ha: 180,
};
export const MGMT_NORMS: Record<string, { n: number; p: number; diesel: number; lime: number; kwh_t: number; irr: number; sprays: number }> = {
  pea: { n: 25, p: 12, diesel: 85, lime: 0.35, kwh_t: 8, irr: 0.1, sprays: 2 },
  potato: { n: 95, p: 35, diesel: 170, lime: 0.35, kwh_t: 35, irr: 0.55, sprays: 8 },
  carrot: { n: 100, p: 30, diesel: 160, lime: 0.35, kwh_t: 30, irr: 0.6, sprays: 5 },
  spinach: { n: 130, p: 20, diesel: 110, lime: 0.35, kwh_t: 6, irr: 0.7, sprays: 2 },
  turnip_rape: { n: 95, p: 15, diesel: 75, lime: 0.35, kwh_t: 45, irr: 0, sprays: 3 },
  barley: { n: 95, p: 12, diesel: 80, lime: 0.35, kwh_t: 60, irr: 0, sprays: 2 },
  oats: { n: 85, p: 12, diesel: 80, lime: 0.35, kwh_t: 60, irr: 0, sprays: 1 },
  wheat: { n: 120, p: 14, diesel: 85, lime: 0.35, kwh_t: 60, irr: 0, sprays: 3 },
  grass_ley: { n: 150, p: 15, diesel: 95, lime: 0.35, kwh_t: 0, irr: 0, sprays: 0 },
  fallow: { n: 0, p: 0, diesel: 15, lime: 0, kwh_t: 0, irr: 0, sprays: 0 },
};
export const RESIDUE_N_PER_T: Record<string, number> = {
  pea: 6.0, potato: 1.2, carrot: 1.0, spinach: 1.5, turnip_rape: 18.0, barley: 6.5, oats: 7.0, wheat: 6.5, grass_ley: 3.0, fallow: 0,
};
// Contract-farming material → crop of the farm survey (materials.csv name_en).
export const FARM_MATERIAL_CROP: Record<string, string> = { M100: 'turnip_rape', M110: 'pea', M111: 'potato', M112: 'carrot', M113: 'spinach', M114: 'pea' };

export const USE_PHASE_KWH_PER_KG: Record<string, number> = {
  frozen_vegetables: 0.71, ready_meals_frozen: 0.96, fish_products: 0.96, frozen_pizza: 1.81,
  rapeseed_oil_bottled: 0, rapeseed_oil_bulk: 0, rapeseed_meal_expeller: 0, blackgrain_powder: 0,
};
export const PACK_KG_PER_T: Record<string, [number, number]> = {
  frozen_vegetables: [19, 32], ready_meals_frozen: [24, 60], fish_products: [22, 55], frozen_pizza: [14, 85],
  rapeseed_oil_bottled: [52, 18], rapeseed_oil_bulk: [0.6, 0], rapeseed_meal_expeller: [0, 0], blackgrain_powder: [30, 20],
};
export const EOL_PLASTIC_EF_T = 1.40485;
export const EOL_BOARD_EF_T = 0.07935;
export const MARKET_GRID = (market: string, year: number): number | null => {
  if (market === 'FI') return GRID_FI_LB[year] ?? null;
  if (market === 'SE') return GRID_SE_LB[year] ?? null;
  if (market === 'EXPORT_EU') return 0.23;
  return null;
};

// Waste stream + treatment → treatment factor in emission_factor_library.csv.
export const WASTE_EF: Record<string, string> = {
  'mixed_waste|incineration': 'EF-WASTE-MIXED-INC',
  'plastic_waste|incineration': 'EF-WASTE-PLASTIC-INC',
  'vegetable_biowaste|anaerobic_digestion': 'EF-WASTE-BIO-AD',
  'food_waste|anaerobic_digestion': 'EF-WASTE-BIO-AD',
  'wwtp_sludge|composting': 'EF-WASTE-BIO-COMPOST',
  'biowaste_mixed|composting': 'EF-WASTE-BIO-COMPOST',
  'cardboard|recycling': 'EF-WASTE-RECYCLE',
  'spent_bleaching_earth|landfill_codigestion': 'EF-WASTE-SPENTEARTH',
};

// Commuting: weeks per year on site and mode factors (EV car fixed 0.03 kg/pkm in the reference).
export const COMMUTE_WEEKS = 46;

// Organisational boundary (operational control), METHODOLOGY §1: Foodhills (S-BJU) is
// included from December 2025; earlier S-BJU activity is outside the 2025 inventory.
export const SITE_BOUNDARY: Record<string, { from: string }> = { 'S-BJU': { from: '2025-12' } };

export const TRANSPORT_MODE_EF: Record<string, string> = {
  truck: 'EF-TKM-TRUCK', 'truck-reefer': 'EF-TKM-TRUCK-REEFER', 'truck-hvo': 'EF-TKM-TRUCK-HVO', ropax: 'EF-TKM-ROPAX',
  'ship-reefer': 'EF-TKM-SHIP-REEFER', 'ship-bulk': 'EF-TKM-SHIP-BULK', rail: 'EF-TKM-RAIL',
};
export const SEA_MODES = new Set(['ropax', 'ship-reefer', 'ship-bulk']);

export const METHOD_CONSTANTS_SNAPSHOT = {
  version: METHOD_VERSION,
  source: METHOD_SOURCE,
  grid_fi: GRID_FI_LB, residual_fi: RESIDUAL_FI, grid_se: GRID_SE_LB, residual_se: RESIDUAL_SE, heat_location: HEAT_LB_EF,
  fuel_fossil: FUEL_EF_T_PER_MWH, fuel_biogenic: FUEL_BIOGENIC_T_PER_MWH, refrigerant_gwp: REFRIGERANT_GWP, ncv: NCV, fx: FX_PER_EUR,
  farm: FARM_EF, boundary: SITE_BOUNDARY,
};
