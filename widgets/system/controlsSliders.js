import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
    attachButtonFeedback 
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 240;
const BASE_CONTAINER_HEIGHT_PX = 140;
const BORDER_ALPHA = 0.14;

// Tisztán Cairo-alapú kapszula csúszka (garantáltan balról jobbra, 0 allocation hiba)
class CapsuleSlider {
    constructor(activeColorHex, onChangeCallback) {
        this.value = 0.0;
        this.activeColor = parseCssColor(activeColorHex);
        this.trackColor = { r: 1, g: 1, b: 1, a: 0.12 };
        this.onChangeCallback = onChangeCallback;

        this.actor = new St.DrawingArea({
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.actor.connect('repaint', (area) => this._draw(area));

        this.actor.connect('button-press-event', (actor, event) => {
            this._handlePointer(event);
            return Clutter.EVENT_STOP;
        });

        this.actor.connect('motion-event', (actor, event) => {
            if (event.get_state() & Clutter.ModifierType.BUTTON1_MASK) {
                this._handlePointer(event);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.actor.connect('scroll-event', (actor, event) => {
            const dir = event.get_scroll_direction();
            const step = 0.05;
            if (dir === Clutter.ScrollDirection.UP) {
                this.setValue(this.value + step);
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                this.setValue(this.value - step);
            }
            if (this.onChangeCallback) this.onChangeCallback(this.value);
            return Clutter.EVENT_STOP;
        });
    }

    _handlePointer(event) {
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
        this.actor.queue_repaint();
    }

    updateStyle(height, trackColorRgba) {
        this.actor.height = height;
        this.trackColor = parseCssColor(trackColorRgba);
        this.actor.queue_repaint();
    }

    _drawRoundedRect(cr, x, y, width, height, radius) {
        const r = Math.min(radius, height / 2, width / 2);
        
        // GJS Cairo kompatibilis új rész-útvonal
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

        // 1. Háttér sáv kirajzolása (teljes szélesség)
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

        // 2. Aktív csík kirajzolása (balról jobbra)
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
}

export function createControlsSlidersNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));

    const volActiveColor = '#b8e2f8';
    const brightActiveColor = '#a3c9be';
    const sliderTrackColor = cssColorToRgba(textColor, isDarkSurface ? 0.12 : 0.08);
    const iconBtnBg = cssColorToRgba(textColor, isDarkSurface ? 0.10 : 0.06);

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // Fejléc
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const headerIcon = new St.Icon({
        icon_name: 'preferences-system-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Controls',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // Backendek elérése
    const quickSettings = Main.panel?.statusArea?.quickSettings;
    const volIndicator = quickSettings?._volumeOutput;
    
    let brightnessProxy = null;
    try {
        brightnessProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_interface_name: 'org.gnome.SettingsDaemon.Power.Screen',
            g_name: 'org.gnome.SettingsDaemon.Power',
            g_object_path: '/org/gnome/SettingsDaemon/Power',
        });
        brightnessProxy.init(null);
    } catch (e) {
        console.debug('ControlsSliders: Brightness D-Bus proxy error:', e);
    }

    // 1. SOR: Hangerő
    const volRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const volBtn = new St.Button({ reactive: true, can_focus: true });
    attachButtonFeedback(volBtn);
    const volIcon = new St.Icon({
        icon_name: 'audio-volume-high-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });
    volBtn.set_child(volIcon);

    const volSlider = new CapsuleSlider(volActiveColor, (val) => {
        const stream = volIndicator?._stream || volIndicator?._control?.get_default_sink();
        if (stream) {
            const maxVol = volIndicator?._control?.get_vol_max_norm() || 65536;
            stream.volume = Math.round(val * maxVol);
            if (stream.is_muted && val > 0) {
                stream.change_is_muted(false);
            }
            stream.push_volume();
        }
        updatePercentLabels();
    });

    const volPercentLabel = new St.Label({
        text: '0%',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });

    volRow.add_child(volBtn);
    volRow.add_child(volSlider.actor);
    volRow.add_child(volPercentLabel);
    contentBox.add_child(volRow);

    volBtn.connect('clicked', () => {
        const stream = volIndicator?._stream || volIndicator?._control?.get_default_sink();
        if (stream) {
            stream.change_is_muted(!stream.is_muted);
            stream.push_volume();
            syncVolume();
        }
    });

    // 2. SOR: Fényerő
    const brightRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const brightBtn = new St.Button({ reactive: true, can_focus: true });
    attachButtonFeedback(brightBtn);
    const brightIcon = new St.Icon({
        icon_name: 'display-brightness-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });
    brightBtn.set_child(brightIcon);

    const brightSlider = new CapsuleSlider(brightActiveColor, (val) => {
        const target = Math.round(val * 100);
        if (brightnessProxy) {
            try {
                brightnessProxy.set_cached_property('Brightness', new GLib.Variant('i', target));
                brightnessProxy.call(
                    'org.freedesktop.DBus.Properties.Set',
                    new GLib.Variant('(ssv)', [
                        'org.gnome.SettingsDaemon.Power.Screen',
                        'Brightness',
                        new GLib.Variant('i', target),
                    ]),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    null
                );
            } catch (err) {
                console.debug('ControlsSliders: Error setting brightness via D-Bus:', err);
            }
        } else if (quickSettings?._brightness?._slider) {
            quickSettings._brightness._slider.value = val;
        }
        updatePercentLabels();
    });

    const brightPercentLabel = new St.Label({
        text: '0%',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });

    brightRow.add_child(brightBtn);
    brightRow.add_child(brightSlider.actor);
    brightRow.add_child(brightPercentLabel);
    contentBox.add_child(brightRow);

    brightBtn.connect('clicked', () => {
        let current = brightSlider.value;
        let target = current > 0.1 ? 0.05 : 0.50;
        brightSlider.setValue(target);
        if (brightSlider.onChangeCallback) {
            brightSlider.onChangeCallback(target);
        }
    });

    function updatePercentLabels() {
        const v = Math.round(volSlider.value * 100);
        const b = Math.round(brightSlider.value * 100);
        volPercentLabel.text = `${v}%`;
        brightPercentLabel.text = `${b}%`;
    }

    function syncVolume() {
        if (isActorDestroyed(container)) return;
        const stream = volIndicator?._stream || volIndicator?._control?.get_default_sink();
        if (!stream) return;

        if (stream.is_muted) {
            volSlider.setValue(0);
            volIcon.icon_name = 'audio-volume-muted-symbolic';
        } else {
            const maxVol = volIndicator?._control?.get_vol_max_norm() || 65536;
            const normVal = Math.min(1.0, stream.volume / maxVol);
            volSlider.setValue(normVal);
            if (normVal <= 0.01) volIcon.icon_name = 'audio-volume-muted-symbolic';
            else if (normVal < 0.35) volIcon.icon_name = 'audio-volume-low-symbolic';
            else if (normVal < 0.70) volIcon.icon_name = 'audio-volume-medium-symbolic';
            else volIcon.icon_name = 'audio-volume-high-symbolic';
        }
        updatePercentLabels();
    }

    function syncBrightness() {
        if (isActorDestroyed(container)) return;
        let bVal = -1;

        if (brightnessProxy) {
            const prop = brightnessProxy.get_cached_property('Brightness');
            if (prop) {
                bVal = prop.unpack() / 100;
            }
        }
        if (bVal < 0 && quickSettings?._brightness?._slider) {
            bVal = quickSettings._brightness._slider.value;
        }

        if (bVal >= 0) {
            brightSlider.setValue(bVal);
            updatePercentLabels();
        }
    }

    function applyScale(newScale) {
        scale = newScale;

        const pad = Math.max(6, Math.round(8 * scale));
        const rowGap = Math.max(4, Math.round(6 * scale));
        const btnSize = Math.max(26, Math.round(30 * scale));
        const sliderHeight = Math.max(20, Math.round(24 * scale));
        const iconSize = Math.max(14, Math.round(16 * scale));
        const fontSize = Math.max(9, Math.round(11 * scale));
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const pctWidth = Math.max(26, Math.round(36 * scale));

        contentBox.style = `padding: ${pad}px;`;
        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        volRow.style = `margin-bottom: ${rowGap}px;`;
        volBtn.style = `width: ${btnSize}px; height: ${btnSize}px; border-radius: ${Math.round(btnSize / 2)}px; background-color: ${iconBtnBg}; margin-right: ${rowGap}px;`;
        volIcon.icon_size = iconSize;
        volIcon.style = `color: ${textColor};`;
        volSlider.updateStyle(sliderHeight, sliderTrackColor);
        volPercentLabel.style = `${fontCss}color: ${textColor}; font-size: ${fontSize}px; font-weight: bold; margin-left: ${rowGap}px;`;
        volPercentLabel.width = pctWidth;

        brightBtn.style = `width: ${btnSize}px; height: ${btnSize}px; border-radius: ${Math.round(btnSize / 2)}px; background-color: ${iconBtnBg}; margin-right: ${rowGap}px;`;
        brightIcon.icon_size = iconSize;
        brightIcon.style = `color: ${textColor};`;
        brightSlider.updateStyle(sliderHeight, sliderTrackColor);
        brightPercentLabel.style = `${fontCss}color: ${textColor}; font-size: ${fontSize}px; font-weight: bold; margin-left: ${rowGap}px;`;
        brightPercentLabel.width = pctWidth;

        syncVolume();
        syncBrightness();
    }

    // Eseményfeliratkozások
    let sigVolChanged = 0;
    let sigDefaultSink = 0;
    let sigBrightProp = 0;

    const mixerControl = volIndicator?._control;
    if (mixerControl) {
        sigDefaultSink = mixerControl.connect('default-sink-changed', () => {
            const stream = volIndicator?._stream || mixerControl.get_default_sink();
            if (stream && !sigVolChanged) {
                sigVolChanged = stream.connect('notify::volume', syncVolume);
            }
            syncVolume();
        });
    }

    const currentStream = volIndicator?._stream || mixerControl?.get_default_sink();
    if (currentStream) {
        sigVolChanged = currentStream.connect('notify::volume', syncVolume);
    }

    if (brightnessProxy) {
        sigBrightProp = brightnessProxy.connect('g-properties-changed', syncBrightness);
    }

    container.connect('destroy', () => {
        const stream = volIndicator?._stream || mixerControl?.get_default_sink();
        if (stream && sigVolChanged) {
            try { stream.disconnect(sigVolChanged); } catch (e) {}
        }
        if (mixerControl && sigDefaultSink) {
            try { mixerControl.disconnect(sigDefaultSink); } catch (e) {}
        }
        if (brightnessProxy && sigBrightProp) {
            try { brightnessProxy.disconnect(sigBrightProp); } catch (e) {}
        }
    });

    applyScale(scale);

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        if (!isActorDestroyed(container)) {
            syncVolume();
            syncBrightness();
        }
        return GLib.SOURCE_REMOVE;
    });

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}