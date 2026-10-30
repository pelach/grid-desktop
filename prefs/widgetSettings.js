import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { isWideMusicLayout, DEFAULT_FONT_FAMILY, DEFAULT_BG_COLOR, DEFAULT_FG_COLOR } from '../utils/widgetUtils.js';
import { openImageFileDialog } from './fileDialogs.js';
import { DEFAULT_RSS_REFRESH_MINUTES } from './widgetAdders.js';
import { createLiveCitySearchRow, buildOpenMeteoCitySearchRow } from './citySearch.js';
import { createAppSelectionControls } from './appSelection.js';
import { buildCaptionControls } from './captionControls.js';
import { getConnectedMonitorsCount, buildMonitorEntries } from './displayUtils.js';
import { DEFAULT_WORLD_CLOCK_CITIES, MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC, DEFAULT_SLIDESHOW_INTERVAL_SEC } from './widgetConstants.js';
import { LAVA_THEMES } from '../utils/lavaThemes.js';

const MIN_POMODORO_MINUTES = 1;
const MAX_POMODORO_MINUTES = 120;
const POMODORO_MINUTE_STEP = 1;
const MIN_SESSIONS_BEFORE_LONG_BREAK = 1;
const MAX_SESSIONS_BEFORE_LONG_BREAK = 10;
const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_SHORT_BREAK_MINUTES = 5;
const DEFAULT_LONG_BREAK_MINUTES = 15;
const DEFAULT_SESSIONS_BEFORE_LONG_BREAK = 4;
const RSS_MIN_REFRESH_MINUTES = 5;
const RSS_MAX_REFRESH_MINUTES = 720;
const RSS_REFRESH_STEP_MINUTES = 5;

