import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyQuote } from '../../server/domain/documents.ts';

const check = (text: string, value: string, unit?: string | null, quote = text) => verifyQuote([{ page: 1, text }], quote, value, 1, unit).status;

test('numeric values must match complete numbers, including sign, decimals, exponent and grouped thousands', () => {
  for (const text of ['Weight is 120 kg.', 'Weight is -12 kg.', 'Weight is 0.12 kg.', 'Weight is 12e3 kg.', 'Weight is 1 012 kg.', 'Code is SUP12.']) assert.equal(check(text, '12'), 'value_not_in_quote', text);
  assert.equal(check('Weight is 1 200 kg.', '200'), 'value_not_in_quote');
  assert.equal(check('Weight is 12 kg.', '12'), 'verified_in_text');
  assert.equal(check('Weight is -12 kg.', '-12'), 'verified_in_text');
  assert.equal(check('PCF: 1,4091 kg CO₂e per kg of rapeseed.', '1.4091', 'kg CO2e/kg'), 'verified_in_text');
});

test('a quote cannot trim away the start of a number or a word', () => {
  assert.equal(check('Weight is 120 kg.', '20', 'kg', '20 kg'), 'quote_not_found');
  assert.equal(check('Weight is -12 kg.', '12', 'kg', '12 kg'), 'quote_not_found');
  assert.equal(check('The identifier is SUP12.', '12', null, '12.'), 'quote_not_found');
});

test('the claimed unit must follow the same value and match the entire unit', () => {
  assert.equal(check('Weight: 12 kg.', '12', 't'), 'unit_not_in_quote');
  assert.equal(check('First: 12 t; second: 120 kg.', '12', 'kg'), 'unit_not_in_quote');
  assert.equal(check('PCF: 12 kg CO2e/kg.', '12', 'kg'), 'unit_not_in_quote');
  assert.equal(check('Weight: 12 kilograms.', '12', 'kg'), 'verified_in_text');
  assert.equal(check('Weight: 12 kg.', '12', 'kg'), 'verified_in_text');
});

test('page citations identify where the full quote was actually found; images remain unverified', () => {
  const r = verifyQuote([{ page: 1, text: 'Unrelated' }, { page: 2, text: 'Weight: 12 kg.' }], 'Weight: 12 kg.', '12', 1, 'kg');
  assert.equal(r.status, 'verified_in_text'); assert.equal(r.found_on_page, 2);
  assert.equal(verifyQuote([], 'Weight: 12 kg.', '12', 1, 'kg').status, 'no_local_text');
});
