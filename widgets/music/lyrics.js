import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveExplicitFontFamily } from '../../utils/widgetUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { DBUS_POLL_INTERVAL_MS, extractTrackMetadata, getActiveMediaPlayer, fetchPlayerProperties, fetchPlayerPosition } from './mpris.js';

const LYRICS_CACHE_DIR = GLib.build_filenamev([
    GLib.get_user_cache_dir(),
    'grid-desktop',
    'lyrics'
]);

const REF_WIDTH = 240;
const REF_HEIGHT = 200;

function sanitizeFilename(str) {
    return (str || 'unknown').replace(/[\/\\?%*:|"<>]/g, '_').trim();
}

function ensureCacheDir() {
    const dir = Gio.File.new_for_path(LYRICS_CACHE_DIR);
    if (!dir.query_exists(null)) {
        try {
            dir.make_directory_with_parents(null);
        } catch (_e) {}
    }
}

function getLyricsCacheFile(artist, title) {
    const filename = `${sanitizeFilename(artist)} - ${sanitizeFilename(title)}.json`;
    return Gio.File.new_for_path(GLib.build_filenamev([LYRICS_CACHE_DIR, filename]));
}

async function loadCachedLyrics(artist, title) {
    return new Promise((resolve) => {
        try {
            const file = getLyricsCacheFile(artist, title);
            file.load_contents_async(null, (source, res) => {
                try {
                    const [ok, contents] = source.load_contents_finish(res);
                    if (ok && contents) {
                        resolve(JSON.parse(new TextDecoder('utf-8').decode(contents)));
                        return;
                    }
                } catch (_e) {}
                resolve(null);
            });
        } catch (_e) {
            resolve(null);
        }
    });
}

function saveCachedLyrics(artist, title, data) {
    try {
        ensureCacheDir();
        const file = getLyricsCacheFile(artist, title);
        const raw = new TextEncoder().encode(JSON.stringify(data));
        file.replace_contents(raw, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (_e) {}
}

async function fetchLrclibLyrics(artist, title, album, durationSec) {
    return new Promise((resolve) => {
        let url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
        if (album) url += `&album_name=${encodeURIComponent(album)}`;
        if (durationSec > 0) url += `&duration=${Math.round(durationSec)}`;

        try {
            const proc = Gio.Subprocess.new(
                ['curl', '-s', '-m', '5', '-H', 'User-Agent: grid-desktop-gnome', url],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );

            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [ok, stdout] = source.communicate_utf8_finish(res);
                    if (ok && stdout && stdout.trim().startsWith('{')) {
                        const json = JSON.parse(stdout);
                        if (json && (json.syncedLyrics || json.plainLyrics)) {
                            resolve(json);
                            return;
                        }
                    }
                } catch (_e) {}
                resolve(null);
            });
        } catch (_e) {
            resolve(null);
        }
    });
}

function parseLrc(syncedLyrics) {
    if (!syncedLyrics) return [];
    const lines = syncedLyrics.split('\n');
    const result = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

    for (const line of lines) {
        const text = line.replace(timeRegex, '').trim();
        if (!text) continue;

        let match;
        timeRegex.lastIndex = 0;
        while ((match = timeRegex.exec(line)) !== null) {
            const min = parseInt(match[1], 10);
            const sec = parseInt(match[2], 10);
            const frac = parseFloat('0.' + match[3]);
            result.push({ time: min * 60 + sec + frac, text });
        }
    }

    result.sort((a, b) => a.time - b.time);
    return result;
}

export function createLyricsNode(config, width, height, xPosition, yPosition) {
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const backgroundColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const borderRadius = config.appliedBorderRadius || 12;

    const backgroundLayer = new St.Widget({
        style: `background-color: ${backgroundColor}; border-radius: ${borderRadius}px;`,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    container.add_child(backgroundLayer);

    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.NEVER,
        overlay_scrollbars: true,
        x_expand: true,
        y_expand: true,
        reactive: true,
        style: 'padding: 10px 14px;',
    });
    container.add_child(scrollView);

    const lyricsBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(lyricsBox);

    const topSpacer = new St.Widget({ x_expand: true, height: 70 });
    const bottomSpacer = new St.Widget({ x_expand: true, height: 100 });

    const statusLabel = new St.Label({
        text: 'No playback',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        style: `${fontCss}color: ${textColor}; font-size: 13px; opacity: 0.6;`,
    });
    container.add_child(statusLabel);

    let scale = Math.min(width / REF_WIDTH, height / REF_HEIGHT);

    const state = {
        container,
        scrollView,
        lyricsBox,
        statusLabel,
        topSpacer,
        bottomSpacer,
        config,
        currentTrackKey: '',
        isLoadingLyrics: false,
        lyricsData: [],
        isSynced: false,
        activeLineIndex: -1,
        lineActors: [],
        currentPositionSec: 0,
        playbackStatus: 'Stopped',
        pollTimerId: null,
        playbackTimerId: null,
        scrollTimerId: null,
        scale: scale,
    };

    const smoothScrollTo = (targetVal, durationMs = 280) => {
        const adj = state.scrollView.vscroll?.adjustment || state.scrollView.vadjustment;
        if (!adj) return;

        const maxVal = Math.max(0, adj.get_upper() - adj.get_page_size());
        const clampedTarget = Math.max(0, Math.min(maxVal, targetVal));

        if (state.scrollTimerId) {
            GLib.source_remove(state.scrollTimerId);
            state.scrollTimerId = null;
        }

        const startVal = adj.get_value();
        const diff = clampedTarget - startVal;
        if (Math.abs(diff) < 2.0) return;

        const startTime = GLib.get_monotonic_time();
        const durationMicro = durationMs * 1000;

        state.scrollTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (isActorDestroyed(container)) {
                state.scrollTimerId = null;
                return GLib.SOURCE_REMOVE;
            }

            const now = GLib.get_monotonic_time();
            const progress = Math.min(1.0, (now - startTime) / durationMicro);
            const easeProgress = 1.0 - (1.0 - progress) * (1.0 - progress);
            adj.set_value(startVal + diff * easeProgress);

            if (progress >= 1.0) {
                state.scrollTimerId = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    };

    const clearLyricsUI = (message = '') => {
        if (state.scrollTimerId) {
            GLib.source_remove(state.scrollTimerId);
            state.scrollTimerId = null;
        }

        state.lyricsBox.remove_all_children();
        state.lineActors = [];
        state.lyricsData = [];
        state.activeLineIndex = -1;

        if (message) {
            state.statusLabel.set_text(message);
            state.statusLabel.show();
        } else {
            state.statusLabel.hide();
        }
    };

    const buildLyricsUI = (lyricsList, isSynced) => {
        state.lyricsBox.remove_all_children();
        state.lineActors = [];
        state.lyricsData = lyricsList;
        state.isSynced = isSynced;
        state.activeLineIndex = -1;
        state.statusLabel.hide();

        const baseFontSize = Math.max(10, Math.round(13 * state.scale));
        const padY = Math.max(3, Math.round(4 * state.scale));

        state.lyricsBox.add_child(state.topSpacer);

        for (let i = 0; i < lyricsList.length; i++) {
            const item = lyricsList[i];
            const lineLabel = new St.Label({
                text: item.text,
                x_expand: true,
                style: `${fontCss}color: ${textColor}; font-size: ${baseFontSize}px; padding: ${padY}px 0px;`,
                opacity: isSynced ? 70 : 220,
            });

            lineLabel.clutter_text.line_wrap = true;
            lineLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            lineLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

            state.lyricsBox.add_child(lineLabel);
            state.lineActors.push(lineLabel);
        }

        state.lyricsBox.add_child(state.bottomSpacer);
    };

    const updateActiveLyricLine = (posSec) => {
        if (!state.isSynced || state.lyricsData.length === 0) return;

        let index = -1;
        for (let i = 0; i < state.lyricsData.length; i++) {
            if (state.lyricsData[i].time <= posSec) {
                index = i;
            } else {
                break;
            }
        }

        if (index === state.activeLineIndex) return;
        state.activeLineIndex = index;

        const baseFontSize = Math.max(10, Math.round(13 * state.scale));
        const activeFontSize = Math.max(12, Math.round(15 * state.scale));
        const padY = Math.max(3, Math.round(4 * state.scale));

        for (let i = 0; i < state.lineActors.length; i++) {
            const actor = state.lineActors[i];
            const isActive = (i === index);

            if (isActive) {
                actor.opacity = 255;
                actor.style = `${fontCss}color: ${textColor}; font-size: ${activeFontSize}px; font-weight: bold; padding: ${padY}px 0px;`;
            } else {
                const dist = Math.abs(i - index);
                actor.opacity = Math.max(35, 160 - dist * 40);
                actor.style = `${fontCss}color: ${textColor}; font-size: ${baseFontSize}px; font-weight: normal; padding: ${padY}px 0px;`;
            }
        }

        

        if (index >= 0 && index < state.lineActors.length) {
            const activeActor = state.lineActors[index];
            const adj = state.scrollView.vscroll?.adjustment || state.scrollView.vadjustment;
            if (!adj) return;

            // 1. A látható ablak valós magassága a görgetősáv pageSize-éből
            // (Ez a legmegbízhatóbb érték GNOME Shell alatt a tényleges ablakméretre!)
            const viewHeight = adj.get_page_size() || state.scrollView.get_height() || 180;

            // 2. A sor pontos Y pozíciója a belső listán belül
            let actorTop = 0;
            let actorHeight = 24;

            try {
                const alloc = activeActor.get_allocation_box();
                actorTop = alloc.y1;
                actorHeight = alloc.y2 - alloc.y1;
            } catch (_e) {
                // Ha még nincs allokálva, a sorok becsült összegét vesszük
                actorTop = (state.topSpacer.get_height() || 70) + index * Math.round(28 * state.scale);
            }

            // 3. Cél: az adott sor közepe essen a látható ablak közepére
            const targetScrollVal = Math.round(actorTop - (viewHeight / 2) + (actorHeight / 2));

            if (!isNaN(targetScrollVal)) {
                smoothScrollTo(Math.max(0, targetScrollVal), 280);
            }
        }
    };

    const loadLyricsForTrack = async (artist, title, album, durationSec) => {
        const safeArtist = (artist || '').trim().toLowerCase();
        const safeTitle = (title || '').trim().toLowerCase();
        const trackKey = `${safeArtist} - ${safeTitle}`;

        if (state.currentTrackKey === trackKey || state.isLoadingLyrics) return;
        state.currentTrackKey = trackKey;
        state.isLoadingLyrics = true;

        clearLyricsUI('Retrieving lyrics...');

        let data = await loadCachedLyrics(artist, title);
        if (!data) {
            data = await fetchLrclibLyrics(artist, title, album, durationSec);
            if (data) saveCachedLyrics(artist, title, data);
        }

        state.isLoadingLyrics = false;
        if (isActorDestroyed(container) || state.currentTrackKey !== trackKey) return;

        if (data && data.syncedLyrics) {
            const parsed = parseLrc(data.syncedLyrics);
            if (parsed.length > 0) {
                buildLyricsUI(parsed, true);
                updateActiveLyricLine(state.currentPositionSec);
                return;
            }
        }

        if (data && data.plainLyrics) {
            const plainLines = data.plainLyrics.split('\n')
                .map(l => ({ time: 0, text: l.trim() }))
                .filter(l => l.text.length > 0);

            if (plainLines.length > 0) {
                buildLyricsUI(plainLines, false);
                return;
            }
        }

        clearLyricsUI('No lyrics available');
    };

    const updateLyricsFromMpris = async () => {
        if (isActorDestroyed(container)) return;

        try {
            const activePlayer = await getActiveMediaPlayer(config);
            if (!activePlayer) {
                if (state.playbackStatus !== 'Stopped') {
                    state.playbackStatus = 'Stopped';
                    state.currentTrackKey = '';
                    clearLyricsUI('No playback');
                }
                return;
            }

            const properties = await fetchPlayerProperties(activePlayer);
            if (!properties) return;

            const metadata = extractTrackMetadata(properties);
            const status = properties['PlaybackStatus'] ? properties['PlaybackStatus'].deep_unpack() : 'Stopped';
            const previousStatus = state.playbackStatus;
            state.playbackStatus = status;

            const posMicro = await fetchPlayerPosition(activePlayer);
            if (posMicro !== null && posMicro !== undefined && posMicro >= 0) {
                const livePosSec = posMicro / 1000000;
                const isSpuriousZero = (livePosSec === 0 && state.currentPositionSec > 3.0);

                if (!isSpuriousZero) {
                    const diff = Math.abs(livePosSec - state.currentPositionSec);
                    if (diff > 2.5 || previousStatus !== 'Playing') {
                        state.currentPositionSec = livePosSec;
                    }
                }
            }

            if (metadata.title && metadata.title !== 'Unknown Title') {
                const safeArtist = (metadata.artist || '').trim().toLowerCase();
                const safeTitle = (metadata.title || '').trim().toLowerCase();
                const trackKey = `${safeArtist} - ${safeTitle}`;

                if (state.currentTrackKey !== trackKey) {
                    const durSec = (metadata.lengthMicro || 0) / 1000000;
                    loadLyricsForTrack(metadata.artist, metadata.title, metadata.album, durSec);
                } else if (state.playbackStatus !== 'Playing') {
                    updateActiveLyricLine(state.currentPositionSec);
                }
            } else {
                clearLyricsUI('No active track');
            }
        } catch (_e) {}
    };

    updateLyricsFromMpris();

    state.pollTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DBUS_POLL_INTERVAL_MS, () => {
        if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
        updateLyricsFromMpris();
        return GLib.SOURCE_CONTINUE;
    });

    state.playbackTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
        if (state.playbackStatus === 'Playing') {
            state.currentPositionSec += 0.25;
            updateActiveLyricLine(state.currentPositionSec);
        }
        return GLib.SOURCE_CONTINUE;
    });

    attachResponsiveScaler(container, REF_WIDTH, REF_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        state.scale = Math.min(w / REF_WIDTH, h / REF_HEIGHT);

        const spacerH = Math.round(h * 0.4);
        state.topSpacer.set_height(spacerH);
        state.bottomSpacer.set_height(spacerH);

        const baseFontSize = Math.max(10, Math.round(13 * state.scale));
        const activeFontSize = Math.max(12, Math.round(15 * state.scale));
        const padY = Math.max(3, Math.round(4 * state.scale));

        for (let i = 0; i < state.lineActors.length; i++) {
            const actor = state.lineActors[i];
            const isActive = (i === state.activeLineIndex);
            const size = isActive ? activeFontSize : baseFontSize;
            const weight = isActive ? 'bold' : 'normal';
            actor.style = `${fontCss}color: ${textColor}; font-size: ${size}px; font-weight: ${weight}; padding: ${padY}px 0px;`;
        }
    });

    registerWidgetCleanup(container, () => {
        if (state.pollTimerId) {
            GLib.Source.remove(state.pollTimerId);
            state.pollTimerId = null;
        }
        if (state.playbackTimerId) {
            GLib.Source.remove(state.playbackTimerId);
            state.playbackTimerId = null;
        }
        if (state.scrollTimerId) {
            GLib.Source.remove(state.scrollTimerId);
            state.scrollTimerId = null;
        }
    });

    return container;
}