function createColorButton(initialRgbaStr, onColorChanged) {
    const rgba = new Gdk.RGBA();
    rgba.parse(initialRgbaStr);

    let btn;
    if (Gtk.ColorDialogButton && Gtk.ColorDialog) {
        const dialog = new Gtk.ColorDialog({ with_alpha: true });
        btn = new Gtk.ColorDialogButton({
            dialog,
            rgba,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        btn.connect('notify::rgba', () => {
            const val = btn.get_rgba();
            if (val && onColorChanged) onColorChanged(val.to_string());
        });
    } else {
        btn = new Gtk.ColorButton({
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            rgba,
            use_alpha: true,
        });
        btn.connect('color-set', () => {
            if (onColorChanged) onColorChanged(btn.get_rgba().to_string());
        });
    }
    return btn;
}

export function buildStandardSettings(container, widget, settings, saveHandlers) {
    const isImageOrMedia = widget.type === 'slideshow' || widget.type === 'image' || widget.type === 'gif' || widget.type === 'lavaLamp' || widget.imagePath;

    let bgColorBtn, bgOpacityScale, fgColorBtn, fontBtn, colorSwitchRow;
    let selectedBgColor = widget.bgColor || settings.get_string('global-background-color') || DEFAULT_BG_COLOR;
    let selectedFgColor = widget.fgColor || settings.get_string('global-foreground-color') || DEFAULT_FG_COLOR;

    // Csak háttér kell (nincs szövegszín és nincs font):
    const isAnalogClock = (widget.type === 'time' && (widget.layout === 'analog' || widget.layout === 'worldAnalog' || widget.layout === 'world')) ||
                          widget.type === 'worldAnalog' || 
                          widget.type === 'world-analog' || 
                          widget.type === 'timeWorldAnalog' ||
                          widget.layoutType === 'worldAnalog';
                          
    const isCalendarTasks = widget.type === 'calendar-tasks' || widget.type === 'calendarTasks';
    const isBgOnly = isAnalogClock || isCalendarTasks;

    // Nem kell fontválasztó:
    const noFont = isBgOnly || widget.type === 'music';

    // Nem kell szöveg/ikon színválasztó:
    const noFgColor = isBgOnly;

    if (!isImageOrMedia) {
        const isFollowSystem = settings.get_boolean('follow-system-theme');
        // Kapcsoló címe dinamikusan igazodik ahhoz, hogy van-e benne font
        const switchTitle = noFont ? 'Custom Colors' : 'Custom Colors and Font';
        colorSwitchRow = new Adw.SwitchRow({
            title: isFollowSystem 
                ? `${switchTitle} (Disabled by System Theme)` 
                : switchTitle,
            active: widget.overrideColors === true && !isFollowSystem,
            sensitive: !isFollowSystem,
        });
        container.add(colorSwitchRow);

        // 1. Háttérszín (Mindenhol van, ahol nem média)
        const bgColorRow = new Adw.ActionRow({ title: 'Background Color' });
        bgColorBtn = createColorButton(selectedBgColor, (c) => { selectedBgColor = c; });
        bgColorRow.add_suffix(bgColorBtn);
        bgColorRow.set_activatable_widget(bgColorBtn);
        container.add(bgColorRow);

        // 2. Háttér átlátszóság
        const defaultGlobalOpacity = settings.get_int('global-background-opacity');
        const initialOpacity = widget.bgOpacity !== undefined ? widget.bgOpacity : (defaultGlobalOpacity || 100);
        const opacityAdjustment = new Gtk.Adjustment({
            lower: 0,
            upper: 100,
            step_increment: 5,
            page_increment: 10,
            value: initialOpacity,
        });

        bgOpacityScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: opacityAdjustment,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            width_request: 140,
            valign: Gtk.Align.CENTER,
        });
        bgOpacityScale.set_digits(0);

        const bgOpacityRow = new Adw.ActionRow({ title: 'Background Opacity' });
        bgOpacityRow.add_suffix(bgOpacityScale);
        container.add(bgOpacityRow);

        // 3. Szöveg / ikon szín (Kivéve az analóg órák és calendar tasks)
        let fgColorRow = null;
        if (!noFgColor) {
            fgColorRow = new Adw.ActionRow({ title: 'Text/Icon Color' });
            fgColorBtn = createColorButton(selectedFgColor, (c) => { selectedFgColor = c; });
            fgColorRow.add_suffix(fgColorBtn);
            fgColorRow.set_activatable_widget(fgColorBtn);
            container.add(fgColorRow);
        }

        // 4. Betűtípus (Kivéve az analóg órák, calendar tasks és music widget)
        let fontRow = null;
        if (!noFont) {
            const isNotesWidget = widget.type === 'notes' || widget.type === 'quickNotes' || widget.type === 'quick-notes';
            fontRow = new Adw.ActionRow({
                title: isNotesWidget ? 'Font & Size' : 'Font Family',
            });

            const rawFont = widget.fontFamily || settings.get_string('global-font-family') || DEFAULT_FONT_FAMILY || 'Cantarell';
            const cleanFamily = rawFont.replace(/['"]/g, '').replace(/, sans-serif/i, '').trim() || 'Cantarell';

            const fontDesc = Pango.FontDescription.from_string(cleanFamily);

            if (isNotesWidget) {
                const currentSize = widget.fontSize || 14;
                fontDesc.set_size(Math.round(currentSize * Pango.SCALE));
            }

            if (Gtk.FontDialogButton && Gtk.FontDialog) {
                const fontDialog = new Gtk.FontDialog();
                fontDialog.set_filter(null);

                let fontLevel = 0;
                if (Gtk.FontLevel) {
                    fontLevel = isNotesWidget ? Gtk.FontLevel.FONT : Gtk.FontLevel.FAMILY;
                }

                fontBtn = new Gtk.FontDialogButton({
                    dialog: fontDialog,
                    valign: Gtk.Align.CENTER,
                    halign: Gtk.Align.CENTER,
                    use_size: isNotesWidget,
                    level: fontLevel,
                });

                fontBtn.set_font_desc(fontDesc);
            } else {
                fontBtn = new Gtk.FontButton({
                    valign: Gtk.Align.CENTER,
                    halign: Gtk.Align.CENTER,
                    use_size: isNotesWidget,
                });
                if (Gtk.FontChooserLevel) {
                    fontBtn.set_level(isNotesWidget
                        ? (Gtk.FontChooserLevel.FAMILY | Gtk.FontChooserLevel.SIZE)
                        : Gtk.FontChooserLevel.FAMILY
                    );
                }
                fontBtn.set_font(fontDesc.to_string());
            }

            fontRow.add_suffix(fontBtn);
            fontRow.set_activatable_widget(fontBtn);
            container.add(fontRow);
        }

        // Érzékenység szinkronizálás csak a ténylegesen létező sorokra
        const syncColorSensitivity = () => {
            const canCustomize = !settings.get_boolean('follow-system-theme') && colorSwitchRow.get_active();
            bgColorRow.set_sensitive(canCustomize);
            bgOpacityRow.set_sensitive(canCustomize);
            if (fgColorRow) fgColorRow.set_sensitive(canCustomize);
            if (fontRow) fontRow.set_sensitive(canCustomize);
        };
        syncColorSensitivity();
        colorSwitchRow.connect('notify::active', syncColorSensitivity);
    }

    // Monitorválasztó többképernyős rendszerekhez
    const monitorCount = getConnectedMonitorsCount();
    let monitorComboRow = null;
    let monitorKeys = [];

    if (monitorCount > 1) {
        const monitorStrings = ['Default (Follow Global)', 'Primary Monitor'];
        monitorKeys = ['global', 'primary'];
        for (const entry of buildMonitorEntries(monitorCount)) {
            monitorStrings.push(entry.label);
            monitorKeys.push(entry.key);
        }

        monitorComboRow = new Adw.ComboRow({
            title: 'Target Monitor',
            model: new Gtk.StringList({ strings: monitorStrings }),
        });

        const currentWidgetMonitor = widget.monitor || 'global';
        const monitorIdx = monitorKeys.indexOf(currentWidgetMonitor);
        monitorComboRow.set_selected(monitorIdx >= 0 ? monitorIdx : 0);
        container.add(monitorComboRow);
    }

    saveHandlers.push((target) => {
        if (monitorComboRow && monitorKeys.length > 0) {
            const selectedMonitorKey = monitorKeys[monitorComboRow.get_selected()];
            if (selectedMonitorKey !== 'global') {
                target.monitor = selectedMonitorKey;
            } else {
                delete target.monitor;
            }
        }

        if (!isImageOrMedia && colorSwitchRow) {
            target.overrideColors = colorSwitchRow.get_active();
            target.bgColor = selectedBgColor;
            target.bgOpacity = Math.round(bgOpacityScale.get_value());

            if (!noFgColor) {
                target.fgColor = selectedFgColor;
            } else {
                delete target.fgColor;
            }

            if (!noFont && fontBtn) {
                let desc = null;
                if (typeof fontBtn.get_font_desc === 'function') {
                    desc = fontBtn.get_font_desc();
                } else if (typeof fontBtn.get_font === 'function') {
                    const fontStr = fontBtn.get_font();
                    if (fontStr) desc = Pango.FontDescription.from_string(fontStr);
                }

                if (desc) {
                    const family = desc.get_family();
                    if (family) {
                        target.fontFamily = family;
                    }

                    const isNotes = widget.type === 'notes' || widget.type === 'quickNotes' || widget.type === 'quick-notes';
                    if (isNotes) {
                        const rawSize = desc.get_size();
                        if (rawSize > 0) {
                            const calculatedSize = desc.get_size_is_absolute()
                                ? Math.round(rawSize)
                                : Math.round(rawSize / Pango.SCALE);
                            target.fontSize = calculatedSize;
                        }
                    } else {
                        delete target.fontSize;
                    }
                }
            } else {
                delete target.fontFamily;
                delete target.fontSize;
            }
        }
    });
}

export function buildRssSettings(container, widget, saveHandlers) {
    const urlRow = new Adw.EntryRow({
        title: 'Feed URL',
        text: widget.feedUrl || '',
    });

    const refreshRow = new Adw.SpinRow({
        title: 'Refresh Interval (Minutes)',
        adjustment: new Gtk.Adjustment({
            lower: RSS_MIN_REFRESH_MINUTES,
            upper: RSS_MAX_REFRESH_MINUTES,
            step_increment: RSS_REFRESH_STEP_MINUTES,
            value: widget.refreshMinutes || DEFAULT_RSS_REFRESH_MINUTES,
        }),
    });

    container.add(urlRow);
    container.add(refreshRow);

    saveHandlers.push((target) => {
        const trimmedUrl = urlRow.get_text().trim();
        if (trimmedUrl) {
            target.feedUrl = trimmedUrl;
        }
        target.refreshMinutes = Math.round(refreshRow.get_value());
    });
}

export function buildSunScheduleSettings(container, widget, saveHandlers) {
    const currentLocation = { name: widget.city || '' };
    if (widget.latitude !== undefined && widget.longitude !== undefined) {
        currentLocation.latitude = widget.latitude;
        currentLocation.longitude = widget.longitude;
    }

    const locationPicker = buildOpenMeteoCitySearchRow(container, 'City Location', currentLocation);

    saveHandlers.push((target) => {
        const selectedLocation = locationPicker.getSelectedLocation();
        if (selectedLocation && selectedLocation.name && selectedLocation.latitude !== undefined && selectedLocation.longitude !== undefined) {
            target.city = selectedLocation.name;
            target.latitude = selectedLocation.latitude;
            target.longitude = selectedLocation.longitude;
        }
    });
}

export function buildWeatherSettings(container, widget, settings, saveHandlers) {
    const currentLocation = { name: widget.location || 'London' };
    if (widget.lat !== undefined && widget.lon !== undefined) {
        currentLocation.latitude = widget.lat;
        currentLocation.longitude = widget.lon;
    }

    // 1. Kapcsolók közvetlenül a kártyában
    const isDynamicColorActive = widget.dynamicColor !== undefined
        ? widget.dynamicColor
        : settings.get_boolean('weather-dynamic-color');
    const dynamicColorRow = new Adw.SwitchRow({
        title: 'Dynamic Weather Color',
        active: isDynamicColorActive,
    });
    container.add(dynamicColorRow);

    const isDynamicOverlayActive = widget.dynamicImage !== undefined
        ? widget.dynamicImage
        : settings.get_boolean('weather-dynamic-image');
    const dynamicOverlayRow = new Adw.SwitchRow({
        title: 'Dynamic Weather Overlay',
        active: isDynamicOverlayActive,
    });
    container.add(dynamicOverlayRow);

    const fahrenheitRow = new Adw.SwitchRow({
        title: 'Use Fahrenheit',
        active: widget.useFahrenheit !== undefined ? widget.useFahrenheit : settings.get_boolean('weather-use-fahrenheit'),
    });
    container.add(fahrenheitRow);

    // 2. Városválasztó sor
    const cityPicker = buildOpenMeteoCitySearchRow(container, 'City Location', currentLocation);

    const globalDynamicColorDefault = settings.get_boolean('weather-dynamic-color');
    const globalDynamicImageDefault = settings.get_boolean('weather-dynamic-image');

    saveHandlers.push((target) => {
        const selectedCity = cityPicker.getSelectedLocation();
        if (selectedCity && selectedCity.name) {
            target.location = selectedCity.name;
            if (selectedCity.latitude !== undefined && selectedCity.longitude !== undefined) {
                target.lat = selectedCity.latitude;
                target.lon = selectedCity.longitude;
            }
        }
        const userColor = dynamicColorRow.get_active();
        if (userColor !== globalDynamicColorDefault) {
            target.dynamicColor = userColor;
        } else {
            delete target.dynamicColor;
        }
        const userImage = dynamicOverlayRow.get_active();
        if (userImage !== globalDynamicImageDefault) {
            target.dynamicImage = userImage;
        } else {
            delete target.dynamicImage;
        }
        target.useFahrenheit = fahrenheitRow.get_active();
    });
}

function getAvailableSkins() {
    const skins = [];
    try {
        const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
        const currentDir = GLib.path_get_dirname(currentFilePath);

        let skinsPath = GLib.build_filenamev([currentDir, '..', 'widgets', 'time', 'skins']);
        let targetDir = Gio.File.new_for_path(skinsPath);

        if (!targetDir.query_exists(null)) {
            skinsPath = GLib.build_filenamev([currentDir, 'widgets', 'time', 'skins']);
            targetDir = Gio.File.new_for_path(skinsPath);
        }

        if (targetDir.query_exists(null)) {
            const enumerator = targetDir.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            let fileInfo;
            while ((fileInfo = enumerator.next_file(null)) !== null) {
                if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                    skins.push(fileInfo.get_name());
                }
            }
        }
    } catch (e) {
        logError(e, 'Failed to list skins directory');
    }

    if (skins.length === 0) {
        skins.push('basic', 'sensa');
    }

    skins.sort();
    return skins;
}

export function buildTimeSettings(container, widget, settings, saveHandlers) {
    let skinComboRow = null;
    let skinKeys = [];
    let secondHandRow = null;
    let bgSwitchRow = null;

    if (widget.layout === 'analog') {
        skinKeys = getAvailableSkins();
        const skinLabels = skinKeys.map(k => k.charAt(0).toUpperCase() + k.slice(1));

        skinComboRow = new Adw.ComboRow({
            title: 'Clock Skin',
            model: new Gtk.StringList({ strings: skinLabels }),
        });

        const currentSkin = widget.skin || 'basic';
        const currentIdx = skinKeys.indexOf(currentSkin);
        skinComboRow.set_selected(currentIdx >= 0 ? currentIdx : 0);
        container.add(skinComboRow);

        secondHandRow = new Adw.SwitchRow({
            title: 'Show Second Hand',
            active: widget.showSecondHand !== false,
        });
        container.add(secondHandRow);

        bgSwitchRow = new Adw.SwitchRow({
            title: 'Show Background Box',
            active: widget.showBackground !== false,
        });
        container.add(bgSwitchRow);
    }

    let formatRow = null;
    if (widget.layout !== 'analog') {
        formatRow = new Adw.SwitchRow({
            title: 'Use 24-Hour Format',
            active: widget.use24h !== undefined ? widget.use24h : settings.get_boolean('time-format-24h'),
        });
        container.add(formatRow);
    }

    let primaryPicker, sec1Picker, sec2Picker;
    if (widget.layout === 'world' || widget.cities) {
        const defaultCities = widget.cities || [...DEFAULT_WORLD_CLOCK_CITIES];
        primaryPicker = createLiveCitySearchRow(container, 'Primary City (Top)', defaultCities[0] ?? DEFAULT_WORLD_CLOCK_CITIES[0]);
        sec1Picker = createLiveCitySearchRow(container, 'Secondary City (Bottom Left)', defaultCities[1] ?? DEFAULT_WORLD_CLOCK_CITIES[1]);
        sec2Picker = createLiveCitySearchRow(container, 'Secondary City (Bottom Right)', defaultCities[2] ?? DEFAULT_WORLD_CLOCK_CITIES[2]);
    }

    saveHandlers.push((target) => {
        if (skinComboRow && skinKeys.length > 0) {
            target.skin = skinKeys[skinComboRow.get_selected()] || 'basic';
        }
        if (secondHandRow) {
            target.showSecondHand = secondHandRow.get_active();
        }
        if (bgSwitchRow) {
            target.showBackground = bgSwitchRow.get_active();
        }
        if (formatRow) {
            target.use24h = formatRow.get_active();
        }
        if (primaryPicker && sec1Picker && sec2Picker) {
            target.cities = [
                primaryPicker.getSelectedCity(),
                sec1Picker.getSelectedCity(),
                sec2Picker.getSelectedCity(),
            ];
        }
    });
}

export function buildMusicSettings(container, widget, saveHandlers) {
    const isWide = isWideMusicLayout(widget);

    const showControlsRow = new Adw.SwitchRow({
        title: 'Show Player Controls',
        active: widget.showControls !== false,
    });
    container.add(showControlsRow);

    const ignoreBrowsersRow = new Adw.SwitchRow({
        title: 'Ignore Browser Players',
        active: widget.ignoreBrowsers !== false,
    });
    container.add(ignoreBrowsersRow);

    const playerFilterRow = new Adw.EntryRow({
        title: 'Restrict To Player (Optional)',
        text: widget.playerFilter || '',
    });
    container.add(playerFilterRow);

    const vinylCoverRow = new Adw.SwitchRow({
        title: 'Vinyl Disc Style',
        active: widget.vinylStyle === true,
    });
    container.add(vinylCoverRow);

    let coverBgRow = null;
    let visualizerRow = null;
    let vizModeRow = null;
    const vizModes = ['bars', 'wave'];

    if (isWide) {
        coverBgRow = new Adw.SwitchRow({
            title: 'Dominant Cover Background',
            active: widget.coverBackground === true,
        });
        container.add(coverBgRow);
    } else {
        const hasVisualizer = widget.showVisualizer === true || widget.layoutType === 'visualizer';
        visualizerRow = new Adw.SwitchRow({
            title: 'Show Audio Spectrum',
            active: hasVisualizer,
        });
        container.add(visualizerRow);

        const vizLabels = ['16-Bar Equalizer', 'Fluid Sine Wave'];
        vizModeRow = new Adw.ComboRow({
            title: 'Visualizer Pattern',
            model: new Gtk.StringList({ strings: vizLabels }),
        });
        const currentVizMode = widget.visualizerMode || 'bars';
        const vizIdx = vizModes.indexOf(currentVizMode);
        vizModeRow.set_selected(vizIdx >= 0 ? vizIdx : 0);
        container.add(vizModeRow);

        const updateVisualizerSensitivity = () => {
            const isVinyl = vinylCoverRow.get_active();
            visualizerRow.set_sensitive(!isVinyl);
            vizModeRow.set_sensitive(!isVinyl && visualizerRow.get_active());
        };

        updateVisualizerSensitivity();
        vinylCoverRow.connect('notify::active', updateVisualizerSensitivity);
        visualizerRow.connect('notify::active', updateVisualizerSensitivity);
    }

    saveHandlers.push((target) => {
        target.showControls = showControlsRow.get_active();
        target.ignoreBrowsers = ignoreBrowsersRow.get_active();
        target.playerFilter = playerFilterRow.get_text().trim();
        target.vinylStyle = vinylCoverRow.get_active();

        if (coverBgRow) {
            target.coverBackground = coverBgRow.get_active();
        }
        if (visualizerRow) {
            target.showVisualizer = visualizerRow.get_active();
            delete target.layoutType;
        }
        if (vizModeRow) {
            target.visualizerMode = vizModes[vizModeRow.get_selected()] || 'bars';
        }
    });
}

export function buildPomodoroSettings(container, widget, saveHandlers) {
    const durationFields = [
        { title: 'Work Duration (Minutes)', field: 'workMinutes', defaultValue: DEFAULT_WORK_MINUTES },
        { title: 'Short Break (Minutes)', field: 'shortBreakMinutes', defaultValue: DEFAULT_SHORT_BREAK_MINUTES },
        { title: 'Long Break (Minutes)', field: 'longBreakMinutes', defaultValue: DEFAULT_LONG_BREAK_MINUTES },
    ];

    const spinRows = durationFields.map(({ title, field, defaultValue }) => {
        const spinRow = new Adw.SpinRow({
            title,
            adjustment: new Gtk.Adjustment({
                lower: MIN_POMODORO_MINUTES,
                upper: MAX_POMODORO_MINUTES,
                step_increment: POMODORO_MINUTE_STEP,
                value: widget[field] !== undefined ? widget[field] : defaultValue,
            }),
        });
        container.add(spinRow);
        return { field, spinRow };
    });

    const sessionsRow = new Adw.SpinRow({
        title: 'Sessions Before Long Break',
        adjustment: new Gtk.Adjustment({
            lower: MIN_SESSIONS_BEFORE_LONG_BREAK,
            upper: MAX_SESSIONS_BEFORE_LONG_BREAK,
            step_increment: POMODORO_MINUTE_STEP,
            value: widget.sessionsBeforeLongBreak !== undefined ? widget.sessionsBeforeLongBreak : DEFAULT_SESSIONS_BEFORE_LONG_BREAK,
        }),
    });
    container.add(sessionsRow);

    saveHandlers.push((target) => {
        spinRows.forEach(({ field, spinRow }) => {
            target[field] = Math.round(spinRow.get_value());
        });
        target.sessionsBeforeLongBreak = Math.round(sessionsRow.get_value());
    });
}

export function buildAppLauncherSettings(container, widget, saveHandlers) {
    const appSelection = createAppSelectionControls(container, widget.apps || []);

    saveHandlers.push((target) => {
        target.apps = appSelection.getSelectedApps();
    });
}

export function buildSlideshowSettings(container, widget, settings, saveHandlers) {
    const intervalRow = new Adw.SpinRow({
        title: 'Change Interval (Seconds)',
        adjustment: new Gtk.Adjustment({
            lower: MIN_SLIDESHOW_INTERVAL_SEC,
            upper: MAX_SLIDESHOW_INTERVAL_SEC,
            step_increment: STEP_SLIDESHOW_INTERVAL_SEC,
            value: widget.intervalSeconds || DEFAULT_SLIDESHOW_INTERVAL_SEC,
        }),
    });
    container.add(intervalRow);

    const transitionKeys = ['crossfade', 'slide_horizontal', 'slide_vertical', 'zoom_in'];
    const transitionLabels = [
        'Crossfade (Default)',
        'Slide Horizontal',
        'Slide Vertical',
        'Zoom In',
    ];

    const transitionRow = new Adw.ComboRow({
        title: 'Transition Effect',
        model: new Gtk.StringList({ strings: transitionLabels }),
    });
    const currentTransition = widget.transitionType || 'crossfade';
    const transitionIdx = transitionKeys.indexOf(currentTransition);
    transitionRow.set_selected(transitionIdx >= 0 ? transitionIdx : 0);
    container.add(transitionRow);

    const { captionEntry, showCaptionSwitch, fgColorBtn } = buildCaptionControls(container, widget, settings, 'My Slideshow');

    saveHandlers.push((target) => {
        target.intervalSeconds = Math.round(intervalRow.get_value());
        target.transitionType = transitionKeys[transitionRow.get_selected()] || 'crossfade';
        target.caption = captionEntry.get_text().trim() || 'My Slideshow';
        target.showCaption = showCaptionSwitch.get_active();
        target.fgColor = fgColorBtn.get_rgba ? fgColorBtn.get_rgba().to_string() : widget.fgColor;
    });
}

export function buildGifSettings(container, widget, saveHandlers) {
    const animateRow = new Adw.SwitchRow({
        title: 'Animate GIF / WebP',
        active: widget.animateGif !== false,
    });
    container.add(animateRow);

    saveHandlers.push((target) => {
        target.animateGif = animateRow.get_active();
    });
}

export function buildImageSettings(container, widget, settings, saveHandlers, parentWindow) {
    const imageRow = new Adw.EntryRow({
        title: 'Image File',
        text: widget.imagePath || '',
    });

    const browseBtn = new Gtk.Button({
        icon_name: 'document-open-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    browseBtn.connect('clicked', () => {
        openImageFileDialog(parentWindow, (selectedPath) => {
            if (selectedPath) {
                imageRow.set_text(selectedPath);
            }
        });
    });
    imageRow.add_suffix(browseBtn);
    container.add(imageRow);

    const { captionEntry, showCaptionSwitch, fgColorBtn } = buildCaptionControls(container, widget, settings, 'My Image');

    saveHandlers.push((target) => {
        target.imagePath = imageRow.get_text().trim();
        target.caption = captionEntry.get_text().trim() || 'My Image';
        target.showCaption = showCaptionSwitch.get_active();
        target.fgColor = fgColorBtn.get_rgba ? fgColorBtn.get_rgba().to_string() : widget.fgColor;
    });
}

export function buildSystemInfoSettings(container, widget, saveHandlers) {
    const types = ['cpu', 'ram', 'disk', 'thermal', 'gpu'];
    const typeNames = ['CPU Usage', 'RAM Usage', 'Disk Usage', 'Thermal (CPU)', 'GPU Temp'];

    const typeRow = new Adw.ComboRow({
        title: 'Monitor Metric',
        model: new Gtk.StringList({ strings: typeNames }),
    });
    const currentType = (widget.systemInfoType || 'cpu').toLowerCase();
    const currentIdx = types.indexOf(currentType);
    typeRow.set_selected(currentIdx >= 0 ? currentIdx : 0);
    container.add(typeRow);

    const chartRow = new Adw.SwitchRow({
        title: 'Show Trend Chart',
        active: widget.showChart === true,
    });
    container.add(chartRow);

    saveHandlers.push((target) => {
        target.systemInfoType = types[typeRow.get_selected()] || 'cpu';
        target.showChart = chartRow.get_active();
    });
}

export function buildCurrencyTrackerSettings(container, widget, saveHandlers) {
    const SUPPORTED_CURRENCIES = [
        'EUR', 'HUF', 'USD', 'GBP', 'CHF', 'CZK', 'PLN', 'AUD', 'BGN', 'BRL',
        'CAD', 'CNY', 'DKK', 'HKD', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW',
        'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR'
    ];

    const baseRow = new Adw.ComboRow({
        title: 'Base Currency (From)',
        model: new Gtk.StringList({ strings: SUPPORTED_CURRENCIES }),
    });
    const currentBase = (widget.baseCurrency || 'EUR').toUpperCase();
    const baseIdx = SUPPORTED_CURRENCIES.indexOf(currentBase);
    baseRow.set_selected(baseIdx >= 0 ? baseIdx : 0);
    container.add(baseRow);

    const targetRow = new Adw.ComboRow({
        title: 'Target Currency (To)',
        model: new Gtk.StringList({ strings: SUPPORTED_CURRENCIES }),
    });
    const currentTarget = (widget.targetCurrency || 'HUF').toUpperCase();
    const targetIdx = SUPPORTED_CURRENCIES.indexOf(currentTarget);
    targetRow.set_selected(targetIdx >= 0 ? targetIdx : SUPPORTED_CURRENCIES.indexOf('HUF'));
    container.add(targetRow);

    const invertColorsRow = new Adw.SwitchRow({
        title: 'Invert Trend Colors',
        active: widget.invertColors === true,
    });
    container.add(invertColorsRow);

    saveHandlers.push((target) => {
        target.baseCurrency = SUPPORTED_CURRENCIES[baseRow.get_selected()] || 'EUR';
        target.targetCurrency = SUPPORTED_CURRENCIES[targetRow.get_selected()] || 'HUF';
        target.invertColors = invertColorsRow.get_active();
    });
}

export function buildWeatherCardsSettings(container, widget, saveHandlers) {
    const currentLocation = { name: widget.location || 'London' };
    if (widget.lat !== undefined && widget.lon !== undefined) {
        currentLocation.latitude = widget.lat;
        currentLocation.longitude = widget.lon;
    }
    const cityPicker = buildOpenMeteoCitySearchRow(container, 'City Location', currentLocation);

    const metrics = [
        'uv', 'humidity', 'aqi', 'wind', 'pressure', 'feels_like', 'gusts', 'dew_point', 'cloud', 'precipitation',
    ];
    const metricNames = [
        'UV Index', 'Humidity', 'Air Quality (AQI)', 'Wind Speed', 'Pressure', 'Feels Like', 'Wind Gusts', 'Dew Point', 'Cloud Cover', 'Precipitation',
    ];

    const metricRow = new Adw.ComboRow({
        title: 'Weather Metric',
        model: new Gtk.StringList({ strings: metricNames }),
    });
    const currentMetric = (widget.weatherMetric || 'uv').toLowerCase();
    const currentIdx = metrics.indexOf(currentMetric);
    metricRow.set_selected(currentIdx >= 0 ? currentIdx : 0);
    container.add(metricRow);

    const chartRow = new Adw.SwitchRow({
        title: 'Show Trend Chart',
        active: widget.showChart === true,
    });
    container.add(chartRow);

    saveHandlers.push((target) => {
        const selectedCity = cityPicker.getSelectedLocation();
        if (selectedCity && selectedCity.name) {
            target.location = selectedCity.name;
            if (selectedCity.latitude !== undefined && selectedCity.longitude !== undefined) {
                target.lat = selectedCity.latitude;
                target.lon = selectedCity.longitude;
            }
        }
        target.weatherMetric = metrics[metricRow.get_selected()] || 'uv';
        target.showChart = chartRow.get_active();
    });
}

export function buildTimerSettings(container, widget, saveHandlers) {
    const labelRow = new Adw.EntryRow({
        title: 'Timer Label',
        text: widget.timerLabel || 'Timer',
    });
    container.add(labelRow);

    const currentMinutes = Math.round((widget.timerDurationSeconds || 300) / 60);
    const durationRow = new Adw.SpinRow({
        title: 'Duration (Minutes)',
        adjustment: new Gtk.Adjustment({ lower: 1, upper: 720, step_increment: 1, value: currentMinutes }),
    });
    container.add(durationRow);

    saveHandlers.push((target) => {
        target.timerLabel = labelRow.get_text().trim() || 'Timer';
        target.timerDurationSeconds = Math.round(durationRow.get_value()) * 60;
    });
}

export function buildCountdownSettings(container, widget, saveHandlers) {
    const nameRow = new Adw.EntryRow({
        title: 'Event Name',
        text: widget.eventName || 'Goal',
    });
    container.add(nameRow);

    const rawDate = widget.targetDate ? widget.targetDate.split('T')[0] : '';
    const dateRow = new Adw.EntryRow({
        title: 'Target Date (YYYY-MM-DD)',
        text: rawDate,
    });
    container.add(dateRow);

    saveHandlers.push((target) => {
        target.eventName = nameRow.get_text().trim() || 'Goal';
        const d = dateRow.get_text().trim();
        if (d) {
            target.targetDate = `${d}T00:00:00`;
        }
    });
}

export function buildPingSettings(container, widget, saveHandlers) {
    const hostRow = new Adw.EntryRow({
        title: 'Host / IP Address',
        text: widget.pingHost || '1.1.1.1',
    });
    container.add(hostRow);

    const nameRow = new Adw.EntryRow({
        title: 'Label',
        text: widget.pingLabel || 'Cloudflare',
    });
    container.add(nameRow);

    const chartRow = new Adw.SwitchRow({
        title: 'Show Trend Chart',
        active: widget.showChart === true, // Csak akkor aktív, ha a user kérte
    });
    container.add(chartRow);

    saveHandlers.push((target) => {
        const host = hostRow.get_text().trim();
        target.pingHost = host || '1.1.1.1';
        target.pingLabel = nameRow.get_text().trim() || 'Ping';
        target.showChart = chartRow.get_active();
    });
}

export function buildCryptoTrackerSettings(container, widget, saveHandlers) {
    const SUPPORTED_CURRENCIES = ['HUF', 'USD', 'EUR', 'GBP', 'CHF', 'CZK', 'PLN', 'CAD', 'AUD', 'JPY'];

    const targetRow = new Adw.ComboRow({
        title: 'Target Currency',
        model: new Gtk.StringList({ strings: SUPPORTED_CURRENCIES }),
    });
    const currentTarget = (widget.targetCurrency || 'HUF').toUpperCase();
    const targetIdx = SUPPORTED_CURRENCIES.indexOf(currentTarget);
    targetRow.set_selected(targetIdx >= 0 ? targetIdx : 0);
    container.add(targetRow);

    saveHandlers.push((target) => {
        target.targetCurrency = SUPPORTED_CURRENCIES[targetRow.get_selected()] || 'HUF';
    });
}

export function buildHistoryTrackerSettings(container, widget, saveHandlers) {
    const languages = [
        { code: 'en', name: 'English' },
        { code: 'de', name: 'Deutsch' },
        { code: 'fr', name: 'Français' },
        { code: 'es', name: 'Español' },
    ];
    const langNames = languages.map(l => l.name);

    const langRow = new Adw.ComboRow({
        title: 'Wikipedia Language',
        model: new Gtk.StringList({ strings: langNames }),
    });
    const currentLang = widget.language || 'en';
    const langIdx = languages.findIndex(l => l.code === currentLang);
    langRow.set_selected(langIdx >= 0 ? langIdx : 0);
    container.add(langRow);

    const categories = [
        { key: 'selected', name: 'Curated Events' },
        { key: 'events', name: 'All Events' },
        { key: 'births', name: 'Births' },
        { key: 'deaths', name: 'Deaths' },
    ];
    const categoryNames = categories.map(c => c.name);

    const categoryRow = new Adw.ComboRow({
        title: 'Event Category',
        model: new Gtk.StringList({ strings: categoryNames }),
    });
    const currentCat = widget.category || 'selected';
    const catIdx = categories.findIndex(c => c.key === currentCat);
    categoryRow.set_selected(catIdx >= 0 ? catIdx : 0);
    container.add(categoryRow);

    saveHandlers.push((target) => {
        target.language = languages[langRow.get_selected()]?.code || 'en';
        target.category = categories[categoryRow.get_selected()]?.key || 'selected';
    });
}

export function buildStorageBarSettings(container, widget, saveHandlers, parentWindow) {
    const pathRow = new Adw.EntryRow({
        title: 'Storage Path / Partition',
        text: widget.storagePath || '/',
    });

    const browseBtn = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });

    browseBtn.connect('clicked', () => {
        if (Gtk.FileDialog) {
            const dialog = new Gtk.FileDialog({ title: 'Select Folder / Partition' });
            dialog.select_folder(parentWindow || null, null, (dlg, result) => {
                try {
                    const folder = dlg.select_folder_finish(result);
                    if (folder) pathRow.set_text(folder.get_path());
                } catch (e) {
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                        console.error('Folder dialog error:', e);
                    }
                }
            });
        }
    });

    pathRow.add_suffix(browseBtn);
    container.add(pathRow);

    saveHandlers.push((target) => {
        const customPath = pathRow.get_text().trim();
        target.storagePath = customPath || '/';
    });
}

