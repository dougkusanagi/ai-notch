import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PREFIX = 'ai-notch:';

export default class AiNotchHelper extends Extension {
    enable() {
        this._layout = new Map(); // título -> {x, y, width, height}
        this._tracked = new Map(); // MetaWindow -> ids de sinais
        this._observed = new Map(); // todas as janelas, para detectar tela cheia
        this._applying = new Set();
        this._hiddenForFullscreen = new Set();
        this._file = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_runtime_dir(), 'ai-notch', 'layout.json']));
        this._dir = this._file.get_parent();
        GLib.mkdir_with_parents(this._dir.get_path(), 0o700);

        this._monitor = this._dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitorId = this._monitor.connect('changed', (_m, file) => {
            if (file.get_basename() === 'layout.json') this._reload();
        });
        this._createdId = global.display.connect('window-created', (_d, win) => this._track(win));
        this._fullscreenId = global.display.connect('in-fullscreen-changed', () => this._syncFullscreen());
        this._workspaceId = global.workspace_manager.connect('active-workspace-changed', () => this._syncFullscreen());

        this._hideFromDock();
        this._reload();
        for (const actor of global.get_window_actors())
            this._track(actor.meta_window);
    }

    // O Wayland ignora skipTaskbar, então o app aparece no dock. O dock lê os apps em
    // execução de Shell.AppSystem.get_running(); aqui tiramos da lista o app cujas janelas
    // são todas do notch (a janela de Configurações continua aparecendo). O filtro fica
    // instalado até o fim da sessão e só deixa de agir no disable(), porque o dock também
    // troca esse método e restaurar o original apagaria a troca dele.
    _hideFromDock() {
        const proto = Shell.AppSystem.prototype;
        const state = {on: true};
        this._dockFilter = state;
        const original = proto.get_running;
        proto.get_running = function (...args) {
            const apps = original.apply(this, args);
            if (!state.on)
                return apps;
            return apps.filter(app => {
                const wins = app.get_windows();
                return !wins.length || !wins.every(w => (w.get_title() ?? '').startsWith(PREFIX));
            });
        };
    }

    disable() {
        if (this._dockFilter) this._dockFilter.on = false;
        this._dockFilter = null;
        if (this._reloadTimer) GLib.source_remove(this._reloadTimer);
        this._reloadTimer = null;
        this._monitor?.disconnect(this._monitorId);
        this._monitor?.cancel();
        global.display.disconnect(this._createdId);
        global.display.disconnect(this._fullscreenId);
        global.workspace_manager.disconnect(this._workspaceId);
        for (const [win, ids] of this._observed)
            for (const id of ids) win.disconnect(id);
        for (const [win, ids] of this._tracked) {
            for (const id of ids) win.disconnect(id);
            if (this._hiddenForFullscreen.has(win)) {
                const actor = win.get_compositor_private();
                if (actor) actor.opacity = 255;
                actor?.show();
            }
            try { win.unmake_above(); win.unstick(); } catch (_e) { /* janela já fechada */ }
        }
        this._tracked = null;
        this._observed = null;
        this._layout = null;
        this._applying = null;
        this._hiddenForFullscreen = null;
        this._monitor = null;
        this._file = null;
        this._dir = null;
    }

    _isNotch(win) {
        return (win.get_title() ?? '').startsWith(PREFIX);
    }

    _reload() {
        try {
            const [ok, bytes] = this._file.load_contents(null);
            if (!ok) return;
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (data.version !== 1 || !Array.isArray(data.windows)) return;
            this._layout = new Map(data.windows.map(w => [w.title, w]));
        } catch (_e) {
            return; // arquivo ausente ou inválido: mantém o último layout
        }
        for (const win of this._tracked.keys()) this._apply(win);
    }

    _track(win) {
        if (!win || this._observed.has(win)) return;
        const ids = [
            win.connect('notify::fullscreen', () => this._syncFullscreen()),
            win.connect('notify::minimized', () => this._syncFullscreen()),
            win.connect('workspace-changed', () => this._syncFullscreen()),
            win.connect('unmanaged', () => { this._observed?.delete(win); this._syncFullscreen(); }),
            win.connect('notify::title', () => { if (this._isNotch(win) && !this._tracked.has(win)) this._adopt(win); }),
        ];
        this._observed.set(win, ids);
        if (this._isNotch(win)) return this._adopt(win);
        this._syncFullscreen();
    }

    _adopt(win) {
        const ids = [
            win.connect('position-changed', () => this._apply(win)),
            win.connect('size-changed', () => this._apply(win)),
            win.connect('unmanaged', () => { this._tracked?.delete(win); this._hiddenForFullscreen?.delete(win); }),
        ];
        this._tracked.set(win, ids);
        this._apply(win);
        this._syncFullscreen();
    }

    _syncFullscreen() {
        if (!this._tracked || !this._observed) return;
        const workspace = global.workspace_manager.get_active_workspace();
        for (const win of this._tracked.keys()) {
            const fullscreen = [...this._observed.keys()].some(other =>
                other !== win && !this._isNotch(other) && other.is_fullscreen() && !other.minimized &&
                other.located_on_workspace(workspace) && other.get_monitor() === win.get_monitor());
            const actor = win.get_compositor_private();
            if (fullscreen) {
                this._hiddenForFullscreen.add(win);
                if (actor) actor.opacity = 0;
                actor?.hide();
            } else if (this._hiddenForFullscreen.delete(win)) {
                if (actor) actor.opacity = 255;
                actor?.show();
            }
        }
    }

    _apply(win) {
        if (this._applying.has(win)) return; // evita laço com position-changed
        const spec = this._layout.get(win.get_title());
        if (!spec) return;
        this._applying.add(win);
        try {
            win.make_above();
            win.stick();
            const r = win.get_frame_rect();
            if (r.width !== spec.width || r.height !== spec.height)
                win.move_resize_frame(false, spec.x, spec.y, spec.width, spec.height);
            else if (r.x !== spec.x || r.y !== spec.y)
                win.move_frame(false, spec.x, spec.y);
            this._syncFullscreen();
        } finally {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._applying?.delete(win);
                return GLib.SOURCE_REMOVE;
            });
        }
    }
}
