import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { PLAY_ICON, PAUSE_ICON } from './icons.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import {
    DBUS_POLL_INTERVAL_MS,
    unpackVariantValue,
    extractTrackMetadata,
    resolveBusOwner,
    getActiveMediaPlayer,
    fetchPlayerProperties,
    fetchPlayerPosition,
} from './mpris.js';
import { setAlbumColor, resolveArtworkLayerStyle, applyArtworkToBackground } from './cover.js';

const RECENT_SEEK_WINDOW_MICROSECONDS = 1500000;
const SPURIOUS_ZERO_THRESHOLD_MICROSECONDS = 3000000;
const POSITION_JUMP_RESYNC_THRESHOLD_MICROSECONDS = 3000000;

let seekedSignalId = 0;
const activeMusicWidgetInstances = new Set();

/** Megosztott D-Bus pollerek player-szűrő kulcsonként: N widget = összesen 1 D-Bus lekérdezés/mp. */
const activeMusicPolls = new Map();

export function clearMusicPlaybackState() {
    if (seekedSignalId) {
        Gio.DBus.session.signal_unsubscribe(seekedSignalId);
        seekedSignalId = 0;
    }
    for (const poll of activeMusicPolls.values()) {
        if (poll.timerId) {
            GLib.Source.remove(poll.timerId);
            poll.timerId = null;
        }
    }
    activeMusicPolls.clear();
    activeMusicWidgetInstances.clear();
}

export const MICROSECONDS_PER_SECOND = 1000000;