export function buildWatermindSettings(container, widget, saveHandlers) {
    const targetRow = new Adw.SpinRow({
        title: 'Hourly Target (ml/h)',
        adjustment: new Gtk.Adjustment({ lower: 50, upper: 1000, step_increment: 25, value: widget.hourlyTargetMl || 250 }),
    });
    container.add(targetRow);

    const intervalRow = new Adw.SpinRow({
        title: 'Reminder Interval (Minutes)',
        adjustment: new Gtk.Adjustment({ lower: 15, upper: 180, step_increment: 5, value: widget.intervalMinutes || 60 }),
    });
    container.add(intervalRow);

    saveHandlers.push((target) => {
        target.hourlyTargetMl = Math.round(targetRow.get_value());
        target.intervalMinutes = Math.round(intervalRow.get_value());
    });
}

export function buildLavaLampSettings(container, widget, saveHandlers) {
    const themeKeys = Object.keys(LAVA_THEMES);
    const themeNames = themeKeys.map(k => LAVA_THEMES[k].name);

    const themeRow = new Adw.ComboRow({
        title: 'Color Theme',
        subtitle: 'Select wax and glow palette',
        model: new Gtk.StringList({ strings: themeNames }),
    });

    const currentTheme = widget.lavaTheme || 'classic';
    const themeIdx = themeKeys.indexOf(currentTheme);
    themeRow.set_selected(themeIdx >= 0 ? themeIdx : 0);
    container.add(themeRow);

    saveHandlers.push((target) => {
        target.lavaTheme = themeKeys[themeRow.get_selected()] || 'classic';
    });
}

