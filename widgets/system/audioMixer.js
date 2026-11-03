import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    parseCssColor,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';

import { 
    createWidgetContainer, 
    attachResponsiveScaler, 
    attachButtonFeedback,
    registerWidgetCleanup
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 400;
const BASE_CONTAINER_HEIGHT_PX = 200;

// ── Tisztán Cairo-alapú kapszula csúszka a controlsSliders mintájára ──
class CapsuleSlider {
    constructor(activeColorHex, onChangeCallback) {
        this.value = 0.0;
        this.activeColor = parseCssColor(activeColorHex);
        this.trackColor = { r: 1, g: 1, b: 1, a: 0.12 };
        this.onChangeCallback = onChangeCallback;
        this._signalIds = [];

        this.actor = new St.DrawingArea({
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._signalIds.push(this.actor.connect('repaint', (area) => this._draw(area)));

        this._signalIds.push(this.actor.connect('button-press-event', (actor, event) => {
            this._handlePointer(event);
            return Clutter.EVENT_STOP;
        }));

        this._signalIds.push(this.actor.connect('motion-event', (actor, event) => {
            if (event.get_state() & Clutter.ModifierType.BUTTON1_MASK) {
                this._handlePointer(event);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }));

        this._signalIds.push(this.actor.connect('scroll-event', (actor, event) => {
            const dir = event.get_scroll_direction();
            const step = 0.05;
            if (dir === Clutter.ScrollDirection.UP) {
                this.setValue(this.value + step);
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                this.setValue(this.value - step);
            }
            if (this.onChangeCallback) this.onChangeCallback(this.value);
            return Clutter.EVENT_STOP;
        }));
    }

    _handlePointer(event) {
        if (!this.actor) return;
        const [x] = event.get_coords();
        const [actorX] = this.actor.get_transformed_position();
        const width = this.actor.get_width();
        if (width <= 0) return;

        const relX = Math.max(0, Math.min(width, x - actorX));
        this.setValue(relX / width);
        if (this.onChangeCallback) {
            this.onChangeCallback(this.value);
        }
    }

    setValue(val) {
        this.value = Math.max(0.0, Math.min(1.0, val));
        if (this.actor) {
            this.actor.queue_repaint();
        }
    }

    updateStyle(height, trackColorRgba) {
        if (!this.actor) return;
        this.actor.height = height;
        this.trackColor = parseCssColor(trackColorRgba);
        this.actor.queue_repaint();
    }

    _drawRoundedRect(cr, x, y, width, height, radius) {
        const r = Math.min(radius, height / 2, width / 2);
        if (typeof cr.newSubPath === 'function') {
            cr.newSubPath();
        } else if (typeof cr.new_sub_path === 'function') {
            cr.new_sub_path();
        }

        cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
        cr.closePath();
    }

    _draw(area) {
        const cr = area.get_context();
        const width = area.get_width();
        const height = area.get_height();
        if (width <= 0 || height <= 0) return;

        const radius = height / 2;
        this._drawRoundedRect(cr, 0, 0, width, height, radius);

        const trR = this.trackColor.r ?? 1;
        const trG = this.trackColor.g ?? 1;
        const trB = this.trackColor.b ?? 1;
        const trA = this.trackColor.a ?? 0.12;

        if (typeof cr.setSourceRgba === 'function') {
            cr.setSourceRgba(trR, trG, trB, trA);
        } else {
            cr.setSourceRGBA(trR, trG, trB, trA);
        }
        cr.fill();

        if (this.value > 0.01) {
            const fillWidth = Math.max(height, width * this.value);
            const effectiveWidth = Math.min(width, fillWidth);

            this._drawRoundedRect(cr, 0, 0, effectiveWidth, height, radius);
            const actR = this.activeColor.r ?? 0.7;
            const actG = this.activeColor.g ?? 0.88;
            const actB = this.activeColor.b ?? 0.97;

            if (typeof cr.setSourceRgba === 'function') {
                cr.setSourceRgba(actR, actG, actB, 1.0);
            } else {
                cr.setSourceRGBA(actR, actG, actB, 1.0);
            }
            cr.fill();
        }

        cr.$dispose();
    }

    destroy() {
        if (this.actor) {
            for (const sigId of this._signalIds) {
                if (sigId) {
                    try { this.actor.disconnect(sigId); } catch (_) {}
                }
            }
            this._signalIds = [];
            this.actor.destroy();
            this.actor = null;
        }
        this.onChangeCallback = null;
    }
}

export function createAudioMixerNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));

    const volActiveColor = '#b8e2f8';
    const appActiveColor = '#a3c9be';
    const sliderTrackColor = cssColorToRgba(textColor, isDarkSurface ? 0.12 : 0.08);
    const iconBtnBg = cssColorToRgba(textColor, isDarkSurface ? 0.10 : 0.06);

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // ── 1. Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });
    const headerIcon = new St.Icon({
        icon_name: 'audio-volume-high-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Audio Mixer',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // ── 2. Fix Master Hangerő Sor ──
    const masterSection = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    contentBox.add_child(masterSection);

    const masterRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const masterBtn = new St.Button({ reactive: true, can_focus: true, y_align: Clutter.ActorAlign.CENTER });
    attachButtonFeedback(masterBtn);
    const masterIcon = new St.Icon({
        icon_name: 'audio-volume-high-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });
    masterBtn.set_child(masterIcon);

    const quickSettings = Main.panel?.statusArea?.quickSettings;
    const volIndicator = quickSettings?._volumeOutput;
    const mixerControl = volIndicator?._control;

    let masterSlider = new CapsuleSlider(volActiveColor, (val) => {
        const stream = volIndicator?._stream || mixerControl?.get_default_sink();
        if (stream) {
            const maxVol = mixerControl?.get_vol_max_norm() || 65536;
            stream.volume = Math.round(val * maxVol);
            if (stream.is_muted && val > 0) {
                stream.change_is_muted(false);
            }
            stream.push_volume();
        }
        updateMasterPercent();
    });

    const masterPercentLabel = new St.Label({
        text: '0%',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });

    masterRow.add_child(masterBtn);
    masterRow.add_child(masterSlider.actor);
    masterRow.add_child(masterPercentLabel);
    masterSection.add_child(masterRow);

    masterBtn.connect('clicked', () => {
        const stream = volIndicator?._stream || mixerControl?.get_default_sink();
        if (stream) {
            stream.change_is_muted(!stream.is_muted);
            stream.push_volume();
            syncMasterVolume();
        }
    });

    function updateMasterPercent() {
        if (!masterSlider) return;
        masterPercentLabel.text = `${Math.round(masterSlider.value * 100)}%`;
    }

    function syncMasterVolume() {
        if (isActorDestroyed(container) || !masterSlider) return;
        const stream = volIndicator?._stream || mixerControl?.get_default_sink();
        if (!stream) return;

        if (stream.is_muted) {
            masterSlider.setValue(0);
            masterIcon.icon_name = 'audio-volume-muted-symbolic';
        } else {
            const maxVol = mixerControl?.get_vol_max_norm() || 65536;
            const normVal = Math.min(1.0, stream.volume / maxVol);
            masterSlider.setValue(normVal);
            if (normVal <= 0.01) masterIcon.icon_name = 'audio-volume-muted-symbolic';
            else if (normVal < 0.35) masterIcon.icon_name = 'audio-volume-low-symbolic';
            else if (normVal < 0.70) masterIcon.icon_name = 'audio-volume-medium-symbolic';
            else masterIcon.icon_name = 'audio-volume-high-symbolic';
        }
        updateMasterPercent();
    }

    // ── 3. Görgethető Alkalmazás-lista ──
    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        x_expand: true,
        y_expand: true,
    });
    contentBox.add_child(scrollView);

    const appsListContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(appsListContainer);

    // Aktív app sorok kezelése
    let appItems = [];

    function cleanupAppItems() {
        appItems.forEach(item => {
            if (item.slider) item.slider.destroy();
            if (item.notifyId && item.stream) {
                try { item.stream.disconnect(item.notifyId); } catch (_) {}
            }
        });
        appItems = [];
        appsListContainer.destroy_all_children();
    }

    function getAppStreams() {
        if (!mixerControl) return [];
        const streams = mixerControl.get_streams ? mixerControl.get_streams() : [];
        return streams.filter(s => {
            if (!s) return false;
            const name = s.get_name ? s.get_name() : '';
            return (s instanceof Gvc.MixerSinkInput) && name !== 'sink-input-by-media-role:event';
        });
    }

    function refreshApps() {
        if (isActorDestroyed(container)) return;
        cleanupAppItems();

        const streams = getAppStreams();
        const maxNorm = mixerControl?.get_vol_max_norm() || 65536;

        const rowGap = Math.max(8, Math.round(10 * scale));
        const btnSize = Math.max(22, Math.round(26 * scale));
        const sliderHeight = Math.max(16, Math.round(20 * scale));
        const btnIconSize = Math.max(12, Math.round(14 * scale));
        const fontSize = Math.max(9, Math.round(11 * scale));
        const pctWidth = Math.max(26, Math.round(30 * scale));

        streams.forEach(stream => {
            const rowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `margin-bottom: ${rowGap}px;`,
            });

            // App ikon feloldása
            let iconName = stream.get_icon_name ? stream.get_icon_name() : null;
            if (!iconName && stream.get_application_id) {
                iconName = stream.get_application_id();
            }
            if (!iconName) {
                iconName = 'audio-speakers-symbolic';
            }

            const appBtn = new St.Button({
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `width: ${btnSize}px; height: ${btnSize}px; border-radius: ${Math.round(btnSize / 2)}px; background-color: ${iconBtnBg}; margin-right: ${rowGap}px;`,
            });
            attachButtonFeedback(appBtn);

            const appIcon = new St.Icon({
                icon_name: iconName,
                icon_size: btnIconSize,
                style: `color: ${textColor};`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            appBtn.set_child(appIcon);

            // Némítás gomb működése
            appBtn.connect('clicked', () => {
                stream.change_is_muted(!stream.is_muted);
                stream.push_volume();
            });

            // Csúszka
            const appSlider = new CapsuleSlider(appActiveColor, (val) => {
                stream.volume = Math.round(val * maxNorm);
                if (stream.is_muted && val > 0) {
                    stream.change_is_muted(false);
                }
                stream.push_volume();
                pctLabel.text = `${Math.round(val * 100)}%`;
            });
            appSlider.updateStyle(sliderHeight, sliderTrackColor);

            const pctLabel = new St.Label({
                text: '0%',
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${fontSize}px; font-weight: bold; margin-left: ${rowGap}px;`,
            });
            pctLabel.width = pctWidth;

            // Szinkronizálás a stream adataival
            const syncAppVolume = () => {
                if (stream.is_muted) {
                    appSlider.setValue(0);
                    appIcon.opacity = 120;
                } else {
                    const norm = Math.min(1.0, stream.volume / maxNorm);
                    appSlider.setValue(norm);
                    appIcon.opacity = 255;
                }
                pctLabel.text = `${Math.round(appSlider.value * 100)}%`;
            };

            const notifyId = stream.connect('notify::volume', syncAppVolume);
            syncAppVolume();

            rowBox.add_child(appBtn);
            rowBox.add_child(appSlider.actor);
            rowBox.add_child(pctLabel);
            appsListContainer.add_child(rowBox);

            appItems.push({
                stream,
                slider: appSlider,
                notifyId,
            });
        });
    }

    // ── Skálázás ──
    function applyScale(newScale) {
        scale = newScale;

        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);
        const pad = Math.max(8, Math.round(10 * scale));
        const rowGap = Math.max(8, Math.round(10 * scale));
        const btnSize = Math.max(22, Math.round(26 * scale));
        const sliderHeight = Math.max(16, Math.round(20 * scale));
        const btnIconSize = Math.max(12, Math.round(14 * scale));
        const fontSize = Math.max(10, Math.round(12 * scale));
        const pctWidth = Math.max(26, Math.round(32 * scale));

        contentBox.style = `padding: ${pad}px;`;
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        masterSection.style = `margin-bottom: ${Math.round(8 * scale)}px; padding-bottom: ${Math.round(4 * scale)}px; border-bottom: 1px solid ${cssColorToRgba(textColor, 0.08)};`;
        masterBtn.style = `width: ${btnSize}px; height: ${btnSize}px; border-radius: ${Math.round(btnSize / 2)}px; background-color: ${iconBtnBg}; margin-right: ${rowGap}px;`;
        masterIcon.icon_size = btnIconSize;
        masterIcon.style = `color: ${textColor};`;
        masterSlider.updateStyle(sliderHeight, sliderTrackColor);
        masterPercentLabel.style = `${fontCss}color: ${textColor}; font-size: ${fontSize}px; font-weight: bold; margin-left: ${rowGap}px;`;
        masterPercentLabel.width = pctWidth;

        syncMasterVolume();
        refreshApps();
    }

    // ── Szignálok és takarítás ──
    const signalIds = [];
    let sigMasterNotify = 0;

    if (mixerControl) {
        signalIds.push(mixerControl.connect('default-sink-changed', () => {
            const stream = volIndicator?._stream || mixerControl.get_default_sink();
            if (stream && !sigMasterNotify) {
                sigMasterNotify = stream.connect('notify::volume', syncMasterVolume);
            }
            syncMasterVolume();
        }));

        signalIds.push(mixerControl.connect('stream-added', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                refreshApps();
                return GLib.SOURCE_REMOVE;
            });
        }));

        signalIds.push(mixerControl.connect('stream-removed', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                refreshApps();
                return GLib.SOURCE_REMOVE;
            });
        }));
    }

    const currentMaster = volIndicator?._stream || mixerControl?.get_default_sink();
    if (currentMaster) {
        sigMasterNotify = currentMaster.connect('notify::volume', syncMasterVolume);
    }

    const cleanup = () => {
        if (currentMaster && sigMasterNotify) {
            try { currentMaster.disconnect(sigMasterNotify); } catch (_) {}
            sigMasterNotify = 0;
        }
        if (mixerControl) {
            signalIds.forEach(id => {
                try { mixerControl.disconnect(id); } catch (_) {}
            });
        }
        cleanupAppItems();
        if (masterSlider) {
            masterSlider.destroy();
            masterSlider = null;
        }
    };

    container.connect('destroy', cleanup);
    registerWidgetCleanup(container, cleanup);

    applyScale(scale);

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        if (!isActorDestroyed(container)) {
            syncMasterVolume();
            refreshApps();
        }
        return GLib.SOURCE_REMOVE;
    });

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}