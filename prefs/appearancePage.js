import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import { buildGlobalAestheticsGroup, createSwitchRow } from './aestheticControls.js';
import { DEFAULT_BG_COLOR, DEFAULT_FG_COLOR } from '../utils/widgetUtils.js';
import { THEMES, applyTheme } from './themes.js';

export function buildAppearancePage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Appearance',
        icon_name: 'preferences-desktop-appearance-symbolic',
    });

    // 1. SYSTEM THEME CSOPORT
    const systemGroup = new Adw.PreferencesGroup({
        title: 'System Theme',
        description: 'Choose whether widgets follow GNOME system colors or custom aesthetics.',
    });

    const followSystemSwitch = createSwitchRow(
        'Follow System Theme',
        'Use Adwaita light/dark colors based on the GNOME color scheme instead of custom colors below.',
        settings,
        'follow-system-theme'
    );
    systemGroup.add(followSystemSwitch.row);
    page.add(systemGroup);

    // 2. THEME PRESETS CSOPORT
    const themeGroup = new Adw.PreferencesGroup({
        title: 'Theme Presets',
        description: 'Choose a built-in colour scheme. Themes set global defaults; per-widget overrides are preserved.',
    });

    const model = new Gtk.StringList();
    model.append('No Theme');
    THEMES.forEach(t => model.append(t.name));

    const currentThemeId = settings.get_string('theme');
    const matchedThemeIndex = THEMES.findIndex(t => t.id === currentThemeId);
    const currentIdx = currentThemeId && matchedThemeIndex !== -1 ? matchedThemeIndex + 1 : 0;

    const themeRow = new Adw.ComboRow({
        title: 'Color Theme',
        subtitle: 'Select a preset theme to apply across all widgets.',
        model,
        selected: currentIdx,
    });
    themeRow.set_size_request(-1, 50);

    themeRow.connect('notify::selected', () => {
        const idx = themeRow.get_selected();
        if (idx === 0) {
            settings.set_string('theme', '');
            settings.set_string('global-background-color', DEFAULT_BG_COLOR);
            settings.set_string('global-foreground-color', DEFAULT_FG_COLOR);
            settings.set_string('accent-color-override', '');
            return;
        }
        const theme = THEMES[idx - 1];
        if (theme) {
            applyTheme(settings, theme.id);
            settings.set_string('theme', theme.id);
        }
    });
    themeGroup.add(themeRow);

    const accentRow = new Adw.ActionRow({
        title: 'Accent Color Override',
        subtitle: 'Manually set the accent color. Leave empty to use the system or theme default.',
    });

    const accentRgba = new Gdk.RGBA();
    const currentAccent = settings.get_string('accent-color-override');
    accentRgba.parse(currentAccent || '#3584e4');

    let accentBtn;
    if (Gtk.ColorDialogButton && Gtk.ColorDialog) {
        const dialog = new Gtk.ColorDialog({ with_alpha: false });
        accentBtn = new Gtk.ColorDialogButton({
            dialog,
            rgba: accentRgba,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        accentBtn.connect('notify::rgba', () => {
            const newRgba = accentBtn.get_rgba();
            if (newRgba) {
                settings.set_string('accent-color-override', newRgba.to_string());
            }
        });
    } else {
        accentBtn = new Gtk.ColorButton({
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            rgba: accentRgba,
            use_alpha: false,
        });
        accentBtn.connect('color-set', () => {
            settings.set_string('accent-color-override', accentBtn.get_rgba().to_string());
        });
    }

    const accentBox = new Gtk.Box({
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        baseline_position: Gtk.BaselinePosition.CENTER,
    });
    accentBox.append(accentBtn);

    accentRow.add_suffix(accentBox);
    accentRow.set_activatable_widget(accentBtn);
    themeGroup.add(accentRow);

    page.add(themeGroup);

    // 3. AESTHETICS CSOPORT
    const aestheticsGroup = buildGlobalAestheticsGroup(settings);
    page.add(aestheticsGroup);

    // Dinamikus érzékenység: ha a rendszer téma él, a manuális színek tiltva vannak
    const updateSensitiveness = () => {
        const followSystem = settings.get_boolean('follow-system-theme');
        themeGroup.set_sensitive(!followSystem);
        aestheticsGroup.set_sensitive(!followSystem);
    };

    updateSensitiveness();
    followSystemSwitch.row.connect('notify::active', updateSensitiveness);

    // 4. DESKTOP GRID LAYOUT CSOPORT
    const gridGroup = new Adw.PreferencesGroup({
        title: 'Desktop Grid Layout',
        description: 'Configure desktop grid layout visibility.',
    });

    const CELL_SIZES = [
        { label: 'Compact (68 px)', size: 68 },
        { label: 'Standard (80 px)', size: 80 },
        { label: 'Large (96 px)', size: 96 },
        { label: 'Extra Large / HiDPI (112 px)', size: 112 },
    ];

    const cellSizeModel = new Gtk.StringList();
    CELL_SIZES.forEach(opt => cellSizeModel.append(opt.label));

    const currentCellSize = settings.get_int('grid-cell-size') || 80;
    const matchedCellIdx = CELL_SIZES.findIndex(opt => opt.size === currentCellSize);

    const cellSizeRow = new Adw.ComboRow({
        title: 'Grid Cell Size',
        subtitle: 'Base dimensions for desktop icons and proportional widget bounds.',
        model: cellSizeModel,
        selected: matchedCellIdx !== -1 ? matchedCellIdx : 1,
    });
    cellSizeRow.set_size_request(-1, 50);

    cellSizeRow.connect('notify::selected', () => {
        const selectedOpt = CELL_SIZES[cellSizeRow.get_selected()];
        if (selectedOpt) {
            settings.set_int('grid-cell-size', selectedOpt.size);
        }
    });
    gridGroup.add(cellSizeRow);

    // --- RÁCSTÉRKÖZ CSÚSZKA (4 px-es lépésekkel: 4, 8, 12, 16, 20, 24, 28, 32 px) ---
    const currentGap = settings.get_int('grid-gap-size') || 16;
    const gapAdjustment = new Gtk.Adjustment({
        lower: 4,
        upper: 32,
        step_increment: 4,
        page_increment: 4,
        value: currentGap,
    });

    const gapScale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: gapAdjustment,
        draw_value: true,
        value_pos: Gtk.PositionType.RIGHT,
        hexpand: true,
        width_request: 140,
        valign: Gtk.Align.CENTER,
        round_digits: 0,
    });
    gapScale.set_digits(0);

    // Vizuális jelölők a skálán a főbb macOS megállókhoz
    [8, 16, 24].forEach(tick => {
        gapScale.add_mark(tick, Gtk.PositionType.BOTTOM, null);
    });

    gapScale.connect('value-changed', () => {
        const rawVal = gapScale.get_value();
        const snappedVal = Math.round(rawVal / 4) * 4;
        if (rawVal !== snappedVal) {
            gapScale.set_value(snappedVal);
            return;
        }
        settings.set_int('grid-gap-size', snappedVal);
    });

    const gapRow = new Adw.ActionRow({
        title: 'Grid Spacing',
        subtitle: 'Distance between icons and widgets in pixels.',
    });
    gapRow.add_suffix(gapScale);
    gridGroup.add(gapRow);
    
    gridGroup.add(createSwitchRow('Visualize Grid Overlay', 'Show grid lines on the desktop for easier widget alignment.', settings, 'show-grid').row);
    page.add(gridGroup);
    return page;
}