export function buildMoonSettings(container, widget, saveHandlers) {
    const currentLocation = { name: widget.city || '' };
    if (widget.latitude !== undefined && widget.longitude !== undefined) {
        currentLocation.latitude = widget.latitude;
        currentLocation.longitude = widget.longitude;
    }

    const locationPicker = buildOpenMeteoCitySearchRow(container, 'City Location', currentLocation);

    saveHandlers.push((target) => {
        const selectedLocation = locationPicker.getSelectedLocation();
        if (selectedLocation && selectedLocation.name && selectedLocation.latitude !== undefined && selectedLocation.longitude !== undefined) {
            target.city = selectedLocation.name;
            target.latitude = selectedLocation.latitude;
            target.longitude = selectedLocation.longitude;
        }
    });
}

export function buildDownloadsSettings(container, widget, saveHandlers, parentWindow) {
    const defaultDownloads = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ||
                             GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);

    const pathRow = new Adw.EntryRow({
        title: 'Watched Folder',
        text: widget.folderPath || defaultDownloads,
    });

    const browseBtn = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });

    browseBtn.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({
            title: 'Select Folder',
        });

        const currentText = pathRow.get_text().trim();
        if (currentText && GLib.file_test(currentText, GLib.FileTest.IS_DIR)) {
            try {
                dialog.set_initial_folder(Gio.File.new_for_path(currentText));
            } catch (e) {}
        }

        dialog.select_folder(parentWindow || null, null, (dlg, result) => {
            try {
                const folder = dlg.select_folder_finish(result);
                if (folder) {
                    pathRow.set_text(folder.get_path());
                }
            } catch (e) {
                // Ha a felhasználó a 'Mégse' gombra kattintott, nem dobunk hibát és nem zárjuk be a prefs-t:
                if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                    console.error('Downloads folder dialog error:', e);
                }
            }
        });
    });

    pathRow.add_suffix(browseBtn);
    container.add(pathRow);

    saveHandlers.push((target) => {
        const selected = pathRow.get_text().trim();
        target.folderPath = selected || defaultDownloads;
    });
}