import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jargon, wordFindings } from '../../server/services/experts.ts';
import type { LlmClient, LlmRequest, LlmTurn } from '../../server/services/gemini.ts';

test('finding wording: record keys, field names and spelled-out numbers count as technical', () => {
  for (const text of ['Record pcf:SUP011:M104:2025 is high.', 'Check the field pcf_value.', 'Rows in erp_purchase_lines.', 'Ninety-eight point nine percent rests on it.'])
    assert.ok(jargon(text), text);
  for (const text of ['The product footprint that Supplier 011 gave for frozen peas (2025) is about 1,000 times higher than expected.', 'Review lever L08 in catchment CA01.', 'Säkylä plant, electricity (2025-06).'])
    assert.equal(jargon(text), null, text);
});

class Wording implements LlmClient {
  mode = 'stub' as const; model = 'wording-fixture';
  found: string;
  constructor(found: string) { this.found = found; }
  async generate(req: LlmRequest): Promise<LlmTurn> {
    const input = JSON.parse(String(req.contents[0].parts![0].text));
    return { text: JSON.stringify({ cards: input.findings.map((f: { key: string }) => ({ key: f.key, found_en: this.found, found_fi: this.found, suggest_en: 'Check the invoice.', suggest_fi: 'Tarkista lasku.' })) }), usage: { input: 1, output: 1 }, calls: [] } as unknown as LlmTurn;
  }
}

const candidate = {
  key: 'dq:x', expert: 'data_quality_reviewer', kind: 'issue_what_if', priority: 1,
  facts: { supplier: 'Supplier 011', material: 'frozen peas', times_larger_than_suggested: 1000, observed_value: '1409.1' },
  template: { found: { en: 'Supplier product footprint, frozen peas, from Supplier 011, 2025: the value is far higher than before.', fi: 'x' }, suggest: { en: 'Check the declaration.', fi: 'y' } },
  who: { en: 'Buyer', fi: 'Ostaja' }, effect: { tco2e: -1, basis: 'what_if', share_pct: null, note: { en: '', fi: '' } }, action: { to: '/data-quality', label: { en: '', fi: '' } }, evidence: [],
} as any;

test('finding wording: AI text with a record key falls back to the named template; plain text is kept', async () => {
  const bad = await wordFindings(new Wording('Record pcf:SUP011:M104:2025 has value 1409.1.'), 'data_quality_reviewer', [candidate]);
  assert.equal(bad.worded[0].wording, 'template');
  assert.equal(bad.worded[0].check.reason, 'technical wording in AI text');
  assert.equal(bad.worded[0].found.en, candidate.template.found.en);
  const good = await wordFindings(new Wording('The product footprint that Supplier 011 gave for frozen peas is about 1,000 times higher than before.'), 'data_quality_reviewer', [candidate]);
  assert.equal(good.worded[0].wording, 'ai');
});
