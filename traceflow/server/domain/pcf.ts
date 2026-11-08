// Supplier product carbon footprints in PACT Technical Specification v2-style JSON.
// The document is flattened into one source row; the original JSON is kept under `_document`.

export type PcfRow = Record<string, string>;

const tail = (urn: unknown) => {
  const s = String(urn ?? '');
  const i = s.lastIndexOf(':');
  return i >= 0 ? s.slice(i + 1) : s;
};

export function flattenPact(doc: unknown, filename: string): { row: PcfRow | null; error?: string } {
  if (!doc || typeof doc !== 'object') return { row: null, error: 'JSON root is not an object' };
  const d = doc as Record<string, unknown>;
  const pcf = (d.pcf && typeof d.pcf === 'object' ? d.pcf : null) as Record<string, unknown> | null;
  if (!pcf) return { row: null, error: 'Not a PACT footprint: missing "pcf" object' };
  const companyIds = Array.isArray(d.companyIds) ? d.companyIds : [];
  const productIds = Array.isArray(d.productIds) ? d.productIds : [];
  const supplier = tail(companyIds[0]);
  const material = tail(productIds[0]);
  // File names follow {supplier}_{material}_{year}.json; the year in the name is the year the
  // footprint was supplied for, which is checked against the reference period by the rules.
  const m = filename.match(/([A-Za-z0-9]+)_([A-Za-z0-9]+)_(\d{4})\.json$/);
  const periodStart = String(pcf.referencePeriodStart ?? '');
  const periodEnd = String(pcf.referencePeriodEnd ?? '');
  const year = m ? m[3] : periodStart.slice(0, 4);
  if (!supplier || !material || !year) return { row: null, error: 'Supplier, product or year could not be determined' };
  const row: PcfRow = {
    supplier_id: supplier,
    material_id: material,
    year,
    pcf_value: String(pcf.pCfExcludingBiogenic ?? ''),
    pcf_including_biogenic: String(pcf.pCfIncludingBiogenic ?? ''),
    fossil_ghg: String(pcf.fossilGhgEmissions ?? ''),
    land_management_ghg: String(pcf.landManagementGhgEmissions ?? ''),
    declared_unit: String(pcf.declaredUnit ?? ''),
    unitary_product_amount: String(pcf.unitaryProductAmount ?? ''),
    reference_period_start: periodStart,
    reference_period_end: periodEnd,
    geography: String(pcf.geographyCountry ?? ''),
    primary_data_share: String(pcf.primaryDataShare ?? ''),
    characterization_factors: String(pcf.characterizationFactors ?? ''),
    company_name: String(d.companyName ?? ''),
    product_description: String(d.productDescription ?? ''),
    pact_id: String(d.id ?? ''),
    pact_status: String(d.status ?? ''),
    comment: String(d.comment ?? ''),
    _document: JSON.stringify(doc),
  };
  return { row };
}
