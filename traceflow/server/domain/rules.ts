// Deterministic data-quality rules. Each finding has a rule id + version, the exact record
// and field, observed and candidate values, the evidence record ids used, a severity and a
// confidence. Candidates are proposals only: nothing changes until a person approves it.
// Rules run on the original imported values (never on corrected values).
import type { Src } from './inventory.ts';
import { SEA_MODES, TRANSPORT_MODE_EF, REFRIGERANT_GWP } from './method.ts';
import { groupBy, median, parseNumber, round } from './util.ts';

export const RULES_VERSION = 'r1.0';

export type Action = 'set_value' | 'exclude_record' | 'add_record' | 'acknowledge';

export type Finding = {
  rule_id: string;
  issue_type: string;
  category: 'transport' | 'erp_pcf' | 'agriculture' | 'energy' | 'accounting' | 'other';
  table: string;
  record_id: string | null;
  record_key: string;
  year: number | null;
  field: string | null;
  observed: string | null;
  candidate: string | null;
  candidate_unit: string | null;
  action: Action;
  evidence_ids: string[];
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  impact: 'high' | 'normal';
  fi: string;
  en: string;
};

export type RuleTables = Record<string, Src[]>;

const n = (v: unknown) => parseNumber(v);
const fmt = (v: number, d = 3) => String(round(v, d));
const ratio = (a: number, b: number) => (b ? a / b : Infinity);
const near = (x: number, target: number, tol: number) => x >= target * (1 - tol) && x <= target * (1 + tol);

type Partial = Omit<Finding, 'table' | 'record_id' | 'record_key' | 'year' | 'impact'> & { impact?: Finding['impact'] };

function on(rec: Src, p: Partial): Finding {
  return { table: rec.table, record_id: rec.id, record_key: rec.record_key, year: rec.year, impact: 'normal', ...p };
}

// ---------------------------------------------------------------- energy
function energyRules(T: RuleTables, out: Finding[]) {
  const rows = T.energy_meter_readings || [];
  const series = groupBy(rows, (r) => `${r.payload.site_id}|${r.payload.carrier}`);
  for (const [, list] of series) {
    const vals = list.map((r) => n(r.payload.value)).filter((v): v is number => v !== null && v > 0);
    const med = median(vals);
    const byMonth = groupBy(list, (r) => String(Number(r.payload.month)));
    for (const r of list) {
      const p = r.payload;
      const v = n(p.value);
      if (v === null) {
        out.push(on(r, { rule_id: 'energy.value_present', issue_type: 'missing_value', category: 'energy', field: 'value', observed: '', candidate: null, candidate_unit: 'MWh', action: 'acknowledge', evidence_ids: [r.id], severity: 'high', confidence: 0.99, fi: 'Mittarilukema puuttuu; kuukauden energiaa ei voi laskea.', en: 'The meter reading is empty; the month cannot be calculated.' }));
        continue;
      }
      if (p.unit !== 'MWh') {
        out.push(on(r, { rule_id: 'energy.unit_mwh', issue_type: 'unit_error', category: 'energy', field: 'unit', observed: p.unit, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [r.id], severity: 'medium', confidence: 0.9, fi: `Yksikkö ${p.unit} ei ole MWh.`, en: `Unit ${p.unit} is not MWh.` }));
      }
      if (med > 0 && v >= med * 300 && near(v / 1000 / med, 1, 0.7)) {
        out.push(on(r, { rule_id: 'energy.kwh_in_mwh_column', issue_type: 'unit_error', category: 'energy', field: 'value', observed: String(v), candidate: fmt(v / 1000), candidate_unit: 'MWh', action: 'set_value', evidence_ids: [r.id, ...list.filter((x) => x.id !== r.id).slice(0, 6).map((x) => x.id)], severity: 'high', impact: 'high', confidence: 0.95,
          fi: `Lukema ${v} on ${fmt(v / med, 0)}× saman kohteen ja energiamuodon mediaani (${fmt(med, 1)} MWh). Arvo/1000 = ${fmt(v / 1000)} sopii sarjaan: kWh kirjattu MWh-sarakkeeseen.`,
          en: `Reading ${v} is ${fmt(v / med, 0)}× the site/carrier median (${fmt(med, 1)} MWh). Value/1000 = ${fmt(v / 1000)} fits the series: kWh entered in the MWh column.` }));
        continue;
      }
      // Values far above the series that are not a clean ×1000 unit slip (compound errors).
      if (med > 0 && v >= med * 300) {
        const others = (byMonth.get(String(Number(p.month))) || []).filter((x) => x.id !== r.id).map((x) => n(x.payload.value)).filter((x): x is number => x !== null && x > 0 && x < med * 300);
        const est = others.length ? median(others) : med;
        out.push(on(r, { rule_id: 'energy.extreme_outlier', issue_type: 'meter_spike', category: 'energy', field: 'value', observed: String(v), candidate: fmt(est), candidate_unit: 'MWh', action: 'set_value', evidence_ids: [r.id, ...(byMonth.get(String(Number(p.month))) || []).filter((x) => x.id !== r.id).map((x) => x.id)], severity: 'high', impact: 'high', confidence: 0.7,
          fi: `Lukema ${v} on ${fmt(v / med, 0)}× sarjan mediaani eikä selity pelkällä kWh/MWh-sekaannuksella. Ehdotus ${fmt(est, 1)} MWh on saman kuukauden mediaani (arvio).`,
          en: `Reading ${v} is ${fmt(v / med, 0)}× the series median and is not explained by a kWh/MWh slip alone. Candidate ${fmt(est, 1)} MWh is the same-month median (an estimate).` }));
        continue;
      }
      // Seasonality-aware spike: compare with the same month in other years.
      const sameMonth = (byMonth.get(String(Number(p.month))) || []).filter((x) => x.id !== r.id && x.payload.year !== p.year).map((x) => n(x.payload.value)).filter((x): x is number => x !== null && x > 0 && x < med * 300);
      if (sameMonth.length >= 2) {
        const mm = median(sameMonth);
        if (mm > 0 && v > mm * 2.5 && v < mm * 300) {
          out.push(on(r, { rule_id: 'energy.spike_vs_same_month', issue_type: 'meter_spike', category: 'energy', field: 'value', observed: String(v), candidate: fmt(mm), candidate_unit: 'MWh', action: 'set_value', evidence_ids: [r.id, ...(byMonth.get(String(Number(p.month))) || []).filter((x) => x.id !== r.id).map((x) => x.id)], severity: 'high', impact: 'high', confidence: 0.75,
            fi: `Lukema ${v} MWh on ${fmt(v / mm, 1)}× saman kuukauden mediaani muina vuosina (${fmt(mm, 1)} MWh). Ehdotus on muiden vuosien mediaani (arvio), ei mitattu arvo.`,
            en: `Reading ${v} MWh is ${fmt(v / mm, 1)}× the same month's median in other years (${fmt(mm, 1)} MWh). The candidate is that median (an estimate), not a measured value.` }));
        }
      }
    }
    // Duplicate readings for the same month.
    for (const [, dup] of groupBy(list, (r) => `${r.payload.year}-${r.payload.month}`)) {
      for (const r of dup.slice(1)) {
        out.push(on(r, { rule_id: 'energy.duplicate_month', issue_type: 'duplicate_record', category: 'energy', field: null, observed: r.payload.value, candidate: null, candidate_unit: null, action: 'exclude_record', evidence_ids: dup.map((x) => x.id), severity: 'high', confidence: 0.85, fi: `Samalle kuukaudelle on ${dup.length} lukemaa; myöhempi rivi lasketaan kahteen kertaan.`, en: `${dup.length} readings for the same month; the later row would be counted twice.` }));
      }
    }
    // Missing months inside an otherwise complete year (not a carrier that started or stopped).
    for (const [year, yearRows] of groupBy(list, (r) => String(r.payload.year))) {
      const months = new Set(yearRows.map((r) => Number(r.payload.month)));
      if (months.size < 9 || months.size >= 12) continue;
      const y = Number(year);
      const has = (yy: number, m: number) => list.some((r) => Number(r.payload.year) === yy && Number(r.payload.month) === m);
      for (let m = 1; m <= 12; m++) {
        if (months.has(m)) continue;
        if (!has(y - 1, m) && !has(y + 1, m)) continue;
        const prev = yearRows.find((r) => Number(r.payload.month) === m - 1);
        const next = yearRows.find((r) => Number(r.payload.month) === m + 1);
        const adj = [prev, next].map((r) => (r ? n(r.payload.value) : null)).filter((x): x is number => x !== null && x < med * 300);
        const est = adj.length ? adj.reduce((a, b) => a + b, 0) / adj.length : median((byMonth.get(String(m)) || []).map((r) => n(r.payload.value)).filter((x): x is number => x !== null));
        const site = yearRows[0].payload.site_id;
        const carrier = yearRows[0].payload.carrier;
        const key = `energy:${site}:${year}-${String(m).padStart(2, '0')}:${carrier}`;
        out.push({ rule_id: 'energy.missing_month', issue_type: 'missing_record', category: 'energy', table: 'energy_meter_readings', record_id: null, record_key: key, year: y, field: 'value', observed: null,
          candidate: JSON.stringify({ site_id: site, year: String(y), month: String(m), carrier, value: fmt(est), unit: 'MWh', estimate_basis: adj.length ? 'mean of adjacent months' : 'median of same month other years' }),
          candidate_unit: 'MWh', action: 'add_record', evidence_ids: [prev?.id, next?.id].filter((x): x is string => !!x).concat(yearRows.slice(0, 3).map((r) => r.id)), severity: 'medium', impact: 'high', confidence: 0.7,
          fi: `Kohteelta ${site} puuttuu ${carrier}-lukema ${m}/${year}, vaikka sarja on muuten täydellinen. Arvio ${fmt(est, 1)} MWh (${adj.length ? 'viereisten kuukausien keskiarvo' : 'saman kuukauden mediaani'}); vaatii hyväksynnän.`,
          en: `${site} has no ${carrier} reading for ${m}/${year} although the series is otherwise complete. Estimate ${fmt(est, 1)} MWh (${adj.length ? 'mean of adjacent months' : 'same-month median'}); needs approval.` });
      }
    }
  }
}