export function formatMicroseconds(microseconds) {
    if (!microseconds || microseconds < 0) return '00:00';
    const totalSeconds = Math.floor(microseconds / MICROSECONDS_PER_SECOND);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function updateTimerLabel(state) {
    const pos = state.currentPositionMicro || 0;
    const len = state.trackLengthMicro || 0;

    if (state.timerLabelLeft && state.timerLabelRight) {
        state.timerLabelLeft.set_text(formatMicroseconds(pos));
        state.timerLabelRight.set_text(formatMicroseconds(len));
    }

    const ratio = len > 0 ? Math.min(1, Math.max(0, pos / len)) : 0;

    if (state.progressFill && state.progressBg) {
        const bgWidth = state.progressBg.get_width();
        if (bgWidth > 0) state._lastProgressBgWidth = bgWidth;
        const width = state._lastProgressBgWidth || 0;
        const fillWidth = Math.floor(width * ratio);
        state.progressFill.set_width(fillWidth);
        state._lastFillWidth = fillWidth;
    }

    if (typeof state.updateArmProgress === 'function') {
        state.updateArmProgress(ratio);
    }
}

export function resetWidgetState(state) {
    state.artworkCss = null;
    if (state.sheenActor) state.sheenActor.hide();
    if (state.config.vinylStyle === true) {
        state.backgroundLayer.style = 'background-color: transparent;';
    } else {
        state.backgroundLayer.style = resolveArtworkLayerStyle(state);
    }
    if (state.playPauseIcon) state.playPauseIcon.set_icon_name(PLAY_ICON);
    state.currentPositionMicro = 0;
    state.trackLengthMicro = 0;
    state.playbackStatus = 'Stopped';
    updateTimerLabel(state);
    if (state.titleLabel) state.titleLabel.set_text('Not Playing');
    if (state.artistLabel) state.artistLabel.set_text('Unknown Artist');
    if (state.albumLabel) state.albumLabel.hide();
    setAlbumColor(state, null);
    state.lastArtUrl = null;
    state.lastAppliedArtPath = null;
    state.lastAppliedArtStyleSignature = null;
    applyArtworkToBackground(state.backgroundLayer, null, state.config, state);

    if (state.onPlaybackStatusChanged) {
        state.onPlaybackStatusChanged('Stopped');
    }
}

export function applyPlayerState(properties, state) {
    const playbackStatus = unpackVariantValue(properties['PlaybackStatus']) || 'Stopped';
    const isPlaying = playbackStatus === 'Playing';

    if (state.sheenActor) state.sheenActor.show();

    const previousStatus = state.playbackStatus;
    state.playbackStatus = playbackStatus;

    if (previousStatus !== playbackStatus && state.onPlaybackStatusChanged) {
        state.onPlaybackStatusChanged(playbackStatus);
    }

    if (state.playPauseIcon) state.playPauseIcon.set_icon_name(isPlaying ? PAUSE_ICON : PLAY_ICON);

    const track = extractTrackMetadata(properties);
    const isNewTrack = state.lastTrackTitle !== track.title;

    if (isNewTrack) {
        state.lastTrackTitle = track.title;
        state.currentPositionMicro = 0;
        state.lastArtUrl = track.artUrl || null;
    } else if (track.artUrl) {
        state.lastArtUrl = track.artUrl;
    }

    state.trackId = track.trackId;
    if (track.lengthMicro > 0) {
        state.trackLengthMicro = track.lengthMicro;
    } else if (isNewTrack) {
        state.trackLengthMicro = 0;
    }

    const positionMicro = unpackVariantValue(properties['Position']);
    const now = GLib.get_monotonic_time();
    const recentSeek = state.lastSeekTimestamp && (now - state.lastSeekTimestamp < RECENT_SEEK_WINDOW_MICROSECONDS);

    if (positionMicro !== undefined && positionMicro !== null && positionMicro >= 0) {
        const isSpuriousZero = (positionMicro === 0 && (state.currentPositionMicro || 0) > SPURIOUS_ZERO_THRESHOLD_MICROSECONDS);
        if (!isSpuriousZero) {
            const currentPos = state.currentPositionMicro || 0;
            const diff = Math.abs(positionMicro - currentPos);
            if (isNewTrack || recentSeek || diff > POSITION_JUMP_RESYNC_THRESHOLD_MICROSECONDS) {
                state.currentPositionMicro = positionMicro;
            }
        }
    }

    if (state.playbackStatus !== 'Playing' || !state.timerId) {
        updateTimerLabel(state);
    }

    if (state.titleLabel) state.titleLabel.set_text(track.title);
    if (state.artistLabel) state.artistLabel.set_text(track.artist);

    if (state.albumLabel) {
        if (track.album && track.album !== track.title) {
            state.albumLabel.set_text(track.album);
            state.albumLabel.show();
        } else {
            state.albumLabel.hide();
        }
    }

    applyArtworkToBackground(state.backgroundLayer, track.artUrl || null, state.config, state);
}

export function fetchMusicDataForConfig(config, callback) {
    (async () => {
        try {
            const activePlayer = await getActiveMediaPlayer(config);
            if (activePlayer) {
                const properties = await fetchPlayerProperties(activePlayer);
                if (properties) {
                    const livePosition = await fetchPlayerPosition(activePlayer);
                    if (livePosition !== null && livePosition !== undefined) {
                        properties['Position'] = new GLib.Variant('x', livePosition);
                    }
                    callback({ activePlayer, properties });
                    return;
                }
            }
            callback({ activePlayer: null, properties: null });
        } catch (_err) {
            callback({ activePlayer: null, properties: null });
        }
    })();
}

/**
 * Feliratkozás a közös másodpercenkénti MPRIS lekérdezésre (music, lyrics, audioVisualizer).
 * Egyetlen D-Bus lekérdezést végez körönként és szétosztja az eredményt minden feliratkozónak.
 */
export function subscribeMusicData(config, onData) {
    const pollKey = `${config.ignoreBrowsers !== false}|${(config.playerFilter || '').trim()}`;
    let poll = activeMusicPolls.get(pollKey);

    const runFetch = () => {
        if (!poll || poll.listeners.size === 0) return;
        fetchMusicDataForConfig(config, (data) => {
            if (!poll) return;
            for (const listener of [...poll.listeners]) {
                listener(data);
            }
        });
    };

    if (!poll) {
        poll = { timerId: null, listeners: new Set() };
        activeMusicPolls.set(pollKey, poll);
        poll.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DBUS_POLL_INTERVAL_MS, () => {
            runFetch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    poll.listeners.add(onData);
    runFetch();

    let released = false;
    return () => {
        if (released) return;
        released = true;
        poll.listeners.delete(onData);
        if (poll.listeners.size === 0) {
            if (poll.timerId) {
                GLib.Source.remove(poll.timerId);
                poll.timerId = null;
            }
            activeMusicPolls.delete(pollKey);
        }
    };
}

async function isSeekSenderMatch(state, senderUniqueName) {
    if (!state.container || isActorDestroyed(state.container)) return false;
    if (!state.currentPlayer) return false;
    if (state.currentPlayer === senderUniqueName) return true;

    const owner = await resolveBusOwner(state.currentPlayer);
    return owner !== null && owner === senderUniqueName;
}

export function setupDbusSignalListeners() {
    if (seekedSignalId === 0) {
        seekedSignalId = Gio.DBus.session.signal_subscribe(
            null,
            'org.mpris.MediaPlayer2.Player',
            'Seeked',
            null, null,
            Gio.DBusSignalFlags.NONE,
            (_connection, senderName, _objectPath, _interfaceName, _signalName, parameters) => {
                const unpacked = parameters.deep_unpack();
                let rawPos = unpacked[0];
                if (typeof rawPos === 'number' || typeof rawPos === 'bigint') {
                    const pos = Number(rawPos);
                    const now = GLib.get_monotonic_time();
                    for (const state of activeMusicWidgetInstances) {
                        isSeekSenderMatch(state, senderName).then(isBoundToSender => {
                            if (!isBoundToSender) return;
                            state.currentPositionMicro = pos;
                            state.lastSeekTimestamp = now;
                            updateTimerLabel(state);
                        });
                    }
                }
            }
        );
    }
}

export function registerMusicWidgetInstance(state) {
    activeMusicWidgetInstances.add(state);
    setupDbusSignalListeners();
}

export function unregisterMusicWidgetInstance(state) {
    activeMusicWidgetInstances.delete(state);
    if (activeMusicWidgetInstances.size === 0 && seekedSignalId !== 0) {
        Gio.DBus.session.signal_unsubscribe(seekedSignalId);
        seekedSignalId = 0;
    }
}

export function notifyPlayPauseAllInstances(playerName) {
    for (const state of activeMusicWidgetInstances) {
        if (!playerName || !state.currentPlayer || state.currentPlayer === playerName) {
            const isPlaying = state.playbackStatus === 'Playing';
            state.playbackStatus = isPlaying ? 'Paused' : 'Playing';
            if (state.playPauseIcon) {
                state.playPauseIcon.set_icon_name(isPlaying ? PLAY_ICON : PAUSE_ICON);
            }
            if (state.onPlaybackStatusChanged) {
                state.onPlaybackStatusChanged(state.playbackStatus);
            }
        }
    }
}