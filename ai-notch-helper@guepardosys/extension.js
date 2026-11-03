import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PREFIX = 'ai-notch:';

export default class AiNotchHelper extends Extension {
    enable() {
        this._layout = new Map(); // título -> {x, y, width, height}
        this._tracked = new Map(); // MetaWindow -> ids de sinais
        this._applying = new Set();
        this._file = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_runtime_dir(), 'ai-notch', 'layout.json']));
        this._dir = this._file.get_parent();
        GLib.mkdir_with_parents(this._dir.get_path(), 0o700);

        this._monitor = this._dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitorId = this._monitor.connect('changed', (_m, file) => {
            if (file.get_basename() === 'layout.json') this._reload();
        });
        this._createdId = global.display.connect('window-created', (_d, win) => this._track(win));

        this._reload();
        for (const actor of global.get_window_actors())
            this._track(actor.meta_window);
    }

    disable() {
        if (this._reloadTimer) GLib.source_remove(this._reloadTimer);
        this._reloadTimer = null;
        this._monitor?.disconnect(this._monitorId);
        this._monitor?.cancel();
        global.display.disconnect(this._createdId);
        for (const [win, ids] of this._tracked) {
            for (const id of ids) win.disconnect(id);
            try { win.unmake_above(); win.unstick(); } catch (_e) { /* janela já fechada */ }
        }
        this._tracked = null;
        this._layout = null;
        this._applying = null;
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
        if (!win || this._tracked.has(win)) return;
        if (this._isNotch(win)) return this._adopt(win);
        // O título pode chegar depois da criação da janela.
        const id = win.connect('notify::title', () => {
            if (!this._isNotch(win)) return;
            win.disconnect(id);
            this._adopt(win);
        });
    }

    _adopt(win) {
        const ids = [
            win.connect('position-changed', () => this._apply(win)),
            win.connect('size-changed', () => this._apply(win)),
            win.connect('unmanaged', () => this._tracked?.delete(win)),
        ];
        this._tracked.set(win, ids);
        this._apply(win);
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
        } finally {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._applying?.delete(win);
                return GLib.SOURCE_REMOVE;
            });
        }
    }
}
