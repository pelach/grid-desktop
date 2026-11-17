import GLib from 'gi://GLib';
import { WIDE_MUSIC_LAYOUT_ASPECT_RATIO } from '../../utils/widgetUtils.js';
import { connectTimerCleanup, createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { DBUS_POLL_INTERVAL_MS } from './mpris.js';
import {
    MICROSECONDS_PER_SECOND,
    subscribeMusicData,
    applyPlayerState,
    resetWidgetState,
    updateTimerLabel,
    registerMusicWidgetInstance,
    unregisterMusicWidgetInstance,
    clearMusicPlaybackState,
} from './playbackState.js';
import { buildSmallLayout } from './musicSmall.js';
import { buildLargeLayout } from './musicLarge.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const LARGE_LAYOUT_BASE_HEIGHT = 240;

export const clearMusicPolls = clearMusicPlaybackState;

export function createMusicNode(config, width, height, xPosition, yPosition) {
    const playerContainer = createWidgetContainer(config, width, height, xPosition, yPosition);

    const state = {
        container: playerContainer,
        backgroundLayer: null,
        artworkCss: null,
        playPauseIcon: null,
        timerLabelLeft: null,
        timerLabelRight: null,
        titleLabel: null,
        artistLabel: null,
        albumLabel: null,
        config: config,
        timerId: null,
        artworkRetryWaits: null,
        lastArtUrl: null,
        currentPlayer: null,
        currentPositionMicro: 0,
        trackLengthMicro: 0,
        playbackStatus: 'Stopped',
        lastSeekTimestamp: 0,
    };

    registerMusicWidgetInstance(state);
    registerWidgetCleanup(playerContainer, () => {
        unregisterMusicWidgetInstance(state);
        if (state.artworkRetryWaits) {
            for (const wait of [...state.artworkRetryWaits]) {
                wait.settle(false);
            }
        }
    });

    const isLargeLayout = height > 0 && width / height >= WIDE_MUSIC_LAYOUT_ASPECT_RATIO;
    config.isLargeLayout = isLargeLayout;

    if (isLargeLayout) {
        config.layoutScale = height / LARGE_LAYOUT_BASE_HEIGHT;
        buildLargeLayout(config, state, width);
    } else {
        buildSmallLayout(config, state);
    }

    const releasePolling = subscribeMusicData(config, (data) => {
        if (isActorDestroyed(playerContainer)) return;
        if (data.properties) {
            state.currentPlayer = data.activePlayer;
            applyPlayerState(data.properties, state);
        } else if (state.currentPlayer !== null) {
            resetWidgetState(state);
            state.currentPlayer = null;
        }
    });

    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DBUS_POLL_INTERVAL_MS, () => {
        if (isActorDestroyed(playerContainer)) return GLib.SOURCE_REMOVE;
        if (state.playbackStatus === 'Playing') {
            const len = state.trackLengthMicro || 0;
            const prevPos = state.currentPositionMicro || 0;
            const nextPos = prevPos + MICROSECONDS_PER_SECOND;
            state.currentPositionMicro = (len > 0) ? Math.min(len, nextPos) : nextPos;
            updateTimerLabel(state);
        }
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(playerContainer, state);
    registerWidgetCleanup(playerContainer, releasePolling);

    return playerContainer;
}