// ---------------------------------------------------------------- ERP
function erpRules(T: RuleTables, out: Finding[]) {
  const erp = T.erp_purchase_lines || [];
  const materials = new Map((T.materials || []).map((m) => [m.payload.material_id, m]));
  const materialByText = new Map((T.materials || []).map((m) => [String(m.payload.erp_name || '').trim().toLowerCase(), m]));
  const suppliers = new Set((T.suppliers || []).map((s) => s.payload.supplier_id));
  const farms = new Set((T.farm_registry || []).map((f) => f.payload.farm_id));
  const shipsByDoc = groupBy((T.shipments || []).filter((s) => s.payload.direction === 'inbound'), (s) => String(s.payload.ref_doc));
  const kg = (r: Src) => {
    const q = n(r.payload.quantity);
    if (q === null) return null;
    const u = String(r.payload.uom).toUpperCase();
    return u === 'TO' ? q * 1000 : u === 'KG' ? q : null;
  };
  // Unit price per kg in EUR by material (receipts only, positive quantities).
  const fx: Record<string, number> = { EUR: 1, SEK: 11.4, USD: 1.08 };
  const priceOf = (r: Src) => {
    const k = kg(r);
    const amt = n(r.payload.net_amount);
    const c = fx[String(r.payload.currency || 'EUR').toUpperCase()];
    return k && k > 0 && amt && amt > 0 && c ? amt / c / k : null;
  };
  const prices = new Map<string, number>();
  for (const [mat, list] of groupBy(erp.filter((r) => r.payload.movement_type === '101'), (r) => r.payload.material_id)) {
    const ps = list.map(priceOf).filter((x): x is number => x !== null);
    if (ps.length >= 5) prices.set(mat, median(ps));
  }
  const seen = new Map<string, Src>();
  const supplierCurrency = new Map<string, { cur: string; share: number; n: number }>();
  for (const [sup, list] of groupBy(erp, (r) => r.payload.supplier_id)) {
    const c = new Map<string, number>();
    for (const r of list) c.set(String(r.payload.currency).toUpperCase(), (c.get(String(r.payload.currency).toUpperCase()) || 0) + 1);
    const [cur, cnt] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
    supplierCurrency.set(sup, { cur, share: cnt / list.length, n: list.length });
  }
  const spend = new Map<string, number>();
  const spendLists = new Map<string, Src[]>();
  for (const [k, list] of groupBy(erp.filter((r) => String(r.payload.uom).toUpperCase() === 'EUR'), (r) => `${r.payload.supplier_id}|${r.payload.material_id}`)) {
    const vals = list.map((r) => n(r.payload.net_amount)).filter((x): x is number => x !== null && x > 0);
    if (vals.length >= 5) spend.set(k, median(vals));
    spendLists.set(k, list);
  }
  const ordered = [...erp].sort((a, b) => String(a.payload.posting_date).localeCompare(String(b.payload.posting_date)) || a.source_row - b.source_row);
  for (const r of ordered) {
    const p = r.payload;
    const mat = materials.get(p.material_id);
    const legs = shipsByDoc.get(String(p.doc_no)) || [];
    const legT = legs.map((s) => n(s.payload.t)).filter((x): x is number => x !== null && x > 0);
    const shipKg = legT.length ? median(legT) * 1000 : null;
    const q = n(p.quantity);
    const k = kg(r);
    const isReceipt = p.movement_type === '101';
    if (!mat) {
      out.push(on(r, { rule_id: 'erp.material_master', issue_type: 'unknown_reference', category: 'erp_pcf', field: 'material_id', observed: p.material_id, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [r.id], severity: 'medium', confidence: 0.9, fi: 'Materiaalia ei löydy materiaalirekisteristä.', en: 'Material not found in the material master.' }));
    } else {
      const masterText = String(mat.payload.erp_name || '').trim().toLowerCase();
      const docText = String(p.material_text || '').trim().toLowerCase();
      const other = materialByText.get(docText);
      if (docText && masterText && docText !== masterText && other && other.payload.material_id !== p.material_id) {
        out.push(on(r, { rule_id: 'erp.material_text_vs_master', issue_type: 'material_mismatch', category: 'erp_pcf', field: 'material_id', observed: p.material_id, candidate: other.payload.material_id, candidate_unit: null, action: 'set_value', evidence_ids: [r.id, mat.id, other.id], severity: 'high', impact: 'high', confidence: 0.85,
          fi: `Rivin materiaaliteksti "${p.material_text}" on materiaalin ${other.payload.material_id} nimi, mutta koodi on ${p.material_id}. Väärä koodi valitsee väärän päästökertoimen.`,
          en: `The line text "${p.material_text}" is the name of ${other.payload.material_id}, but the code is ${p.material_id}. A wrong code selects the wrong emission factor.` }));
      }
    }
    if (p.supplier_id && !suppliers.has(p.supplier_id) && !farms.has(p.supplier_id)) {
      out.push(on(r, { rule_id: 'erp.supplier_master', issue_type: 'unknown_reference', category: 'erp_pcf', field: 'supplier_id', observed: p.supplier_id, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [r.id], severity: 'low', confidence: 0.8, fi: 'Toimittajaa ei löydy toimittaja- eikä tilarekisteristä.', en: 'Supplier not found in the supplier or farm registry.' }));
    }
    if (q === null) {
      out.push(on(r, { rule_id: 'erp.quantity_present', issue_type: 'missing_value', category: 'erp_pcf', field: 'quantity', observed: '', candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [r.id], severity: 'high', confidence: 0.99, fi: 'Määrä puuttuu.', en: 'Quantity is missing.' }));
    }
    // Quantity scale: cross-check with the linked transport legs, then with the unit price.
    if (isReceipt && k !== null && k > 0 && String(p.uom).toUpperCase() === 'KG') {
      const ref = shipKg ?? null;
      const pr = prices.get(p.material_id);
      const priceRatio = pr ? (priceOf(r) ?? 0) / pr : null; // >1 means amount high relative to kg
      let done = false;
      if (ref) {
        const rr = ratio(k, ref);
        if (near(rr, 0.001, 0.1)) {
          out.push(on(r, { rule_id: 'erp.tonnes_keyed_as_kg', issue_type: 'unit_error', category: 'erp_pcf', field: 'quantity', observed: String(q), candidate: fmt(q! * 1000), candidate_unit: 'KG', action: 'set_value', evidence_ids: [r.id, ...legs.map((s) => s.id)], severity: 'high', impact: 'high', confidence: 0.95,
            fi: `Määrä ${q} KG, mutta samaan dokumenttiin liittyvä kuljetus on ${fmt(ref / 1000)} t. Tonnit on kirjattu kilogrammoina; ehdotus ${fmt(q! * 1000)} kg.`,
            en: `Quantity ${q} KG, but the linked transport leg carries ${fmt(ref / 1000)} t. Tonnes were keyed as kilograms; candidate ${fmt(q! * 1000)} kg.` }));
          done = true;
        } else if (near(rr, 10, 0.1) || near(rr, 0.1, 0.1)) {
          const cand = near(rr, 10, 0.1) ? q! / 10 : q! * 10;
          out.push(on(r, { rule_id: 'erp.decimal_shift_vs_shipment', issue_type: 'decimal_shift', category: 'erp_pcf', field: 'quantity', observed: String(q), candidate: fmt(cand), candidate_unit: 'KG', action: 'set_value', evidence_ids: [r.id, ...legs.map((s) => s.id)], severity: 'high', impact: 'high', confidence: 0.9,
            fi: `Määrä ${q} kg on ${fmt(rr, 2)}× kuljetuksen massa (${fmt(ref / 1000)} t): desimaalipilkku siirtynyt. Ehdotus ${fmt(cand)} kg.`,
            en: `Quantity ${q} kg is ${fmt(rr, 2)}× the transported mass (${fmt(ref / 1000)} t): the decimal point has shifted. Candidate ${fmt(cand)} kg.` }));
          done = true;
        }
      }
      if (!done && priceRatio !== null && pr) {
        if (priceRatio > 300 && near(priceRatio / 1000, 1, 0.6)) {
          out.push(on(r, { rule_id: 'erp.tonnes_keyed_as_kg_price', issue_type: 'unit_error', category: 'erp_pcf', field: 'quantity', observed: String(q), candidate: fmt(q! * 1000), candidate_unit: 'KG', action: 'set_value', evidence_ids: [r.id], severity: 'high', impact: 'high', confidence: 0.85,
            fi: `Kilohinta on ${fmt(priceRatio, 0)}× materiaalin mediaani: määrä on todennäköisesti tonneina. Ehdotus ${fmt(q! * 1000)} kg.`, en: `Unit price is ${fmt(priceRatio, 0)}× the material median: the quantity is probably in tonnes. Candidate ${fmt(q! * 1000)} kg.` }));
          done = true;
        } else if (near(priceRatio, 0.1, 0.25) || near(priceRatio, 10, 0.25)) {
          const cand = priceRatio < 1 ? q! / 10 : q! * 10;
          out.push(on(r, { rule_id: 'erp.decimal_shift_price', issue_type: 'decimal_shift', category: 'erp_pcf', field: 'quantity', observed: String(q), candidate: fmt(cand), candidate_unit: 'KG', action: 'set_value', evidence_ids: [r.id], severity: 'high', impact: 'high', confidence: 0.75,
            fi: `Kilohinta on ${fmt(priceRatio, 2)}× materiaalin mediaani: määrän desimaali on todennäköisesti siirtynyt. Ehdotus ${fmt(cand)} kg.`, en: `Unit price is ${fmt(priceRatio, 2)}× the material median: the quantity's decimal has probably shifted. Candidate ${fmt(cand)} kg.` }));
          done = true;
        }
      }
      // Amount keyed in SEK but labelled EUR: price ≈ 11.4× the median while kg agree with transport.
      if (!done && pr && String(p.currency).toUpperCase() === 'EUR' && priceRatio !== null && near(priceRatio, 11.4, 0.25)) {
        out.push(on(r, { rule_id: 'erp.currency_sek_as_eur', issue_type: 'currency_error', category: 'erp_pcf', field: 'currency', observed: 'EUR', candidate: 'SEK', candidate_unit: null, action: 'set_value', evidence_ids: [r.id], severity: 'medium', confidence: 0.8,
          fi: `Kilohinta on ${fmt(priceRatio, 1)}× materiaalin mediaani, mikä vastaa SEK/EUR-kurssia 11,4. Summa on todennäköisesti kruunuina.`, en: `Unit price is ${fmt(priceRatio, 1)}× the material median, matching the SEK/EUR rate 11.4. The amount is probably in SEK.` }));
      }
    }
    const sc = supplierCurrency.get(p.supplier_id);
    const cur = String(p.currency).toUpperCase();
    if (sc && sc.n >= 10 && sc.share >= 0.85 && cur !== sc.cur) {
      out.push(on(r, { rule_id: 'erp.currency_vs_supplier_history', issue_type: 'currency_error', category: 'erp_pcf', field: 'currency', observed: cur, candidate: sc.cur, candidate_unit: null, action: 'set_value', evidence_ids: [r.id], severity: 'medium', confidence: 0.7,
        fi: `Toimittaja ${p.supplier_id} laskuttaa ${fmt(sc.share * 100, 0)} % riveistään valuutassa ${sc.cur}; tämä rivi on ${cur}.`, en: `Supplier ${p.supplier_id} invoices ${fmt(sc.share * 100, 0)} % of its lines in ${sc.cur}; this line is in ${cur}.` }));
    }
    const typical = spend.get(`${p.supplier_id}|${p.material_id}`);
    const amt = n(p.net_amount);
    // Spend lines vary widely, so also test the range: far above every other line of the same
    // supplier and item, while amount / 11.4 falls inside their normal range.
    const others = (spendLists.get(`${p.supplier_id}|${p.material_id}`) || []).filter((x) => x.id !== r.id).map((x) => n(x.payload.net_amount)).filter((x): x is number => x !== null && x > 0);
    const maxOther = others.length >= 5 ? Math.max(...others) : null;
    const minOther = others.length >= 5 ? Math.min(...others) : null;
    const rangeHit = !!(amt && maxOther && minOther && amt > maxOther * 3 && amt / 11.4 >= minOther && amt / 11.4 <= maxOther);
    if (String(p.uom).toUpperCase() === 'EUR' && amt && cur === 'EUR' && ((typical && near(amt / typical, 11.4, 0.2)) || rangeHit)) {
      out.push(on(r, { rule_id: 'erp.spend_amount_in_sek', issue_type: 'currency_error', category: 'erp_pcf', field: 'net_amount', observed: String(amt), candidate: fmt(amt / 11.4, 2), candidate_unit: 'EUR', action: 'set_value', evidence_ids: [r.id], severity: 'high', impact: 'high', confidence: 0.75,
        fi: `Summa ${amt} on ${typical ? fmt(amt / typical, 1) : '?'}× saman toimittajan ja nimikkeen mediaani ja yli ${maxOther ? fmt(amt / maxOther, 1) : '?'}× suurin muu rivi; summa / 11,4 (SEK/EUR) osuu tavanomaiselle välille. Ehdotus ${fmt(amt / 11.4, 2)} EUR; tarkista lasku.`, en: `Amount ${amt} is ${typical ? fmt(amt / typical, 1) : '?'}× the supplier/item median and ${maxOther ? fmt(amt / maxOther, 1) : '?'}× the largest other line; amount / 11.4 (SEK/EUR) falls in the normal range. Candidate ${fmt(amt / 11.4, 2)} EUR; check the invoice.` }));
    }
    if (isReceipt && String(p.currency).toUpperCase() === 'EUR' && String(p.uom).toUpperCase() === 'TO') {
      const pr = prices.get(p.material_id);
      const own = priceOf(r);
      if (pr && own && near(own / pr, 11.4, 0.25)) {
        out.push(on(r, { rule_id: 'erp.currency_sek_as_eur', issue_type: 'currency_error', category: 'erp_pcf', field: 'currency', observed: 'EUR', candidate: 'SEK', candidate_unit: null, action: 'set_value', evidence_ids: [r.id], severity: 'medium', confidence: 0.8, fi: 'Kilohinta vastaa SEK/EUR-kurssia; summa on todennäköisesti kruunuina.', en: 'Unit price matches the SEK/EUR rate; the amount is probably in SEK.' }));
      }
    }
    // Duplicate posting: same supplier, material, quantity and amount as an earlier line posted
    // within 7 days (often under another document series). The later posting is flagged.
    if (isReceipt && (q !== null || n(p.net_amount) !== null)) {
      const k2 = [p.supplier_id, p.material_id, p.quantity, p.net_amount].join('|');
      const first = seen.get(k2);
      const days = first ? Math.abs(Date.parse(p.posting_date) - Date.parse(first.payload.posting_date)) / 86400000 : Infinity;
      if (first && days <= 7) {
        out.push(on(r, { rule_id: 'erp.duplicate_posting', issue_type: 'duplicate_record', category: 'erp_pcf', field: null, observed: `${p.doc_no}:${p.line_no}`, candidate: null, candidate_unit: null, action: 'exclude_record', evidence_ids: [first.id, r.id], severity: 'high', impact: 'high', confidence: 0.9,
          fi: `Sama toimittaja, materiaali, määrä ja summa kuin rivillä ${first.record_key} ${fmt(days, 0)} päivän sisällä. Myöhempi kirjaus lasketaan kahteen kertaan.`, en: `Same supplier, material, quantity and amount as ${first.record_key} within ${fmt(days, 0)} days. The later posting would be counted twice.` }));
      } else seen.set(k2, r);
    }
  }
}

