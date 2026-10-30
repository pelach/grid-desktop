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
    let cleaned = (currentFont || '').replace(/['"]/g, '').replace(/, sans-serif/i, '').trim();
    if (!cleaned) {
        cleaned = 'Cantarell';
    }
    const fontDesc = Pango.FontDescription.from_string(cleaned);
    if (!fontDesc.get_family()) {
        fontDesc.set_family('Cantarell');
    }
    if (fontDesc.get_size() === 0) {
        fontDesc.set_size(DEFAULT_FONT_SIZE_PT * Pango.SCALE);
    }
    return fontDesc;
}

export function createColorRow(title, subtitle, settings, key, defaultVal = DEFAULT_FG_COLOR) {
    const row = new Adw.ActionRow({ 
        title, 
        subtitle,
    });

    const rgba = new Gdk.RGBA();
    const parsed = rgba.parse(settings.get_string(key) || defaultVal);
    if (!parsed) {
        rgba.parse(defaultVal);
    }

    let colorBtn;

    // Modern GNOME 48 (GTK 4.10+) felület: Gtk.ColorDialogButton
    if (Gtk.ColorDialogButton && Gtk.ColorDialog) {
        const dialog = new Gtk.ColorDialog({
            with_alpha: true,
        });

        colorBtn = new Gtk.ColorDialogButton({
            dialog: dialog,
            rgba: rgba,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });

        colorBtn.connect('notify::rgba', () => {
            const newRgba = colorBtn.get_rgba();
            if (newRgba) {
                settings.set_string(key, newRgba.to_string());
            }
        });
    } else {
        // Fallback régebbi verziókhoz
        colorBtn = new Gtk.ColorButton({ 
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            rgba: rgba,
            use_alpha: true,
        });

        colorBtn.connect('color-set', () => {
            settings.set_string(key, colorBtn.get_rgba().to_string());
        });
    }

    const box = new Gtk.Box({
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        baseline_position: Gtk.BaselinePosition.CENTER,
    });
    box.append(colorBtn);

    row.add_suffix(box);
    row.set_activatable_widget(colorBtn);
    return row;
}

export function createOpacityRow(title, subtitle, settings, key) {
    const row = new Adw.ActionRow({ title, subtitle });

    const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 5,
        page_increment: 10,
        value: settings.get_int(key) ?? 100,
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

    adjustment.connect('value-changed', () => {
        const val = Math.round(adjustment.get_value());
        if (settings.get_int(key) !== val) {
            settings.set_int(key, val);
        }
    });

    row.add_suffix(scale);
    return row;
}

export function createRadiusRow(title, subtitle, settings, key) {
    const row = new Adw.ActionRow({ title, subtitle });

    const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: 32,
        step_increment: 1,
        page_increment: 4,
        value: settings.get_int(key) ?? 12,
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

    group.add(createRadiusRow('Global Corner Radius', 'Corner rounding for all widgets in pixels (0–32px).', settings, 'global-border-radius'));
 
    group.add(createColorRow('Global Foreground/Text Color', 'Global default text color.', settings, 'global-foreground-color', DEFAULT_FG_COLOR));

    const fontRow = new Adw.ActionRow({
        title: 'Global Font Family',
        subtitle: 'Choose the default font used across all widgets.',
    });

    const rawFont = settings.get_string('global-font-family') || DEFAULT_FONT_FAMILY || 'Cantarell';
    const cleanFamily = rawFont.replace(/['"]/g, '').replace(/, sans-serif/i, '').trim() || 'Cantarell';

    let fontBtn;

    // Modern GNOME 48 (GTK 4.10+) felület: Gtk.FontDialogButton
    if (Gtk.FontDialogButton && Gtk.FontDialog) {
        const dialog = new Gtk.FontDialog();
        dialog.set_filter(null);
        
        fontBtn = new Gtk.FontDialogButton({
            dialog: dialog,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            use_size: false,
            level: Gtk.FontLevel ? Gtk.FontLevel.FAMILY : 0,
        });

        const fontDesc = Pango.FontDescription.from_string(cleanFamily);
        fontBtn.set_font_desc(fontDesc);

        fontBtn.connect('notify::font-desc', () => {
            const desc = fontBtn.get_font_desc();
            if (desc) {
                const family = desc.get_family() || 'Cantarell';
                settings.set_string('global-font-family', family);
            }
        });
    } else {
        // Fallback régebbi verziókhoz
        fontBtn = new Gtk.FontButton({ 
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            use_size: false,
        });
        if (Gtk.FontChooserLevel) {
            fontBtn.set_level(Gtk.FontChooserLevel.FAMILY);
        }
        const fontDesc = Pango.FontDescription.from_string(`${cleanFamily} 11`);
        fontBtn.set_font(fontDesc.to_string());

        fontBtn.connect('font-set', () => {
            const desc = Pango.FontDescription.from_string(fontBtn.get_font());
            const family = desc.get_family() || 'Cantarell';
            settings.set_string('global-font-family', family);
        });
    }

    const fontBox = new Gtk.Box({
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        baseline_position: Gtk.BaselinePosition.CENTER,
    });
    fontBox.append(fontBtn);

    fontRow.add_suffix(fontBox);
    fontRow.set_activatable_widget(fontBtn);
    group.add(fontRow);

    return group;
}