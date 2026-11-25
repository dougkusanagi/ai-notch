// Porcentagem esperada de cota restante até o reset, num ritmo constante.
// Se a barra (cota restante) estiver à esquerda dessa marca, o ritmo atual esgota o limite antes do reset.
function pacePercent(w, now = Date.now()) {
  if (!w?.reset || !w.minutes || w.minutes <= 0) return null;
  const pct = ((w.reset - now) / (w.minutes * 60e3)) * 100;
  return pct > 0 && pct < 100 ? pct : null;
}
if (typeof module !== 'undefined') module.exports = { pacePercent };
