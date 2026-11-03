const { test, expect } = require('bun:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildLayout, writeLayout, titleFor } = require('../src/linux-layout');

test('buildLayout usa título com prefixo e arredonda', () => {
  expect(buildLayout([{ id: 7, x: 10.4, y: 0, width: 460, height: 640.6 }])).toEqual({
    version: 1, windows: [{ title: 'ai-notch:7', x: 10, y: 0, width: 460, height: 641 }],
  });
  expect(titleFor(3)).toBe('ai-notch:3');
});

test('writeLayout grava JSON válido e não deixa temporários', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-notch-'));
  const layout = buildLayout([{ id: 1, x: 0, y: 0, width: 460, height: 640 }]);
  const file = writeLayout(layout, path.join(dir, 'sub'));
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(layout);
  expect(fs.readdirSync(path.dirname(file))).toEqual(['layout.json']);
  writeLayout({ version: 1, windows: [] }, path.dirname(file));
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).windows).toEqual([]);
});
