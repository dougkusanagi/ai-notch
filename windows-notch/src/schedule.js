// Quando consultar cada serviço. Funções puras, sem rede nem relógio próprio, para testar.
// Cada serviço tem ritmo e espera próprios: um 429 do Claude não freia o Codex.
const { backoffMs } = require('./usage');

// Os endpoints não são documentados. O do Claude limita com rigor (há relatos de 429 com
// consultas a cada 30–60 s), então fica mais lento; o do Codex tolera mais.
const POLICY = {
  claude: { intervalMs: 6 * 60e3, minGapMs: 60e3 },
  codex: { intervalMs: 2 * 60e3, minGapMs: 30e3 },
};
const STALE_MS = 60e3;        // ao abrir o painel, só consulta se o dado tem mais que isso
const RESET_DELAY_MS = 15e3;  // espera após o reset conhecido, para o serviço já refletir a renovação
const ACCOUNT_GAP_MS = 2000;  // pausa média entre contas do mesmo serviço

// Desvio aleatório de ±10% para as consultas não ficarem sincronizadas.
const jitter = (ms, rnd = Math.random) => Math.round(ms * (0.9 + rnd() * 0.2));

const newState = () => ({ lastAt: 0, nextAt: 0, failures: 0, backoffUntil: 0 });

// Primeiro reset ainda não visto por nenhuma consulta (reset depois da última consulta).
function nextResetAt(accounts, lastAt) {
  let next = Infinity;
  for (const a of accounts) {
    if (!a.ok || !a.windows) continue;
    for (const w of a.windows) if (w.reset && w.reset > lastAt) next = Math.min(next, w.reset + RESET_DELAY_MS);
  }
  return next;
}

// Hora em que o serviço deve ser consultado: o que vier antes entre o intervalo e o reset,
// nunca antes do intervalo mínimo nem durante a espera de um 429.
function dueAt(provider, st, accounts) {
  const natural = Math.min(st.nextAt, nextResetAt(accounts.filter(a => a.provider === provider), st.lastAt));
  return Math.max(natural, st.lastAt + POLICY[provider].minGapMs, st.backoffUntil);
}

// Consulta manual ignora o intervalo mínimo, mas nunca a espera de um 429.
function canFetch(provider, st, now, manual = false) {
  return now >= st.backoffUntil && (manual || now - st.lastAt >= POLICY[provider].minGapMs);
}

// Atualiza o estado do serviço depois de uma consulta. `accounts` são as contas desse serviço.
function afterFetch(provider, st, accounts, now, rnd = Math.random) {
  const limited = accounts.filter(a => a.retryAfterMs !== undefined);
  const failures = limited.length ? st.failures + 1 : 0;
  return {
    lastAt: now,
    nextAt: now + jitter(POLICY[provider].intervalMs, rnd),
    failures,
    backoffUntil: limited.length ? now + backoffMs(failures, Math.max(...limited.map(a => a.retryAfterMs))) : 0,
  };
}

const isStale = (st, now) => now - st.lastAt > STALE_MS;

module.exports = { POLICY, STALE_MS, RESET_DELAY_MS, ACCOUNT_GAP_MS, jitter, newState, nextResetAt, dueAt, canFetch, afterFetch, isStale };
