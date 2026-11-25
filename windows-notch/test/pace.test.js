const { test, expect } = require('bun:test');
const { pacePercent } = require('../src/pace');

test('pacePercent calcula o tempo restante proporcional na janela', () => {
  const now = 1_700_000_000_000;
  const h = 3600e3;
  // 2.5h restantes de uma janela de 5h = 50%
  expect(pacePercent({ minutes: 300, reset: now + 2.5 * h }, now)).toBeCloseTo(50, 5);
  // 1h restante de uma janela de 5h = 20%
  expect(pacePercent({ minutes: 300, reset: now + 1 * h }, now)).toBeCloseTo(20, 5);
  // 3.5 dias restantes de uma janela semanal (7 dias) = 50%
  expect(pacePercent({ minutes: 10080, reset: now + 3.5 * 24 * h }, now)).toBeCloseTo(50, 5);
});

test('pacePercent retorna null fora do intervalo (0, 100) ou sem dados', () => {
  const now = 1_700_000_000_000;
  const h = 3600e3;
  expect(pacePercent({ minutes: 300, reset: null }, now)).toBeNull();
  expect(pacePercent({ minutes: 0, reset: now + h }, now)).toBeNull();
  expect(pacePercent({ minutes: 300, reset: now }, now)).toBeNull();
  expect(pacePercent({ minutes: 300, reset: now - h }, now)).toBeNull();
  expect(pacePercent({ minutes: 300, reset: now + 5 * h }, now)).toBeNull();
  expect(pacePercent({ minutes: 300, reset: now + 6 * h }, now)).toBeNull();
});
