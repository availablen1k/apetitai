import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFigures, collectFigures, parseFigure } from '../../server/services/figures.ts';

test('figure checks accept Finnish and English formatting and supported rounding', () => {
  assert.equal(parseFigure('1 234,5')?.value, 1234.5);
  assert.equal(parseFigure('1,234.5')?.value, 1234.5);
  assert.equal(checkFigures('1,235 t and 1 234,5 t', [1234.5]).ok, true);
  assert.equal(checkFigures('Scope 3 in CA01: 1,200 t in 2025.', [1234.5, 2025]).ok, true);
  assert.deepEqual(collectFigures({ total: 1234.5, note: '−4,5 t', nested: [12] }), [1234.5, -4.5, 12]);
});

test('figure checks do not swallow lists, invent years, change a positive sign or allow unsupported scaled notation', () => {
  for (const text of ['20, 999 t', '20 and 999 t', 'In 2024: 20 t', '-20 t', '20 million t', '20e6 t']) {
    assert.equal(checkFigures(text, [20, 2025]).ok, false, text);
  }
  assert.equal(checkFigures('20 t lower', [-20]).ok, true, 'a reduction may be written as a positive magnitude');
  assert.equal(checkFigures('See dq_4c6a2ec149167e29 and dq_09e6b82d31abe0b5.', []).ok,true,'hexadecimal incident identifiers are not scientific notation');
});
