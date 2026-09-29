import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import { DEFAULT_FONT_FAMILY, DEFAULT_BG_COLOR, DEFAULT_FG_COLOR } from '../utils/widgetUtils.js';

// Fallback point size when input has no explicit size.
const DEFAULT_FONT_SIZE_PT = 11;

// Applies DEFAULT_FONT_SIZE_PT when the input carries no explicit size.
export function createNormalizedFontDescription(currentFont) {
    const cleaned = (currentFont || '').replace(/'/g, '').replace(/, sans-serif/i, '').trim();
    const fontDesc = cleaned
        ? Pango.FontDescription.from_string(cleaned)
        : new Pango.FontDescription();
    if (fontDesc.get_size() === 0)
        fontDesc.set_size(DEFAULT_FONT_SIZE_PT * Pango.SCALE);
    return fontDesc;
}

function createColorRow(title, subtitle, settings, key, defaultVal = DEFAULT_FG_COLOR) {
    const row = new Adw.ActionRow({ title, subtitle });
    const btn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER });
    const rgba = new Gdk.RGBA();
    const parsed = rgba.parse(settings.get_string(key) || defaultVal);
    if (!parsed)
        rgba.parse(defaultVal);
    btn.set_rgba(rgba);
    btn.connect('color-set', () => {
        settings.set_string(key, btn.get_rgba().to_string());
    });
    row.add_suffix(btn);
    return row;
}

export function createOpacityRow(title, subtitle, settings, key) {
    const row = new Adw.ActionRow({ title, subtitle });

    const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 5,
        page_increment: 10,
        value: settings.get_int(key) || 100,
    });

    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: adjustment,
        draw_value: true,
        value_pos: Gtk.PositionType.RIGHT,
        hexpand: true,
        width_request: 160,
        valign: Gtk.Align.CENTER,
    });
    scale.set_digits(0);

    // KÖZVETLEN MENTÉS A CSÚSZTATÁSKOR:
    adjustment.connect('value-changed', () => {
        const val = Math.round(adjustment.get_value());
        if (settings.get_int(key) !== val) {
            settings.set_int(key, val);
        }
    });

    row.add_suffix(scale);
    return row;
}

export function createSwitchRow(title, subtitle, settings, key) {
    const row = new Adw.SwitchRow({ title, subtitle });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return { row };
}

export function buildGlobalAestheticsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Aesthetics',
        description: 'Tweak the default visual style applied to all widgets.',
    });

    group.add(createColorRow('Global Background Color', 'Global default background color.', settings, 'global-background-color', DEFAULT_BG_COLOR));
    group.add(createOpacityRow('Global Background Opacity', 'Opacity level of the widget background (0–100%).', settings, 'global-background-opacity'));
    group.add(createColorRow('Global Foreground/Text Color', 'Global default text color.', settings, 'global-foreground-color', DEFAULT_FG_COLOR));

    const fontRow = new Adw.ActionRow({
        title: 'Global Font Family',
        subtitle: 'Choose the default font used across all widgets.',
    });
    const fontBtn = new Gtk.FontButton({ valign: Gtk.Align.CENTER });
    const currentFont = settings.get_string('global-font-family') || DEFAULT_FONT_FAMILY;
    fontBtn.set_font(createNormalizedFontDescription(currentFont).to_string());
    fontBtn.connect('font-set', () => {
        const desc = Pango.FontDescription.from_string(fontBtn.get_font());
        const family = desc.get_family();
        if (family) {
            settings.set_string('global-font-family', `'${family}', sans-serif`);
        }
    });
    fontRow.add_suffix(fontBtn);
    group.add(fontRow);

    return group;
}