// ---------------------------------------------------------------- transport
function transportRules(T: RuleTables, out: Finding[]) {
  const ships = T.shipments || [];
  const erp = new Map((T.erp_purchase_lines || []).map((r) => [String(r.payload.doc_no), r]));
  const factors = new Set((T.emission_factors || []).map((f) => f.payload.ef_id));
  const byDoc = groupBy(ships.filter((s) => s.payload.direction === 'inbound'), (s) => String(s.payload.ref_doc));
  // Peer pattern: for docs from the same origin country and unit, which share has a sea leg?
  type PeerStat = { docs: number; withSea: number; seaEf: Map<string, number>; seaKm: number[]; seaIds: string[] };
  const peers = new Map<string, PeerStat>();
  for (const [doc, legs] of byDoc) {
    const e = erp.get(doc);
    if (!e) continue;
    const key = `${e.payload.origin_country}|${String(e.payload.uom).toUpperCase()}`;
    const pp: PeerStat = peers.get(key) || { docs: 0, withSea: 0, seaEf: new Map(), seaKm: [], seaIds: [] };
    pp.docs++;
    const sea = legs.filter((l) => SEA_MODES.has(l.payload.mode));
    if (sea.length) {
      pp.withSea++;
      for (const l of sea) {
        pp.seaEf.set(l.payload.ef_id, (pp.seaEf.get(l.payload.ef_id) || 0) + 1);
        const km = n(l.payload.km);
        if (km) pp.seaKm.push(km);
        if (pp.seaIds.length < 5) pp.seaIds.push(l.id);
      }
    }
    peers.set(key, pp);
  }
  for (const [doc, legs] of byDoc) {
    const e = erp.get(doc);
    if (!e) {
      for (const l of legs) out.push(on(l, { rule_id: 'ship.unlinked_ref_doc', issue_type: 'unknown_reference', category: 'transport', field: 'ref_doc', observed: doc, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [l.id], severity: 'medium', confidence: 0.9, fi: 'Saapuvan kuljetuksen viitedokumenttia ei löydy ERP:stä; materiaali ja toimittaja jäävät linkittämättä.', en: 'The inbound leg references a document not found in ERP; material and supplier stay unlinked.' }));
      continue;
    }
    const pp = peers.get(`${e.payload.origin_country}|${String(e.payload.uom).toUpperCase()}`);
    const hasSea = legs.some((l) => SEA_MODES.has(l.payload.mode));
    if (!hasSea && pp && pp.docs >= 10 && pp.withSea / pp.docs >= 0.8) {
      const ef = [...pp.seaEf.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const mode = Object.entries(TRANSPORT_MODE_EF).find(([, v]) => v === ef)?.[0] || '';
      const km = median(pp.seaKm);
      const t = n(legs[0].payload.t) ?? 0;
      const year = legs[0].payload.year;
      out.push({ rule_id: 'ship.missing_sea_leg', issue_type: 'missing_leg', category: 'transport', table: 'shipments', record_id: null, record_key: `ship:${doc}:${ef}`, year: Number(year), field: 'tkm', observed: null,
        candidate: JSON.stringify({ shipment_id: `EST-${doc}-${mode}`, year, direction: 'inbound', ref_doc: doc, ef_id: ef, mode, t: String(t), km: fmt(km, 1), tkm: fmt(t * km, 2), estimate_basis: `median ${mode} distance of ${pp.withSea} peer documents from ${e.payload.origin_country}` }),
        candidate_unit: 'tkm', action: 'add_record', evidence_ids: [...legs.map((l) => l.id), e.id, ...pp.seaIds], severity: 'high', impact: 'high', confidence: 0.8,
        fi: `${fmt((pp.withSea / pp.docs) * 100, 0)} % saman lähtömaan (${e.payload.origin_country}) erista kulkee myös ${mode}-osuuden, mutta tästä dokumentista on vain maantieosuus. Ehdotettu osuus ${fmt(km, 0)} km on vertaisten mediaani (arvio, ei reittitieto).`,
        en: `${fmt((pp.withSea / pp.docs) * 100, 0)} % of lots from the same origin (${e.payload.origin_country}) also have a ${mode} leg, but this document only has a road leg. The proposed ${fmt(km, 0)} km is the peer median (an estimate, not route evidence).` });
    }
    for (const [, dup] of groupBy(legs, (l) => `${l.payload.ef_id}|${l.payload.t}|${l.payload.km}`)) {
      for (const l of dup.slice(1)) out.push(on(l, { rule_id: 'ship.duplicate_leg', issue_type: 'duplicate_record', category: 'transport', field: null, observed: l.payload.shipment_id, candidate: null, candidate_unit: null, action: 'exclude_record', evidence_ids: dup.map((x) => x.id), severity: 'high', confidence: 0.85, fi: 'Sama osuus (kerroin, massa, matka) on kirjattu useammin kuin kerran samalle dokumentille.', en: 'The same leg (factor, mass, distance) is recorded more than once for the document.' }));
    }
  }
  const kmByMode = new Map<string, number>();
  for (const [mode, list] of groupBy(ships, (s) => s.payload.mode)) kmByMode.set(mode, median(list.map((s) => n(s.payload.km)).filter((x): x is number => x !== null && x > 0)));
  for (const s of ships) {
    const p = s.payload;
    const t = n(p.t), km = n(p.km), tkm = n(p.tkm);
    if (t === null || km === null || t <= 0 || km <= 0) {
      out.push(on(s, { rule_id: 'ship.mass_distance_present', issue_type: 'missing_value', category: 'transport', field: t === null || t <= 0 ? 't' : 'km', observed: t === null || t <= 0 ? p.t : p.km, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [s.id], severity: 'high', confidence: 0.95, fi: 'Massa tai matka puuttuu tai ei ole positiivinen; tkm:ää ei voi laskea.', en: 'Mass or distance is missing or not positive; tkm cannot be calculated.' }));
      continue;
    }
    if (tkm !== null && Math.abs(t * km - tkm) > Math.max(0.01, 0.005 * tkm)) {
      out.push(on(s, { rule_id: 'ship.tkm_equals_t_times_km', issue_type: 'total_mismatch', category: 'transport', field: 'tkm', observed: String(tkm), candidate: fmt(t * km, 4), candidate_unit: 'tkm', action: 'set_value', evidence_ids: [s.id], severity: 'medium', confidence: 0.95, fi: `Kirjattu tkm ${tkm} ≠ t × km = ${fmt(t * km, 4)}.`, en: `Recorded tkm ${tkm} ≠ t × km = ${fmt(t * km, 4)}.` }));
    }
    const expected = TRANSPORT_MODE_EF[p.mode];
    if (expected && p.ef_id && p.ef_id !== expected) {
      out.push(on(s, { rule_id: 'ship.factor_matches_mode', issue_type: 'mode_mislabel', category: 'transport', field: 'ef_id', observed: p.ef_id, candidate: expected, candidate_unit: null, action: 'set_value', evidence_ids: [s.id], severity: 'high', impact: 'high', confidence: 0.8, fi: `Kulkumuoto ${p.mode} mutta kerroin ${p.ef_id}; esim. rekan kerrointa ei saa käyttää lauttaosuudelle.`, en: `Mode ${p.mode} but factor ${p.ef_id}; e.g. a truck factor must not be applied to a ferry leg.` }));
    }
    if (p.ef_id && factors.size && !factors.has(p.ef_id)) {
      out.push(on(s, { rule_id: 'ship.factor_in_library', issue_type: 'missing_factor', category: 'transport', field: 'ef_id', observed: p.ef_id, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [s.id], severity: 'high', confidence: 0.95, fi: 'Kuljetuskerrointa ei ole kerroinkirjastossa.', en: 'The transport factor is not in the factor library.' }));
    }
    const mk = kmByMode.get(p.mode) || 0;
    if (mk > 0 && km > mk * 100) {
      out.push(on(s, { rule_id: 'ship.distance_scale', issue_type: 'decimal_shift', category: 'transport', field: 'km', observed: String(km), candidate: fmt(km / 1000, 1), candidate_unit: 'km', action: 'set_value', evidence_ids: [s.id], severity: 'high', impact: 'high', confidence: 0.75, fi: `Matka ${km} km on ${fmt(km / mk, 0)}× kulkumuodon mediaani; todennäköisesti metreinä.`, en: `Distance ${km} km is ${fmt(km / mk, 0)}× the mode median; probably metres.` }));
    }
  }
}

// ---------------------------------------------------------------- PCF
function pcfRules(T: RuleTables, out: Finding[]) {
  const pcfs = T.supplier_pcf || [];
  const byPair = groupBy(pcfs, (r) => `${r.payload.supplier_id}|${r.payload.material_id}`);
  for (const r of pcfs) {
    const p = r.payload;
    const y = n(p.year);
    const unit = String(p.declared_unit || '').toLowerCase();
    if (unit !== 'kilogram' && unit !== 'kg') {
      out.push(on(r, { rule_id: 'pcf.declared_unit_kg', issue_type: 'pcf_unit_error', category: 'erp_pcf', field: 'declared_unit', observed: p.declared_unit, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [r.id], severity: 'high', impact: 'high', confidence: 0.9, fi: 'PCF:n ilmoitettu yksikkö ei ole kilogramma; arvoa ei käytetä, vaan materiaalin oletuskerrointa.', en: 'The PCF declared unit is not kilogram; the value is not used and the material default factor applies.' }));
    }
    const start = String(p.reference_period_start || '').slice(0, 10);
    const end = String(p.reference_period_end || '').slice(0, 10);
    if (y !== null && !(start && end && start <= `${y}-01-01` && end >= `${y}-12-31`)) {
      out.push(on(r, { rule_id: 'pcf.period_covers_year', issue_type: 'pcf_stale_period', category: 'erp_pcf', field: 'reference_period_start', observed: `${start}–${end}`, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [r.id], severity: 'medium', impact: 'high', confidence: 0.95,
        fi: `Vuodelle ${y} toimitetun PCF:n viitejakso on ${start}–${end}; se ei kata vuotta, joten laskenta käyttää materiaalin oletuskerrointa.`, en: `The PCF supplied for ${y} has reference period ${start}–${end}; it does not cover the year, so the calculation uses the material default factor.` }));
    }
    const v = n(p.pcf_value);
    const others = (byPair.get(`${p.supplier_id}|${p.material_id}`) || []).filter((x) => x.id !== r.id).map((x) => ({ rec: x, v: n(x.payload.pcf_value) })).filter((x) => x.v !== null && x.v > 0) as { rec: Src; v: number }[];
    if (v !== null && v > 0) {
      const ref = others.length ? median(others.map((o) => o.v)) : null;
      if ((ref && v / ref > 300) || (!ref && v > 50)) {
        out.push(on(r, { rule_id: 'pcf.value_scale_vs_history', issue_type: 'pcf_unit_error', category: 'erp_pcf', field: 'pcf_value', observed: String(v), candidate: fmt(v / 1000, 4), candidate_unit: 'kgCO2e/kg', action: 'set_value', evidence_ids: [r.id, ...others.map((o) => o.rec.id)], severity: 'high', impact: 'high', confidence: ref ? 0.9 : 0.7,
          fi: `PCF ${v} kg CO₂e/kg on ${ref ? `${fmt(v / ref, 0)}× saman toimittajan ja materiaalin muun vuoden arvo (${ref})` : 'epäuskottavan suuri'}; todennäköinen 1000-kertainen skaalausvirhe. Ehdotus ${fmt(v / 1000, 4)}; tarkista alkuperäinen PCF-ilmoitus.`,
          en: `PCF ${v} kg CO₂e/kg is ${ref ? `${fmt(v / ref, 0)}× the same supplier/material value for another year (${ref})` : 'implausibly high'}; a likely ×1000 scaling error. Candidate ${fmt(v / 1000, 4)}; check the original PCF declaration.` }));
      }
    }
  }
}

// ---------------------------------------------------------------- other activity feeds
function activityRules(T: RuleTables, out: Finding[]) {
  // Fuel deliveries: litres keyed as m3 (×1000 too small), duplicates.
  const fuel = T.fuel_deliveries || [];
  for (const [, list] of groupBy(fuel, (r) => `${r.payload.site_id}|${r.payload.carrier}|${r.payload.unit}`)) {
    const med = median(list.map((r) => n(r.payload.quantity)).filter((x): x is number => x !== null && x > 0));
    for (const r of list) {
      const q = n(r.payload.quantity);
      if (q !== null && med > 0 && q > 0 && q < med / 300) {
        out.push(on(r, { rule_id: 'fuel.quantity_scale', issue_type: 'unit_error', category: 'energy', field: 'quantity', observed: String(q), candidate: fmt(q * 1000), candidate_unit: r.payload.unit, action: 'set_value', evidence_ids: [r.id, ...list.filter((x) => x.id !== r.id).slice(0, 5).map((x) => x.id)], severity: 'high', impact: 'high', confidence: 0.85,
          fi: `Toimitus ${q} ${r.payload.unit} on alle 1/300 saman kohteen tyypillisestä toimituksesta (${fmt(med, 0)}); todennäköisesti m³ kirjattu litroina. Ehdotus ${fmt(q * 1000)}.`, en: `Delivery ${q} ${r.payload.unit} is below 1/300 of the typical delivery (${fmt(med, 0)}); probably m³ keyed as litres. Candidate ${fmt(q * 1000)}.` }));
      }
    }
    for (const [, dup] of groupBy(list, (r) => `${r.payload.delivery_date}|${r.payload.quantity}`)) {
      for (const r of dup.slice(1)) out.push(on(r, { rule_id: 'fuel.duplicate_delivery', issue_type: 'duplicate_record', category: 'energy', field: null, observed: r.payload.delivery_id, candidate: null, candidate_unit: null, action: 'exclude_record', evidence_ids: dup.map((x) => x.id), severity: 'high', confidence: 0.85, fi: 'Sama toimitus (päivä, määrä) on kirjattu useammin kuin kerran.', en: 'The same delivery (date, quantity) is recorded more than once.' }));
    }
  }
  // GoO internal log vs registry statement.
  const reg = T.goo_registry || [];
  for (const r of T.goo_cancellations || []) {
    const p = r.payload;
    const regRows = reg.filter((g) => g.payload.beneficiary_site === p.site_id && g.payload.consumption_year === p.year);
    const regVintage = regRows.length ? String(regRows[0].payload.production_period_start || '').slice(0, 4) : '';
    if (p.vintage_year !== p.year) {
      out.push(on(r, { rule_id: 'goo.vintage_matches_year', issue_type: 'certificate_mismatch', category: 'energy', field: 'vintage_year', observed: p.vintage_year, candidate: regVintage || null, candidate_unit: null, action: regVintage ? 'set_value' : 'acknowledge', evidence_ids: [r.id, ...regRows.map((g) => g.id)], severity: 'high', confidence: 0.9,
        fi: `Sisäisen lokin tuotantovuosi ${p.vintage_year} ≠ kulutusvuosi ${p.year}.${regVintage ? ` Rekisteriote (ensisijainen) näyttää tuotantovuoden ${regVintage}.` : ''}`, en: `Internal log vintage ${p.vintage_year} ≠ consumption year ${p.year}.${regVintage ? ` The registry statement (authoritative) shows vintage ${regVintage}.` : ''}` }));
    }
    const regMwh = regRows.reduce((s, g) => s + (n(g.payload.mwh) ?? 0), 0);
    const logged = n(p.mwh_cancelled) ?? 0;
    if (regRows.length && regMwh > 0 && Math.abs(logged - regMwh) / regMwh > 0.05) {
      out.push(on(r, { rule_id: 'goo.log_vs_registry_mwh', issue_type: 'certificate_mismatch', category: 'energy', field: 'mwh_cancelled', observed: String(logged), candidate: fmt(regMwh), candidate_unit: 'MWh', action: 'set_value', evidence_ids: [r.id, ...regRows.map((g) => g.id)], severity: 'medium', confidence: 0.85, fi: `Lokin ${logged} MWh poikkeaa rekisteriotteesta (${fmt(regMwh)} MWh) yli 5 %.`, en: `The log's ${logged} MWh differs from the registry statement (${fmt(regMwh)} MWh) by more than 5 %.` }));
    }
  }
  // Refrigerants: gas differs from the system's usual gas; grams in the kg column.
  const refr = T.refrigerant_service_log || [];
  for (const [, list] of groupBy(refr, (r) => `${r.payload.site_id}|${r.payload.system}`)) {
    const gases = new Map<string, number>();
    for (const r of list) gases.set(r.payload.refrigerant, (gases.get(r.payload.refrigerant) || 0) + 1);
    const usual = [...gases.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const med = median(list.map((r) => n(r.payload.kg_added)).filter((x): x is number => x !== null && x > 0));
    for (const r of list) {
      const gas = r.payload.refrigerant;
      if (!(gas in REFRIGERANT_GWP)) {
        out.push(on(r, { rule_id: 'refrigerant.gas_known', issue_type: 'wrong_gas_code', category: 'energy', field: 'refrigerant', observed: gas, candidate: usual && usual in REFRIGERANT_GWP ? usual : null, candidate_unit: null, action: usual ? 'set_value' : 'acknowledge', evidence_ids: [r.id], severity: 'high', confidence: 0.9, fi: 'Kylmäainekoodi ei ole GWP-taulukossa.', en: 'The refrigerant code is not in the GWP table.' }));
      } else if (usual && gas !== usual && list.length >= 5 && (gases.get(usual) || 0) / list.length >= 0.6) {
        out.push(on(r, { rule_id: 'refrigerant.gas_vs_system_history', issue_type: 'wrong_gas_code', category: 'energy', field: 'refrigerant', observed: gas, candidate: usual, candidate_unit: null, action: 'set_value', evidence_ids: list.map((x) => x.id), severity: 'high', impact: REFRIGERANT_GWP[usual] > 100 || REFRIGERANT_GWP[gas] > 100 ? 'high' : 'normal', confidence: 0.85,
          fi: `Järjestelmän "${r.payload.system}" kaikki muut huollot ovat kaasulla ${usual}; tämä rivi sanoo ${gas}. GWP ${REFRIGERANT_GWP[gas]} vs ${REFRIGERANT_GWP[usual]}.`, en: `Every other service on system "${r.payload.system}" uses ${usual}; this row says ${gas}. GWP ${REFRIGERANT_GWP[gas]} vs ${REFRIGERANT_GWP[usual]}.` }));
      }
      const kg = n(r.payload.kg_added);
      if (kg !== null && med > 0 && kg > med * 100) {
        out.push(on(r, { rule_id: 'refrigerant.charge_scale', issue_type: 'unit_error', category: 'energy', field: 'kg_added', observed: String(kg), candidate: fmt(kg / 1000), candidate_unit: 'kg', action: 'set_value', evidence_ids: list.map((x) => x.id), severity: 'high', impact: 'high', confidence: 0.85,
          fi: `Täyttö ${kg} kg on ${fmt(kg / med, 0)}× järjestelmän mediaani (${fmt(med, 2)} kg); todennäköisesti grammoja kg-sarakkeessa. Ehdotus ${fmt(kg / 1000)} kg.`, en: `Top-up ${kg} kg is ${fmt(kg / med, 0)}× the system median (${fmt(med, 2)} kg); probably grams in the kg column. Candidate ${fmt(kg / 1000)} kg.` }));
      }
    }
  }
  // Waste notes: tonnes keyed as kg.
  for (const [, list] of groupBy(T.waste_transfer_notes || [], (r) => `${r.payload.site_id}|${r.payload.waste_stream}`)) {
    const med = median(list.map((r) => n(r.payload.quantity)).filter((x): x is number => x !== null && x > 0));
    for (const r of list) {
      const q = n(r.payload.quantity);
      if (q === null || q <= 0) {
        out.push(on(r, { rule_id: 'waste.quantity_present', issue_type: 'missing_value', category: 'other', field: 'quantity', observed: r.payload.quantity, candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [r.id], severity: 'medium', confidence: 0.9, fi: 'Jäte-erän määrä puuttuu tai on nolla.', en: 'The waste quantity is missing or zero.' }));
      } else if (med > 0 && q < med / 300) {
        out.push(on(r, { rule_id: 'waste.quantity_scale', issue_type: 'unit_error', category: 'other', field: 'quantity', observed: String(q), candidate: fmt(q * 1000), candidate_unit: 'kg', action: 'set_value', evidence_ids: [r.id, ...list.filter((x) => x.id !== r.id).slice(0, 5).map((x) => x.id)], severity: 'medium', confidence: 0.85,
          fi: `Määrä ${q} kg on alle 1/300 saman virran mediaanista (${fmt(med, 0)} kg); tonnit kirjattu kilogrammoina.`, en: `Quantity ${q} kg is below 1/300 of the stream median (${fmt(med, 0)} kg); tonnes keyed as kg.` }));
      }
    }
  }
  // Travel: re-imported bookings (same traveller, date, route, distance, nights); later row flagged.
  const seenTravel = new Map<string, Src>();
  for (const r of T.travel_bookings || []) {
    const p = r.payload;
    const k = [p.traveller_id, p.travel_date, p.route, p.pkm, p.nights].join('|');
    const first = seenTravel.get(k);
    if (first) out.push(on(r, { rule_id: 'travel.duplicate_booking', issue_type: 'duplicate_record', category: 'other', field: null, observed: p.booking_id, candidate: null, candidate_unit: null, action: 'exclude_record', evidence_ids: [first.id, r.id], severity: 'medium', confidence: 0.92, fi: `Sama matkustaja, päivä, reitti, matka ja yöt kuin varauksessa ${first.payload.booking_id}.`, en: `Same traveller, date, route, distance and nights as booking ${first.payload.booking_id}.` }));
    else seenTravel.set(k, r);
  }
  // Commuting survey: distance in metres, non-canonical mode labels.
  const MODES: Record<string, string> = { car: 'car', carpool: 'carpool', bus: 'bus', train: 'train', bike_walk: 'bike_walk', ev_car: 'ev_car', auto: 'car', henkilöauto: 'car', 'linja-auto': 'bus', bussi: 'bus', juna: 'train', kimppakyyti: 'carpool', sähköauto: 'ev_car', pyörä: 'bike_walk', kävely: 'bike_walk' };
  for (const r of T.commuting_survey || []) {
    const km = n(r.payload.one_way_km);
    if (km !== null && km > 300) {
      out.push(on(r, { rule_id: 'commute.distance_scale', issue_type: 'unit_error', category: 'other', field: 'one_way_km', observed: String(km), candidate: fmt(km / 1000, 2), candidate_unit: 'km', action: 'set_value', evidence_ids: [r.id], severity: 'high', impact: 'high', confidence: 0.85, fi: `Työmatka ${km} km suuntaansa on epäuskottava; todennäköisesti metreinä. Ehdotus ${fmt(km / 1000, 2)} km.`, en: `A one-way commute of ${km} km is implausible; probably metres. Candidate ${fmt(km / 1000, 2)} km.` }));
    }
    const mode = String(r.payload.mode || '');
    if (!(mode in MODES) || MODES[mode] !== mode) {
      const cand = MODES[mode.toLowerCase()] || null;
      out.push(on(r, { rule_id: 'commute.mode_vocabulary', issue_type: 'outlier_implausible', category: 'other', field: 'mode', observed: mode, candidate: cand, candidate_unit: null, action: cand ? 'set_value' : 'acknowledge', evidence_ids: [r.id], severity: 'low', confidence: cand ? 0.85 : 0.5, fi: `Kulkutapa "${mode}" ei ole vakiokoodi${cand ? `; tarkoittaa todennäköisesti "${cand}"` : ''}. Tuntematon kulkutapa lasketaan henkilöauton kertoimella.`, en: `Mode "${mode}" is not a standard code${cand ? `; it probably means "${cand}"` : ''}. An unknown mode is calculated with the car factor.` }));
    }
  }
  // Draft report: total must equal the sum of its parts.
  for (const [, list] of groupBy(T.draft_report_summary || [], (r) => r.payload.year)) {
    const get = (line: string) => list.find((r) => r.payload.line === line);
    const total = get('total_market_based');
    const parts = ['scope1', 'scope2_market', 'scope3'].map((l) => n(get(l)?.payload.tco2e) ?? 0);
    const sum = parts.reduce((a, b) => a + b, 0);
    const tv = total ? n(total.payload.tco2e) : null;
    if (total && tv !== null && sum > 0 && Math.abs(tv - sum) / sum > 0.01) {
      out.push(on(total, { rule_id: 'report.total_equals_parts', issue_type: 'total_mismatch', category: 'accounting', field: 'tco2e', observed: String(tv), candidate: fmt(sum, 0), candidate_unit: 'tCO2e', action: 'acknowledge', evidence_ids: list.map((r) => r.id), severity: 'high', confidence: 0.99, fi: `Luonnoksen kokonaissumma ${tv} t ≠ osien summa ${fmt(sum, 0)} t.`, en: `Draft total ${tv} t ≠ sum of parts ${fmt(sum, 0)} t.` }));
    }
  }
}

// ---------------------------------------------------------------- agriculture
function farmRules(T: RuleTables, out: Finding[]) {
  const parcels = new Map((T.parcels || []).map((p) => [p.payload.parcel_id, p]));
  const hist = groupBy(T.parcel_crop_history || [], (r) => `${r.payload.farm_id}|${r.payload.crop}|${r.payload.year}`);
  const survey = T.farm_survey || [];
  const fields = ['n_mineral_kg_ha', 'p_kg_ha', 'diesel_l_ha', 'yield_t_ha'];
  const peer = new Map<string, number>();
  for (const [k, list] of groupBy(survey, (r) => r.payload.crop)) {
    for (const f of fields) peer.set(`${k}|${f}`, median(list.map((r) => n(r.payload[f])).filter((x): x is number => x !== null && x > 0)));
  }
  for (const r of survey) {
    const p = r.payload;
    const h = hist.get(`${p.farm_id}|${p.crop}|${p.year}`) || [];
    let area = 0;
    let organic = 0;
    const evidence: string[] = [r.id];
    for (const x of h) {
      const parcel = parcels.get(x.payload.parcel_id);
      if (!parcel) continue;
      const a = n(parcel.payload.area_ha) ?? 0;
      area += a;
      if (parcel.payload.soil_class_soilmap === 'organic') organic += a;
      if (evidence.length < 25) evidence.push(x.id, parcel.id);
    }
    const share = area > 0 ? organic / area : 0;
    if (area > 0 && share >= 0.3 && String(p.soil_type_reported || '').toLowerCase().includes('mineral')) {
      out.push(on(r, { rule_id: 'farm.soil_map_vs_survey', issue_type: 'soil_misreport', category: 'agriculture', field: 'soil_type_reported', observed: p.soil_type_reported, candidate: 'Organic soil', candidate_unit: null, action: 'set_value', evidence_ids: evidence, severity: 'medium', confidence: 0.75,
        fi: `Maaperäkartan mukaan ${fmt(share * 100, 0)} % tilan ${p.crop}-alasta vuonna ${p.year} on eloperäistä maata, mutta kysely sanoo kivennäismaa. Huom: laskenta käyttää jo maaperäkartan osuutta; kartta on noin 88 % tarkka.`,
        en: `The soil map shows ${fmt(share * 100, 0)} % of the farm's ${p.crop} area in ${p.year} on organic soil, but the survey says mineral soil. Note: the calculation already uses the soil-map share; the map is about 88 % accurate.` }));
    }
    const sa = n(p.area_ha);
    if (sa !== null && area > 0 && Math.abs(sa - area) / area > 0.15) {
      out.push(on(r, { rule_id: 'farm.area_vs_parcels', issue_type: 'area_mismatch', category: 'agriculture', field: 'area_ha', observed: String(sa), candidate: fmt(area, 2), candidate_unit: 'ha', action: 'set_value', evidence_ids: evidence, severity: 'medium', impact: 'high', confidence: 0.8,
        fi: `Kyselyn ala ${sa} ha poikkeaa ${fmt((Math.abs(sa - area) / area) * 100, 0)} % lohkorekisterin ${p.crop}-alasta (${fmt(area, 2)} ha) samana vuonna.`, en: `The survey area ${sa} ha differs by ${fmt((Math.abs(sa - area) / area) * 100, 0)} % from the declared ${p.crop} parcel area (${fmt(area, 2)} ha) that year.` }));
    }
    for (const f of fields) {
      const v = n(p[f]);
      const m = peer.get(`${p.crop}|${f}`) || 0;
      if (v === null || v <= 0 || m <= 0) continue;
      const rr = v / m;
      if (near(rr, 10, 0.35) || near(rr, 0.1, 0.35)) {
        const cand = rr > 1 ? v / 10 : v * 10;
        out.push(on(r, { rule_id: `farm.${f}_decimal_shift`, issue_type: 'decimal_shift', category: 'agriculture', field: f, observed: String(v), candidate: fmt(cand, 3), candidate_unit: null, action: 'set_value', evidence_ids: [r.id], severity: 'medium', impact: f === 'yield_t_ha' ? 'high' : 'normal', confidence: 0.7,
          fi: `${f} = ${v} on ${fmt(rr, 2)}× saman kasvin mediaani (${fmt(m, 2)}): desimaali todennäköisesti siirtynyt.`, en: `${f} = ${v} is ${fmt(rr, 2)}× the crop median (${fmt(m, 2)}): the decimal has probably shifted.` }));
      } else if (rr > 5) {
        out.push(on(r, { rule_id: `farm.${f}_outlier`, issue_type: 'outlier_implausible', category: 'agriculture', field: f, observed: String(v), candidate: null, candidate_unit: null, action: 'acknowledge', evidence_ids: [r.id], severity: 'low', confidence: 0.55, fi: `${f} = ${v} on ${fmt(rr, 1)}× saman kasvin mediaani.`, en: `${f} = ${v} is ${fmt(rr, 1)}× the crop median.` }));
      }
    }
  }
  for (const r of T.farm_registry || []) {
    const lat = n(r.payload.lat), lon = n(r.payload.lon);
    if (lat !== null && lon !== null && (lat < 54 || lat > 71) && lon >= 54 && lon <= 71) {
      out.push(on(r, { rule_id: 'farm.coordinate_swap', issue_type: 'coordinate_swap', category: 'agriculture', field: 'lat', observed: `${lat}, ${lon}`, candidate: String(lon), candidate_unit: 'deg', action: 'acknowledge', evidence_ids: [r.id], severity: 'low', confidence: 0.85, fi: 'Leveys- ja pituusaste ovat todennäköisesti vaihtaneet paikkaa.', en: 'Latitude and longitude are probably swapped.' }));
    }
  }
}

export function runRules(T: RuleTables, opts: { tables?: string[] } = {}): Finding[] {
  const out: Finding[] = [];
  const want = (...names: string[]) => !opts.tables || names.some((x) => opts.tables!.includes(x));
  if (want('energy_meter_readings')) energyRules(T, out);
  if (want('erp_purchase_lines')) erpRules(T, out);
  if (want('shipments')) transportRules(T, out);
  if (want('supplier_pcf')) pcfRules(T, out);
  if (want('fuel_deliveries', 'goo_cancellations', 'refrigerant_service_log', 'waste_transfer_notes', 'travel_bookings', 'commuting_survey', 'draft_report_summary')) activityRules(T, out);
  if (want('farm_survey', 'farm_registry')) farmRules(T, out);
  return out;
}

export const RULE_TABLES = [
  'energy_meter_readings', 'erp_purchase_lines', 'materials', 'suppliers', 'farm_registry', 'shipments', 'emission_factors', 'supplier_pcf',
  'fuel_deliveries', 'goo_cancellations', 'goo_registry', 'refrigerant_service_log', 'waste_transfer_notes', 'travel_bookings',
  'commuting_survey', 'draft_report_summary', 'farm_survey', 'parcels', 'parcel_crop_history',
];
