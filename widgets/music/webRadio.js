import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import Gvc from 'gi://Gvc';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

import { 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';

import { 
    createWidgetContainer, 
    attachResponsiveScaler, 
    attachButtonFeedback 
} from '../../shell/widgetUIUtils.js';

import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import { RadioMprisService } from './mprisPlayer.js';

let gstInitialized = false;
function ensureGstreamer() {
    if (gstInitialized) return;
    try {
        Gst.init(null);
        gstInitialized = true;
    } catch (_e) {
        gstInitialized = true;
    }
}

const BASE_CONTAINER_WIDTH = 400;
const BASE_CONTAINER_HEIGHT = 200;

const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

const DEFAULT_STATIONS = [
    { name: 'Retro Rádió', url: 'https://icast.connectmedia.hu/5001/live.mp3' },
    { name: 'Rádió 1', url: 'https://icast.connectmedia.hu/5201/live.mp3' },
    { name: 'Petőfi Rádió', url: 'https://icast.connectmedia.hu/4738/mr2.mp3' },
    { name: 'Kossuth Rádió', url: 'http://mr-stream.mediaconnect.hu/4736/mr1.mp3' },
    { name: 'Smooth Jazz', url: 'https://smoothjazz.cdnstream1.com/2585_128.mp3' },
    { name: 'Klasszik Rádió', url: 'http://online.klasszikradio.hu/klasszik.mp3' },
];

export function createWebRadioNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBgAlpha = isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA;
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    const PADDING_H = 12;

    let mixerControl = null;
    let gvcSignalId = 0;

    function ensureRadioDesktopFile() {
        try {
            const appsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
            GLib.mkdir_with_parents(appsDir, 0o755);

            const desktopPath = GLib.build_filenamev([appsDir, 'grid-desktop.desktop']);
            const desktopFile = Gio.File.new_for_path(desktopPath);

            if (!desktopFile.query_exists(null)) {
                // Feloldjuk az extension gyökérútvonalát az import.meta.url-ből
                const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
                const currentDir = GLib.path_get_dirname(currentFilePath);
                const iconPath = Gio.File.new_for_path(currentDir)
                    .get_parent()
                    .get_parent()
                    .get_child('assets')
                    .get_child('icons')
                    .get_child('grid-desktop.svg')
                    .get_path();

                const content = `[Desktop Entry]
    Name=Grid Radio
    Comment=Web Radio for GNOME Shell
    Exec=true
    Icon=${iconPath}
    Terminal=false
    Type=Application
    NoDisplay=true
    `;
                desktopFile.replace_contents_async(
                    new TextEncoder().encode(content),
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null,
                    null
                );
            }
        } catch (_e) {}
    }

    function initAudioIntegration() {
        const quickSettings = Main.panel?.statusArea?.quickSettings;
        const volIndicator = quickSettings?._volumeOutput;
        mixerControl = volIndicator?._control || null;

        if (mixerControl) {
            gvcSignalId = mixerControl.connect('stream-added', () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    bindRadioStream();
                    return GLib.SOURCE_REMOVE;
                });
            });
        }
    };

    function toLinearVolume(display) {
        return Math.pow(Math.max(0.0, Math.min(1.0, display)), 3);
    }


    const state = {
        stations: (Array.isArray(config.stations) && config.stations.length > 0)
            ? config.stations
            : DEFAULT_STATIONS,
        selectedIndex: 0,
        isPlaying: false,
        isBuffering: false,
        volume: toLinearVolume(1.0),
        currentTrack: 'No signal',
        player: null,
        busWatchId: null,
        radioStream: null,
        streamNotifyId: 0,
    };

    const liveDot = new St.Widget({
        width: 8,
        height: 8,
        y_align: Clutter.ActorAlign.CENTER,
        style: `background-color: ${cssColorToRgba(textColor, 0.25)}; border-radius: 99px; margin-right: 6px;`,
    });

    const statusLabel = new St.Label({
        text: 'Standby',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: 10px; font-weight: bold; opacity: 0.6;`,
    });

    const currentStation = state.stations[state.selectedIndex];
    const stationTitleLabel = new St.Label({
        text: currentStation ? currentStation.name : 'Web Radio',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: 16px; font-weight: bold; margin-bottom: 2px; text-align: center;`,
    });
    stationTitleLabel.clutter_text.set_ellipsize(3);

    const trackLabel = new St.Label({
        text: state.currentTrack,
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: 11px; opacity: 0.65; margin-bottom: 10px; text-align: center;`,
    });
    trackLabel.clutter_text.set_ellipsize(3);

    const playPauseBtn = new St.Button({
        reactive: true,
        can_focus: true,
        x_align: Clutter.ActorAlign.CENTER,
        style: `background-color: ${cssColorToRgba(accentHex, 0.25)}; border-radius: 99px; width: 44px; height: 44px;`,
    });
    const playPauseIcon = new St.Icon({
        icon_name: 'media-playback-start-symbolic',
        icon_size: 20,
        style: `color: ${textColor};`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    playPauseBtn.set_child(playPauseIcon);
    attachButtonFeedback(playPauseBtn);

    const volLabel = new St.Label({
        text: '100%',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-feature-settings: 'tnum'; color: ${textColor}; font-size: 11px; opacity: 0.75; text-align: center;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const stationButtons = [];

    function getCustomIconUri(iconName = 'grid-desktop.svg') {
        const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
        const currentDir = GLib.path_get_dirname(currentFilePath);
        const iconFile = Gio.File.new_for_path(currentDir)
            .get_parent() 
            .get_parent() 
            .get_child('assets')
            .get_child('icons')
            .get_child(iconName);

        if (iconFile.query_exists(null)) {
            return iconFile.get_uri(); 
        }
        return '';
    }

    function updateStationHighlights() {
        state.stations.forEach((_s, idx) => {
            const btn = stationButtons[idx];
            if (!btn) return;
            const isSelected = (state.selectedIndex === idx);
            const bg = isSelected ? cssColorToRgba(textColor, 0.18) : cssColorToRgba(textColor, cardBgAlpha);
            const border = isSelected ? cssColorToRgba(textColor, 0.35) : cssColorToRgba(textColor, cardBorderAlpha);
            btn.style = `background-color: ${bg}; border: 1px solid ${border}; border-radius: 8px; padding: 6px 10px; margin-bottom: 6px; margin-right: 4px;`;
        });
    }

    function findRadioStream() {
        if (!mixerControl) return null;
        const streams = mixerControl.get_streams ? mixerControl.get_streams() : [];

        const sinkInputs = streams.filter(s => {
            if (!s || !(s instanceof Gvc.MixerSinkInput)) return false;
            const name = (s.get_name ? s.get_name() : '') || '';
            return name !== 'sink-input-by-media-role:event';
        });

        if (sinkInputs.length === 0) return null;

        if (sinkInputs.length === 1) return sinkInputs[0];

        const radioStream = sinkInputs.find(s => {
            const name = (s.get_name ? s.get_name() : '').toLowerCase();
            const app = (s.get_application_id ? s.get_application_id() : '').toLowerCase();
            return name.includes('gstreamer') || name.includes('playbin') || app.includes('gnome-shell') || name.includes('gnome-shell');
        });

        return radioStream || sinkInputs[sinkInputs.length - 1];
    }

    function syncFromStream() {
        if (!state.radioStream || !mixerControl) return;
        const maxNorm = mixerControl.get_vol_max_norm() || 65536;
        state.volume = Math.min(1.0, Math.max(0.0, state.radioStream.volume / maxNorm));
        volLabel.set_text(`${Math.round(state.volume * 100)}%`);
        mpris.updateState({ volume: state.volume });
    }

    function bindRadioStream() {
        const stream = findRadioStream();
        if (stream && stream !== state.radioStream) {
            if (state.radioStream && state.streamNotifyId) {
                try { state.radioStream.disconnect(state.streamNotifyId); } catch (_) {}
            }
            state.radioStream = stream;
            state.streamNotifyId = stream.connect('notify::volume', () => syncFromStream());
            syncFromStream();
        }
    }

    function applyStreamVolume(newVal) {
        state.volume = Math.max(0.0, Math.min(1.0, newVal));
        volLabel.set_text(`${Math.round(state.volume * 100)}%`);
        mpris.updateState({ volume: state.volume });

        if (state.radioStream && mixerControl) {
            const maxNorm = mixerControl.get_vol_max_norm() || 65536;
            state.radioStream.volume = Math.round(state.volume * maxNorm);
            if (state.radioStream.is_muted && state.volume > 0) {
                state.radioStream.change_is_muted(false);
            }
            state.radioStream.push_volume();
        } else if (state.player) {
            state.player.set_property('volume', state.volume);
        }
    }
  


    function startRadio() {
        if (!state.player) return;
        const station = state.stations[state.selectedIndex];
        if (!station || !station.url) return;

        state.player.set_state(Gst.State.NULL);
        state.player.set_property('uri', station.url);
        state.player.set_property('volume', 1.0);
        state.player.set_state(Gst.State.PLAYING);

        statusLabel.set_text('Connecting...');
        liveDot.style = `background-color: #f6d32d; border-radius: 99px; margin-right: 6px;`;

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            bindRadioStream();
            return GLib.SOURCE_REMOVE;
        });
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            bindRadioStream();
            return GLib.SOURCE_REMOVE;
        });
    }

    function stopRadio() {
        if (!state.player) return;
        state.player.set_state(Gst.State.NULL);
        state.isPlaying = false;
        state.isBuffering = false;
        playPauseIcon.set_icon_name('media-playback-start-symbolic');
        statusLabel.set_text('Stopped');
        liveDot.style = `background-color: ${cssColorToRgba(textColor, 0.25)}; border-radius: 99px; margin-right: 6px;`;
        trackLabel.set_text('No signal');

        mpris.updateState({
            playbackStatus: 'Stopped',
            trackTitle: 'No signal'
        });
    }

    function toDisplayVolume(linear) {
        return Math.cbrt(Math.max(0.0, Math.min(1.0, linear)));
    }

    const fallbackArtUri = getCustomIconUri('grid-desktop.png'); 

    function selectStation(idx) {
        const wasPlaying = state.isPlaying;
        stopRadio();
        state.selectedIndex = idx;
        const station = state.stations[idx];
        stationTitleLabel.set_text(station.name);
        state.currentTrack = 'Connecting...';
        trackLabel.set_text(state.currentTrack);
        updateStationHighlights();

        const stationArt = station.logo || station.icon || station.artUrl || fallbackArtUri;

        mpris.updateState({
            stationName: station.name,
            trackTitle: 'Connecting...',
            artUrl: stationArt,
        });

        if (wasPlaying) {
            startRadio();
        }
    }

    const mpris = new RadioMprisService({
        onPlayPause: () => {
            if (state.isPlaying || state.isBuffering) {
                stopRadio();
            } else {
                startRadio();
            }
        },
        onPlay: () => {
            if (!state.isPlaying) startRadio();
        },
        onPause: () => {
            if (state.isPlaying) stopRadio();
        },
        onStop: () => {
            stopRadio();
        },
        onNext: () => {
            const nextIdx = (state.selectedIndex + 1) % state.stations.length;
            selectStation(nextIdx);
        },
        onPrevious: () => {
            const prevIdx = (state.selectedIndex - 1 + state.stations.length) % state.stations.length;
            selectStation(prevIdx);
        },
        onSetVolume: (newVol) => {
            applyStreamVolume(newVol);
        }
    });

    try {
        ensureGstreamer()
        state.player = Gst.ElementFactory.make('playbin', 'grid-radio-player');
        if (state.player) {
            state.player.set_property('volume', 1.0);

            const bus = state.player.get_bus();
            bus.add_signal_watch();
            state.busWatchId = bus.connect('message', (_b, msg) => {
                if (!msg) return;

                switch (msg.type) {
                    case Gst.MessageType.TAG: {
                        const tagList = msg.parse_tag();
                        if (tagList) {
                            const extractTag = (tagName) => {
                                try {
                                    const res = tagList.get_string(tagName);
                                    if (Array.isArray(res) && res[0]) return res[1]?.trim() || '';
                                    if (typeof res === 'string') return res.trim();
                                } catch (_) {}
                                return '';
                            };

                            let trackTitle = extractTag('title');
                            let trackArtist = extractTag('artist');

                            if (!trackTitle) {
                                trackTitle = extractTag('organization') || extractTag('description') || extractTag('comment');
                            }

                            let fullTrack = '';
                            if (trackArtist && trackTitle) {
                                if (trackTitle.toLowerCase().includes(trackArtist.toLowerCase())) {
                                    fullTrack = trackTitle;
                                } else {
                                    fullTrack = `${trackArtist} - ${trackTitle}`;
                                }
                            } else if (trackTitle) {
                                fullTrack = trackTitle;
                            } else if (trackArtist) {
                                fullTrack = trackArtist;
                            }

                            fullTrack = fullTrack.trim();

                            const ignoredNames = ['live', 'online', 'stream', 'unknown', 'default'];
                            const isMeaningless = ignoredNames.includes(fullTrack.toLowerCase());

                            if (fullTrack !== '' && !isMeaningless && fullTrack !== state.currentTrack) {
                                state.currentTrack = fullTrack;
                                trackLabel.set_text(state.currentTrack);

                                const stationArt = state.stations[state.selectedIndex]?.logo 
                                    || state.stations[state.selectedIndex]?.icon 
                                    || fallbackArtUri;

                                mpris.updateState({
                                    trackTitle: state.currentTrack,
                                    stationName: state.stations[state.selectedIndex]?.name,
                                    artUrl: stationArt,
                                });
                            }
                        }
                        break;
                    }
                    case Gst.MessageType.BUFFERING: {
                        const percent = msg.parse_buffering();
                        if (percent < 100) {
                            state.isBuffering = true;
                            statusLabel.set_text(`Buffering ${percent}%`);
                            liveDot.style = `background-color: #f6d32d; border-radius: 99px; margin-right: 6px;`;
                        } else {
                            state.isBuffering = false;
                            if (state.isPlaying) {
                                statusLabel.set_text('LIVE');
                                liveDot.style = `background-color: #33d17a; border-radius: 99px; margin-right: 6px;`;
                                if (state.currentTrack === 'No signal' || state.currentTrack === 'Connecting...') {
                                    trackLabel.set_text('Online');
                                }
                            }
                        }
                        break;
                    }
                    case Gst.MessageType.STATE_CHANGED: {
                        if (msg.src === state.player) {
                            const [_oldState, newState, _pending] = msg.parse_state_changed();
                            if (newState === Gst.State.PLAYING) {
                                state.isPlaying = true;
                                state.isBuffering = false;
                                statusLabel.set_text('LIVE');
                                liveDot.style = `background-color: #33d17a; border-radius: 99px; margin-right: 6px;`;
                                playPauseIcon.set_icon_name('media-playback-stop-symbolic');

                                if (state.currentTrack === 'Connecting...') {
                                    state.currentTrack = 'Online';
                                    trackLabel.set_text(state.currentTrack);
                                }

                                mpris.updateState({
                                    playbackStatus: 'Playing',
                                    stationName: state.stations[state.selectedIndex]?.name,
                                    trackTitle: state.currentTrack,
                                    artUrl: state.stations[state.selectedIndex]?.logo || fallbackArtUri,
                                });
                                bindRadioStream();
                            } else if (newState === Gst.State.NULL || newState === Gst.State.READY) {
                                state.isPlaying = false;
                                state.isBuffering = false;
                                statusLabel.set_text('Stopped');
                                liveDot.style = `background-color: ${cssColorToRgba(textColor, 0.25)}; border-radius: 99px; margin-right: 6px;`;
                                playPauseIcon.set_icon_name('media-playback-start-symbolic');
                                mpris.updateState({
                                    playbackStatus: 'Stopped',
                                    trackTitle: 'No signal'
                                });
                            }
                        }
                        break;
                    }
                }
            });
        }
    } catch (e) {
        logError(e, 'Failed to initialize GStreamer playbin');
    }

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${PADDING_H}px;`,
    });
    container.set_child(mainLayout);

    const leftBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        style: 'margin-right: 8px;',
    });

    const listHeader = new St.Label({
        text: 'Radio Stations',
        x_align: Clutter.ActorAlign.START,
        style: `${fontCss}color: ${textColor}; font-size: 13px; font-weight: bold; opacity: 0.8; margin-bottom: 6px;`,
    });
    leftBox.add_child(listHeader);

    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.EXTERNAL,
        overlay_scrollbars: false,
        x_expand: true,
        y_expand: true,
    });
    leftBox.add_child(scrollView);

    const stationList = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(stationList);

    state.stations.forEach((station, idx) => {
        const btn = new St.Button({
            reactive: true,
            can_focus: true,
            x_expand: true,
        });

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        const icon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 14,
            style: `color: ${textColor}; opacity: 0.7; margin-right: 8px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const lbl = new St.Label({
            text: station.name,
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
            style: `${fontCss}color: ${textColor}; font-size: 12px; font-weight: 500;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        lbl.clutter_text.set_ellipsize(3);
        lbl.clutter_text.set_line_wrap(false);

        row.add_child(icon);
        row.add_child(lbl);
        btn.set_child(row);

        btn.connect('clicked', () => {
            selectStation(idx);
        });

        stationButtons.push(btn);
        stationList.add_child(btn);
    });

    mainLayout.add_child(leftBox);

    const rightBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'margin-left: 8px;',
    });

    const statusRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'margin-bottom: 4px;',
    });
    statusRow.add_child(liveDot);
    statusRow.add_child(statusLabel);
    rightBox.add_child(statusRow);

    rightBox.add_child(stationTitleLabel);
    rightBox.add_child(trackLabel);

    const controlsRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    controlsRow.add_child(playPauseBtn);
    rightBox.add_child(controlsRow);

    const volBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        style: 'margin-top: 6px;',
    });

    const volDownIcon = new St.Icon({
        icon_name: 'audio-volume-low-symbolic',
        icon_size: 13,
        style: `color: ${textColor}; opacity: 0.5; margin-right: 4px;`,
    });

    const volUpIcon = new St.Icon({
        icon_name: 'audio-volume-high-symbolic',
        icon_size: 13,
        style: `color: ${textColor}; opacity: 0.5; margin-left: 4px;`,
    });

    volBox.add_child(volDownIcon);
    volBox.add_child(volLabel);
    volBox.add_child(volUpIcon);
    rightBox.add_child(volBox);

    rightBox.reactive = true;
    rightBox.connect('scroll-event', (_actor, event) => {
        const dir = event.get_scroll_direction();
        let step = 0;
        if (dir === Clutter.ScrollDirection.UP) step = 0.05;
        else if (dir === Clutter.ScrollDirection.DOWN) step = -0.05;

          if (state.radioStream && mixerControl) {
            const maxNorm = mixerControl.get_vol_max_norm() || 65536;
            const currentNorm = state.radioStream.volume / maxNorm;
            const newNorm = Math.max(0.0, Math.min(1.0, currentNorm + step));

            state.radioStream.volume = Math.round(newNorm * maxNorm);
            if (state.radioStream.is_muted && newNorm > 0) {
                state.radioStream.change_is_muted(false);
            }
            state.radioStream.push_volume();

            state.volume = newNorm;
            volLabel.set_text(`${Math.round(newNorm * 100)}%`);
            mpris.updateState({ volume: newNorm });
        } else {
            let currentDisplay = toDisplayVolume(state.volume);
            let newDisplay = Math.max(0.0, Math.min(1.0, currentDisplay + step));
            state.volume = toLinearVolume(newDisplay);
            if (state.player) {
                state.player.set_property('volume', state.volume);
            }
            volLabel.set_text(`${Math.round(newDisplay * 100)}%`);
            mpris.updateState({ volume: newDisplay });
        }

        return Clutter.EVENT_STOP;
    });

    mainLayout.add_child(rightBox);

    playPauseBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;

        if (state.isPlaying || state.isBuffering) {
            stopRadio();
        } else {
            startRadio();
        }
        return Clutter.EVENT_STOP;
    });

    container.connect('destroy', () => {
        if (mixerControl && gvcSignalId) {
            try { mixerControl.disconnect(gvcSignalId); } catch (_) {}
            gvcSignalId = 0;
        }
        if (state.radioStream && state.streamNotifyId) {
            try { state.radioStream.disconnect(state.streamNotifyId); } catch (_) {}
            state.streamNotifyId = 0;
        }
        mpris.destroy();
        if (state.player) {
            state.player.set_state(Gst.State.NULL);
            if (state.busWatchId) {
                const bus = state.player.get_bus();
                bus.disconnect(state.busWatchId);
                bus.remove_signal_watch();
            }
            state.player = null;
        }
    });

    updateStationHighlights();

    function updateDimensions(w) {
        const availableWidth = Math.max(0, w - (PADDING_H * 2) - 16);
        const halfWidth = Math.floor(availableWidth / 2);
        leftBox.set_width(halfWidth);
        rightBox.set_width(halfWidth);
    }

    function applyScale(newScale) {
        scale = newScale;

        const currentWidth = container.get_width() || BASE_CONTAINER_WIDTH;
        updateDimensions(currentWidth);

        const listHeaderSize = Math.max(10, Math.round(13 * scale));
        listHeader.style = `${fontCss}color: ${textColor}; font-size: ${listHeaderSize}px; font-weight: bold; opacity: 0.8; margin-bottom: ${Math.round(6 * scale)}px;`;

        const padV = Math.max(3, Math.round(6 * scale));
        const padH = Math.max(5, Math.round(10 * scale));
        const rowMarginB = Math.max(2, Math.round(6 * scale));
        const listFontSize = Math.max(9, Math.round(12 * scale));
        const listIconSize = Math.max(11, Math.round(14 * scale));

        stationButtons.forEach(btn => {
            const row = btn.get_child();
            if (row) {
                const ic = row.get_first_child();
                const lb = row.get_last_child();
                if (ic && ic instanceof St.Icon) ic.icon_size = listIconSize;
                if (lb && lb instanceof St.Label) lb.style = `${fontCss}color: ${textColor}; font-size: ${listFontSize}px; font-weight: 500;`;
            }
        });

        state.stations.forEach((_s, idx) => {
            const btn = stationButtons[idx];
            if (!btn) return;
            const isSelected = (state.selectedIndex === idx);
            const bg = isSelected ? cssColorToRgba(textColor, 0.18) : cssColorToRgba(textColor, cardBgAlpha);
            const border = isSelected ? cssColorToRgba(textColor, 0.35) : cssColorToRgba(textColor, cardBorderAlpha);
            btn.style = `background-color: ${bg}; border: 1px solid ${border}; border-radius: ${Math.round(8 * scale)}px; padding: ${padV}px ${padH}px; margin-bottom: ${rowMarginB}px; margin-right: 4px;`;
        });

        const statusFontSize = Math.max(8, Math.round(10 * scale));
        statusLabel.style = `${fontCss}color: ${textColor}; font-size: ${statusFontSize}px; font-weight: bold; opacity: 0.6;`;

        const titleSize = Math.max(12, Math.round(16 * scale));
        stationTitleLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleSize}px; font-weight: bold; margin-bottom: 2px; text-align: center;`;

        const trackSize = Math.max(9, Math.round(11 * scale));
        trackLabel.style = `${fontCss}color: ${textColor}; font-size: ${trackSize}px; opacity: 0.65; margin-bottom: ${Math.round(8 * scale)}px; text-align: center;`;

        const btnDim = Math.max(30, Math.round(44 * scale));
        const playIconDim = Math.max(14, Math.round(20 * scale));
        playPauseBtn.style = `background-color: ${cssColorToRgba(accentHex, 0.25)}; border-radius: 99px; width: ${btnDim}px; height: ${btnDim}px;`;
        playPauseIcon.icon_size = playIconDim;

        const volFontSize = Math.max(9, Math.round(11 * scale));
        const volIconSize = Math.max(10, Math.round(13 * scale));
        const volWidth = Math.max(32, Math.round(44 * scale));
        volDownIcon.icon_size = volIconSize;
        volUpIcon.icon_size = volIconSize;
        volLabel.width = volWidth;
        volLabel.style = `${fontCss}font-feature-settings: 'tnum'; color: ${textColor}; font-size: ${volFontSize}px; opacity: 0.75; text-align: center;`;
        
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.60, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT)));
    });
  
    GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 400, () => {
        if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
        ensureRadioDesktopFile();
        initAudioIntegration();
        return GLib.SOURCE_REMOVE;
    });

    return container;
}