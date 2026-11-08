import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, detectDelimiter } from '../../server/domain/csv.ts';
import { parseNumber } from '../../server/domain/util.ts';

test('parses commas, quoted commas, escaped quotes and quoted newlines', () => {
  const t = parseCsv('a,b,c\n1,"x, y","he said ""hi"""\n2,"line1\nline2",z\n');
  assert.deepEqual(t.headers, ['a', 'b', 'c']);
  assert.deepEqual(t.rows, [['1', 'x, y', 'he said "hi"'], ['2', 'line1\nline2', 'z']]);
  assert.deepEqual(t.rowLines, [2, 3]);
  assert.equal(t.rejected.length, 0);
});

test('detects semicolons, strips UTF-8 BOM, handles CRLF', () => {
  const buf = Buffer.from('﻿a;b\r\n1,5;2\r\n', 'utf8');
  const t = parseCsv(buf);
  assert.equal(t.delimiter, ';');
  assert.deepEqual(t.headers, ['a', 'b']);
  assert.deepEqual(t.rows, [['1,5', '2']]);
});

test('rejects rows with the wrong field count, with the physical line number', () => {
  const t = parseCsv('a,b\n1,2\n3\n4,5,6\n7,8\n');
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rejected.map((r) => r.line), [3, 4]);
  assert.match(t.rejected[0].reason, /Expected 2 fields, found 1/);
});

test('reports an unterminated quote instead of silently truncating', () => {
  const t = parseCsv('a,b\n1,"open\n2,3\n');
  assert.equal(t.rejected.length, 1);
  assert.match(t.rejected[0].reason, /Unterminated/);
});

test('decodes Windows-1252 when the bytes are not valid UTF-8', () => {
  const t = parseCsv(Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x53, 0xe4, 0x6b, 0x79, 0x6c, 0xe4, 0x0a]));
  assert.equal(t.encoding, 'windows-1252');
  assert.equal(t.rows[0][0], 'Säkylä');
});

test('parses every row of a large file (no 200-row cap)', () => {
  const body = ['id,v', ...Array.from({ length: 5000 }, (_, i) => `${i},${i * 2}`)].join('\n');
  const t = parseCsv(body);
  assert.equal(t.rows.length, 5000);
  assert.equal(t.rows[4999][1], '9998');
});

test('delimiter detection ignores delimiters inside quotes', () => {
  assert.equal(detectDelimiter('"a;b;c",d,e\n'), ',');
});

test('parseNumber handles Nordic and English formats and rejects garbage', () => {
  assert.equal(parseNumber('7,31'), 7.31);
  assert.equal(parseNumber('1 234,56'), 1234.56);
  assert.equal(parseNumber('1 234,5'), 1234.5);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('-0.5'), -0.5);
  assert.equal(parseNumber('2.5e3'), 2500);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('12kg'), null);
});
