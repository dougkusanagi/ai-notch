import Gio from 'gi://Gio';
import {sendResetMessage} from './reset-message.js';
import {sessionWindow, shouldSendResetMessage} from '../utils/session.js';
import GLib from 'gi://GLib';
import OpenAIProvider from '../providers/openai.js';
import ClaudeProvider from '../providers/claude.js';
export class RefreshService {
    constructor(accounts, settings, onChange, providers = null, sender = sendResetMessage) {
        this.sender = sender; this._resetTimer = 0;
        this.accounts = accounts; this.settings = settings; this.onChange = onChange;
        this.providers = providers ?? {openai: new OpenAIProvider(), claude: new ClaudeProvider()};
        this._nextQuery = new Map(); this.states = new Map(); this._profiles = new Map(); this._generation = 0; this.busy = false; this._timer = 0;
        this._signals = [settings.connect('changed::refresh-minutes', () => this.schedule()),
            settings.connect('changed::accounts', () => { this.cancel(); this.refresh(); })];
    }
    start() { this.schedule(); this.refresh(); }
    schedule() {
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.settings.get_int('refresh-minutes') * 60, () => {
            this.refresh(); return GLib.SOURCE_CONTINUE;
        });
    }
    cancel() { if (this._resetTimer) GLib.Source.remove(this._resetTimer); this._resetTimer = 0; this._generation++; this._cancellable?.cancel(); this._cancellable = null; this.busy = false; }
    async query(account, cancellable) {
        const key = `${account.provider}:${account.profilePath}`;
        const next = this._nextQuery.get(key) ?? 0;
        if (next > Date.now()) return null;
        // Reserve before awaiting: manual clicks and duplicate profiles share the pause.
        this._nextQuery.set(key, Date.now() + Math.max(300, this.settings.get_int('refresh-minutes') * 60) * 1000);
        return this.providers[account.provider].getUsage(account, cancellable);
    }
    async refresh() {
        if (this._destroyed || this.busy) return;
        const generation = ++this._generation;
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;
        const list = this.accounts.list();
        const ids = new Set(list.map(a => a.id));
        for (const id of this.states.keys()) if (!ids.has(id)) { this.states.delete(id); this._profiles.delete(id); }
        for (const account of list) {
            const fingerprint = `${account.provider}:${account.profilePath}`;
            if (this._profiles.get(account.id) !== fingerprint) this.states.delete(account.id);
            this._profiles.set(account.id, fingerprint);
        }
        this.busy = true;
        try { this.onChange(); } catch (error) { console.error(`AI Usage: render failed: ${error.message}\n${error.stack}`); }
        let index = 0;
        const worker = async () => {
            while (index < list.length && !cancellable.is_cancelled()) {
                const account = list[index++];
                const previous = this.states.get(account.id);
                if (previous?.retryAt > Date.now()) continue;
                let state;
                try {
                    const usage = await this.query(account, cancellable);
                    if (!usage) continue;
                    state = {usage, updated: Date.now() / 1000, messageError: previous?.messageError};
                    if (this._destroyed || generation !== this._generation) return;
                    let attempts;
                    try { attempts = JSON.parse(this.settings.get_string('reset-message-attempts')); } catch { attempts = {}; }
                    if (!attempts || typeof attempts !== 'object' || Array.isArray(attempts)) attempts = {};
                    const key = JSON.stringify([account.id, account.provider, account.profilePath]);
                    if (account.autoResetMessage && shouldSendResetMessage(usage, Number(attempts[key]) || 0)) {
                        // Claim before sending: cancellation/restart must not duplicate a possibly delivered message.
                        attempts[key] = Date.now() / 1000;
                        this.settings.set_string('reset-message-attempts', JSON.stringify(attempts));
                        this.states.set(account.id, {...state, messageSending: true});
                        try { this.onChange(); } catch { /* render is independent */ }
                        try {
                            await this.sender(account, cancellable);
                            state.messageError = null;
                            state.messageSent = Date.now() / 1000;
                            // The next scheduled query observes the result without a second immediate request.
                        } catch (error) {
                            state.messageError = state.messageSent ? 'Mensagem enviada; aguardando atualização dos limites.' : error.message;
                        }
                    }
                } catch (error) {
                    // Only provider-owned, sanitized messages reach the UI; never log errors.
                    const rateLimitFailures = error.rateLimited ? (previous?.rateLimitFailures ?? 0) + 1 : 0;
                    // Repeated 429s need a longer pause even when Retry-After is absent.
                    const backoff = rateLimitFailures ? Math.min(3600, 300 * 2 ** Math.min(rateLimitFailures - 1, 4)) : 0;
                    const retryAfter = Math.max(error.retryAfter ?? 0, backoff);
                    state = {usage: previous?.usage, error: error.rateLimited && previous?.usage ? undefined : error.message, updated: previous?.updated ?? null,
                        rateLimitFailures, retryAt: retryAfter ? Date.now() + retryAfter * 1000 : 0};
                }
                if (this._destroyed || generation !== this._generation) return;
                this.states.set(account.id, state);
                try { this.onChange(); } catch { /* keep refreshing the remaining accounts */ }
            }
        };
        try { await Promise.all(Array.from({length: Math.min(4, list.length)}, worker)); }
        finally {
            if (!this._destroyed && generation === this._generation) {
                this.busy = false; this._cancellable = null;
                if (this._resetTimer) GLib.Source.remove(this._resetTimer);
                this._resetTimer = 0;
                const now = Date.now() / 1000;
                const upcoming = [...this.states.values()].filter(s => !s.error)
                    .map(s => sessionWindow(s.usage)?.reset).filter(t => t > now);
                upcoming.push(...[...this._nextQuery.values()].map(t => t / 1000).filter(t => t > now));
                upcoming.push(...[...this.states.values()].map(s => s.retryAt / 1000).filter(t => t > now));
                if (upcoming.length) this._resetTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                    Math.max(1, Math.ceil(Math.min(...upcoming) - now) + 1), () => {
                        this._resetTimer = 0; this.refresh(); return GLib.SOURCE_REMOVE;
                    });
                try { this.onChange(); } catch { /* keep the service usable */ }
            }
        }
    }
    destroy() {
        this._destroyed = true; this.cancel();
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = 0;
        for (const signal of this._signals) this.settings.disconnect(signal);
        this._signals = [];
        for (const provider of Object.values(this.providers)) provider.destroy();
        this.onChange = () => {}; this.states.clear(); this._profiles.clear();
    }
}
