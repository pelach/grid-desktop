import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';


/** Empty string means no font-family override; widgets inherit the system theme font. */
export const DEFAULT_FONT_FAMILY = '';

export const DEFAULT_BG_COLOR = '#222226';
export const DEFAULT_FG_COLOR = '#ffffff';
export const MAX_APP_LAUNCHER_ITEMS = 8;

const TEMPERATURE_FAHRENHEIT_MULTIPLIER = 9 / 5;
const TEMPERATURE_FAHRENHEIT_OFFSET = 32;

/** Cairo drawing constants — GJS doesn't expose these as named enums. */
export const CAIRO_OPERATOR_CLEAR = 0;
export const CAIRO_OPERATOR_OVER = 2;
export const CAIRO_LINE_CAP_ROUND = 1;

export const BASE_CELL_SIZE = 80; 
export const GRID_GAP_PX = 16;
export const GRID_MARGIN_PX = 4;
export const COLUMNS_COUNT = 100;
export const ROWS_COUNT = 40;

export const MIN_WIDGET_SIZES = Object.freeze({
    // --- 1. IDŐ ÉS DÁTUM ---
    'time': { minCols: 2, minRows: 2 },
    'timeAnalog': { minCols: 2, minRows: 2 },
    'countdown': { minCols: 2, minRows: 2 },
    'stopwatch': { minCols: 2, minRows: 2 },
    'timer': { minCols: 2, minRows: 2 },
    'worldClock': { minCols: 2, minRows: 2 },
    'worldAnalog': { minCols: 2, minRows: 2 },
    'calendar': { minCols: 2, minRows: 2 },
    'calendar-grid': { minCols: 2, minRows: 2 },
    'calendarTasks': { minCols: 2, minRows: 2 },
    'todayHistory': { minCols: 2, minRows: 2 },

    // --- 2. IDŐJÁRÁS ÉS KÖRNYEZET ---
    'weather': { minCols: 2, minRows: 2 },
    'weatherStandard': { minCols: 2, minRows: 2 },
    'weatherSimple': { minCols: 2, minRows: 2 },
    'weather_cards': { minCols: 2, minRows: 2 },
    'weatherCards': { minCols: 2, minRows: 2 },
    'weather_bars': { minCols: 4, minRows: 4 },
    'weatherBars': { minCols: 4, minRows: 4 },
    'weatherForecast': { minCols: 4, minRows: 2 },
    'sun-schedule': { minCols: 2, minRows: 2 },
    'moon': { minCols: 4, minRows: 2 },
    'calendarWeather': { minCols: 4, minRows: 2 },
    'calendarEvents': { minCols: 4, minRows: 2 },

    // --- 3. HARDVER ÉS MONITORING ---
    'system-info': { minCols: 2, minRows: 2 },
    'ping-monitor': { minCols: 2, minRows: 2 },
    'updates': { minCols: 2, minRows: 2 },
    'mailGoa': { minCols: 2, minRows: 2 },

    'cpu-ram': { minCols: 4, minRows: 2 },
    'network-speed': { minCols: 4, minRows: 2 },
    'binary': { minCols: 4, minRows: 2 },
    'uptime': { minCols: 4, minRows: 2 },

    'system-dashboard': { minCols: 2, minRows: 2 },
    'resource-wheel': { minCols: 2, minRows: 2 },
    'storageBar': { minCols: 4, minRows: 2 },
    'hardwerinfo': { minCols: 4, minRows: 4 },

    'commandRunner': { minCols: 4, minRows: 2 },

    // --- 2. MÉDIA ÉS HANG ---
    'music': { minCols: 2, minRows: 2 },
    'musicSmall': { minCols: 2, minRows: 2 },
    'musicWide': { minCols: 4, minRows: 2 },
    'audioOutput': { minCols: 2, minRows: 2 },
    'lyrics': { minCols: 4, minRows: 2 },
    'audioVisualizer': { minCols: 4, minRows: 2 },

    // --- 5. KAPCSOLÓK ÉS VEZÉRLÉS ---
    'battery-status': { minCols: 2, minRows: 2 },
    'powerProfiles': { minCols: 2, minRows: 2 },
    'powerToggles': { minCols: 2, minRows: 2 },
    'quickToggles': { minCols: 2, minRows: 2 },
    'controlsSliders': { minCols: 4, minRows: 2 },
    'bluetoothDevices': { minCols: 2, minRows: 2 },
    'lavaLamp': { minCols: 2, minRows: 6 },

    // --- 6. PRODUKTIVITÁS, PÉNZÜGY ÉS SZABAD TARTALOM ---
    'notes': { minCols: 2, minRows: 2 },
    'clipboard': { minCols: 2, minRows: 2 },
    'quotes': { minCols: 2, minRows: 2 },
    'pomodoro': { minCols: 2, minRows: 2 },
    'watermind': { minCols: 2, minRows: 2 },
    'downloads': { minCols: 4, minRows: 2 },
    'pomodoro-focus': { minCols: 4, minRows: 2 },
    'todo': { minCols: 2, minRows: 2 },
    'github': { minCols: 4, minRows: 2 },
    'mood': { minCols: 4, minRows: 2 },
    'currency-tracker': { minCols: 4, minRows: 2 },
    'cryptoWidget': { minCols: 4, minRows: 2 },
    'habitTracker': { minCols: 4, minRows: 2 },
    'screen-time': { minCols: 4, minRows: 2 },
    'rss-headlines': { minCols: 2, minRows: 2 },
    'rss-feed': { minCols: 2, minRows: 2 },
    'steamRecent': { minCols: 2, minRows: 4 },

    // Szabadon méretezhető média
    'app-launcher': { minCols: 2, minRows: 2 },
    'slideshow': { minCols: 2, minRows: 2 },
    'image': { minCols: 2, minRows: 2 },
});

/**
 * Resolves the use24h setting for a time widget.
 * Individual widget override takes precedence over the global setting.
 */
export function resolveUse24h(widgetData) {
    return (widgetData.use24h === false) ? false : (widgetData.globalUse24h !== false);
}

/**
 * Calculates grid cell dimensions from canvas size and column count.
 * Returns { cellSize, cellTotalWidth, cellTotalHeight, gridRows }.
 */
export function calculateGridDimensions(width, height, preferredCols = COLUMNS_COUNT, customCellSize = 80, customGap = 16) {
    const w = (Number.isFinite(width) && width > 0) ? width : 1920;
    const h = (Number.isFinite(height) && height > 0) ? height : 1080;

    const baseCell = (Number.isFinite(customCellSize) && customCellSize > 0) ? customCellSize : BASE_CELL_SIZE;
    const gap = (Number.isFinite(customGap) && customGap >= 0) ? customGap : GRID_GAP_PX;
    const cellTotal = baseCell + gap;
    const cellSize = baseCell;

    const availableWidth = Math.max(1, w - (GRID_MARGIN_PX * 2));
    const availableHeight = Math.max(1, h - (GRID_MARGIN_PX * 2));

    const gridCols = Math.max(1, Math.floor((availableWidth + gap) / cellTotal));
    const gridRows = Math.max(1, Math.floor((availableHeight + gap) / cellTotal));

    return {
        cellSize,
        gridGap: gap,
        cellTotalWidth: cellTotal,
        cellTotalHeight: cellTotal,
        gridCols,
        gridRows,
    };
}

export const DEFAULT_CORNER_RADIUS_PX = 12;

/** Returns whether a CSS color reads as a dark surface (luminance below 0.5). */
export function isDarkBackgroundColor(cssColor) {
    const parsed = parseCssColor(cssColor);
    return (parsed.r * 0.299 + parsed.g * 0.587 + parsed.b * 0.114) < 0.5;
}

/**
 * Resolves border overrides and global style settings for a widget.
 * Returns a merged object with applied* properties and global* properties.
 */
export function resolveWidgetOverrides(widgetData, globalSettings) {
    const {
        globalBgColor,
        globalFgColor,
        globalBgOpacity,
        globalFontFamily,
        globalBorderRadius,
    } = globalSettings;

    const borderRadius = widgetData.borderRadius !== undefined 
        ? widgetData.borderRadius 
        : (globalBorderRadius !== undefined ? globalBorderRadius : DEFAULT_CORNER_RADIUS_PX); 

    return Object.assign({}, widgetData, {
        appliedBorderRadius: borderRadius,
        globalBackgroundColor: globalBgColor,
        globalForegroundColor: globalFgColor,
        globalBackgroundOpacity: globalBgOpacity !== undefined ? globalBgOpacity : 100, 
        globalFontFamily: globalFontFamily,
    });
}

/** The Adwaita accent palette, keyed by the GNOME 47+ 'accent-color' setting value. */
const ADWAITA_ACCENT_COLORS = Object.freeze({
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
});
const DEFAULT_ACCENT_COLOR = ADWAITA_ACCENT_COLORS.blue;

/**
 * Reads the system accent color from org.gnome.desktop.interface. The
 * 'accent-color' key only exists on GNOME 47+, so older schemas fall back to
 * the Adwaita default instead of erroring.
 */
export function resolveSystemAccentColor(interfaceSettings) {
    if (!interfaceSettings || !interfaceSettings.settings_schema.has_key('accent-color'))
        return DEFAULT_ACCENT_COLOR;
    return ADWAITA_ACCENT_COLORS[interfaceSettings.get_string('accent-color')] || DEFAULT_ACCENT_COLOR;
}

/** Reads global extension settings; when follow-system-theme is enabled, bg/fg follow the GNOME color scheme. */
export function readGlobalSettings(settings, interfaceSettings = null) {
    let globalBgColor = settings.get_string('global-background-color');
    let globalFgColor = settings.get_string('global-foreground-color');

    if (settings.get_boolean('follow-system-theme') && interfaceSettings) {
        const schemeColors = resolveSystemSchemeColors(interfaceSettings.get_string('color-scheme'));
        if (schemeColors) {
            globalBgColor = schemeColors.bg;
            globalFgColor = schemeColors.fg;
        }
    }

    const accentOverride = settings.get_string('accent-color-override');
    const globalAccentColor = accentOverride || resolveSystemAccentColor(interfaceSettings);

    return {
        globalBgColor,
        globalFgColor,
        globalAccentColor,
        globalBgOpacity: settings.get_int('global-background-opacity'), 
        globalBorderRadius: settings.get_int('global-border-radius'),
        globalFontFamily: settings.get_string('global-font-family'),
        globalAnimateGif: settings.get_boolean('image-animate-gif'),
        globalImageShowCaption: settings.get_boolean('image-show-caption'),
        globalSlideshowShowCaption: settings.get_boolean('slideshow-show-caption'),
        globalUseFahrenheit: settings.get_boolean('weather-use-fahrenheit'),
        globalWeatherDynamicColor: settings.get_boolean('weather-dynamic-color'),
        globalWeatherDynamicImage: settings.get_boolean('weather-dynamic-image'),
        globalWeatherCity: settings.get_string('weather-city'),
        globalUse24h: settings.get_boolean('time-format-24h'),
    };
}

/** Returns Adwaita surface colors for a GNOME color-scheme value, or null for unknown schemes. */
export function resolveSystemSchemeColors(colorScheme) {
    switch (colorScheme) {
        case 'prefer-dark':
            return { bg: '#222226', fg: '#ffffff' };
        case 'prefer-light':
        case 'default':
            return { bg: '#fafafb', fg: 'rgba(0, 0, 6, 0.8)' };
        default:
            return null;
    }
}

/** Checks if a filename has an extension that supports animation (.gif, .webp). */
export function isAnimatedImageFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return lower.endsWith('.gif') || lower.endsWith('.webp');
}

export function celsiusToFahrenheit(celsius) {
    return (celsius * TEMPERATURE_FAHRENHEIT_MULTIPLIER) + TEMPERATURE_FAHRENHEIT_OFFSET;
}

/** Normalizes launcher app entries to a unique, capped list of desktop IDs and names. */
export function normalizeAppLauncherApps(apps) {
    if (!Array.isArray(apps)) {
        return [];
    }

    const normalizedApps = [];
    const seenIds = new Set();

    for (const app of apps) {
        if (!app || typeof app.id !== 'string') {
            continue;
        }

        const appId = app.id.trim();
        if (appId === '' || seenIds.has(appId)) {
            continue;
        }

        seenIds.add(appId);
        normalizedApps.push({
            id: appId,
            name: typeof app.name === 'string' && app.name.trim() !== ''
                ? app.name.trim()
                : appId.replace(/\.desktop$/i, ''),
        });

        if (normalizedApps.length >= MAX_APP_LAUNCHER_ITEMS) {
            break;
        }
    }

    return normalizedApps;
}

const CSS_RGB_FUNCTION_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?/;

/** Parses a CSS color string (#rrggbb or rgb()/rgba()) into normalized [0..1] RGB components. */
export function parseCssColor(colorString) {
    const HEX_BASE = 16;
    const COLOR_MAX_BYTE = 255;
    if (typeof colorString !== 'string')
        return { r: 0, g: 0, b: 0 };

    if (/^#[0-9a-fA-F]{6}$/.test(colorString)) {
        return {
            r: parseInt(colorString.slice(1, 3), HEX_BASE) / COLOR_MAX_BYTE,
            g: parseInt(colorString.slice(3, 5), HEX_BASE) / COLOR_MAX_BYTE,
            b: parseInt(colorString.slice(5, 7), HEX_BASE) / COLOR_MAX_BYTE,
        };
    }

    const rgbMatch = colorString.match(CSS_RGB_FUNCTION_PATTERN);
    if (rgbMatch) {
        const channel = (value) => Math.min(COLOR_MAX_BYTE, parseInt(value, 10)) / COLOR_MAX_BYTE;
        const parsed = { r: channel(rgbMatch[1]), g: channel(rgbMatch[2]), b: channel(rgbMatch[3]) };
        if (rgbMatch[4] !== undefined)
            parsed.a = Math.max(0, Math.min(1, parseFloat(rgbMatch[4])));
        return parsed;
    }

    return { r: 0, g: 0, b: 0 };
}

export const SECONDARY_OPACITY = 0.55;

/** Builds a CSS rgba() string from any CSS color string at the given alpha. */
export function cssColorToRgba(colorString, alpha = 1) {
    const { r, g, b } = parseCssColor(colorString);
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

const LUMINANCE_RED_WEIGHT = 0.299;
const LUMINANCE_GREEN_WEIGHT = 0.587;
const LUMINANCE_BLUE_WEIGHT = 0.114;
const LUMINANCE_LIGHT_THRESHOLD = 0.55;
export const LIGHT_TEXT_ON_ACCENT = 'rgba(255, 255, 255, 0.92)';
export const DARK_TEXT_ON_ACCENT = 'rgba(30, 30, 30, 0.92)';

/** Returns a readable text color for content drawn on top of the accent color. */
export function resolveTextOnAccentColor(accentHex) {
    const accent = parseCssColor(accentHex);
    const accentLuminance = (accent.r * LUMINANCE_RED_WEIGHT)
        + (accent.g * LUMINANCE_GREEN_WEIGHT)
        + (accent.b * LUMINANCE_BLUE_WEIGHT);
    return accentLuminance > LUMINANCE_LIGHT_THRESHOLD
        ? DARK_TEXT_ON_ACCENT
        : LIGHT_TEXT_ON_ACCENT;
}

/** Directories already created this session, so mkdir syscalls run at most once per path. */
const ensuredDirectories = new Set();

/** Clears the directory cache; called from the extension's disable(). */
export function clearEnsuredDirectories() {
    ensuredDirectories.clear();
}

function ensureDirectory(dirPath, errorContext) {
    if (ensuredDirectories.has(dirPath))
        return;
    try {
        const file = Gio.File.new_for_path(dirPath);
        if (!file.query_exists(null)) {
            file.make_directory_with_parents(null);
        }
        ensuredDirectories.add(dirPath);
    } catch (e) {
    }
}


export function getGridDesktopDataDir(subFolder = '') {
    const pathParts = [GLib.get_user_data_dir(), 'grid-desktop'];
    if (subFolder) {
        pathParts.push(subFolder);
    }
    const dataDir = GLib.build_filenamev(pathParts);
    ensureDirectory(dataDir, 'data directory');
    return dataDir;
}
export const getGridgetsDataDir = getGridDesktopDataDir;
/**
 * Reads a JSON file asynchronously and invokes callback(parsed, parseError).
 * A missing/empty file yields callback(null) — the normal first-run case.
 * A file that exists but fails to parse yields callback(null, error) so
 * callers can avoid overwriting corrupt user data with fresh defaults.
 */
export function loadJsonFromFileAsync(filePath, callback) {
    const file = Gio.File.new_for_path(filePath);
    file.load_contents_async(null, (fileObj, res) => {
        let contents = null;
        try {
            const [success, bytes] = fileObj.load_contents_finish(res);
            if (success)
                contents = bytes;
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            callback(null);
            return;
        }

        if (!contents || contents.length === 0) {
            callback(null);
            return;
        }

        try {
            callback(JSON.parse(new TextDecoder('utf-8').decode(contents)));
        } catch (parseError) {
            callback(null, parseError);
        }
    });
}

/** Writes a JS object as JSON to the specified file path atomically, fire-and-forget (async). */
export function saveJsonToFile(filePath, data) {
    const parentDir = Gio.File.new_for_path(filePath).get_parent();
    if (parentDir)
        ensureDirectory(parentDir.get_path(), 'parent directory');
    const bytes = new GLib.Bytes(JSON.stringify(data, null, 2));
    Gio.File.new_for_path(filePath).replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (file, res) => {
        try {
            file.replace_contents_finish(res);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
        }
    });
}

/**
 * Synchronous counterpart of saveJsonToFile for teardown paths (widget destroy),
 * where an async write could still be pending when the extension is disabled.
 */
export function saveJsonToFileSync(filePath, data) {
    const parentDir = Gio.File.new_for_path(filePath).get_parent();
    if (parentDir)
        ensureDirectory(parentDir.get_path(), 'parent directory');
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    try {
        Gio.File.new_for_path(filePath).replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
        return true;
    } catch (e) {
        return false;
    }
}

/** Deletes the cache file associated with a widget from storage. */
export function deleteCacheFile(subFolder, widgetId) {
    if (!widgetId) return;
    const safeSubFolder = subFolder || '';
    const baseDir = getGridDesktopDataDir(safeSubFolder);
    const fileName = safeSubFolder ? `${safeSubFolder}-${widgetId}.json` : `${widgetId}.json`;
    const filePath = GLib.build_filenamev([baseDir, fileName]);
    const file = Gio.File.new_for_path(filePath);
    if (file.query_exists(null)) {
        file.delete_async(GLib.PRIORITY_DEFAULT, null, (f, res) => {
            try {
                f.delete_finish(res);
            } catch (e) {
  
            }
        });
    }
}

function resolveWidgetConfigValue(config, globalKey, overrideKey, fallbackKeys, defaultValue) {
    const globalValue = config?.[globalKey] ?? defaultValue;
    const colorOverrideValue = config?.overrideColors ?? config?.[overrideKey];
    if (colorOverrideValue === false) return globalValue;

    for (const key of fallbackKeys) {
        if (config[key] !== undefined && config[key] !== null) return config[key];
    }
    return globalValue;
}

export function resolveWidgetBackgroundColor(config) {
    const rawColor = resolveWidgetConfigValue(
        config,
        'globalBackgroundColor',
        'overrideBgColor',
        ['bgColor', 'textBackgroundColor'],
        DEFAULT_BG_COLOR
    );

    // Meghatározzuk a százalékos értéket (0–100)
    let opacityPercent = 100;
    const colorOverrideValue = config?.overrideColors ?? config?.overrideBgColor;

    if (colorOverrideValue && config?.bgOpacity !== undefined) {
        opacityPercent = config.bgOpacity;
    } else if (config?.globalBackgroundOpacity !== undefined) {
        opacityPercent = config.globalBackgroundOpacity;
    }

    const alpha = Math.max(0, Math.min(1, opacityPercent / 100));

    // A meglévő cssColorToRgba konvertálja át rgba(r, g, b, alpha) formára
    return cssColorToRgba(rawColor, alpha);
}

export function buildBaseWidgetStyle(config) {
    const borderRadius = config.appliedBorderRadius ?? DEFAULT_CORNER_RADIUS_PX;
    return `border-radius: ${borderRadius}px;`;
}

export function resolveWidgetForegroundColor(config) {
    return resolveWidgetConfigValue(
        config,
        'globalForegroundColor',
        'overrideFgColor',
        ['fgColor', 'textColor'],
        DEFAULT_FG_COLOR
    );
}

/**
 * Returns the explicitly configured font family, or '' when none is set so
 * widgets inherit the system theme font. Never falls back to a hard-coded
 * family; DEFAULT_FONT_FAMILY is only a prefs-side display fallback.
 */
export function resolveExplicitFontFamily(config) {
    return (config && (config.fontFamily || config.globalFontFamily)) || '';
}

/**
 * Small/Medium/Large footprints on the fixed grid, indexed 0-2.
 * image / slideshow stay free-resizable instead ("free flow").
 */
export const SIZE_PRESET_TIERS = ['Small', 'Medium', 'Large'];
const SIZE_PRESETS = {
    'time': [[2, 2], [3, 3], [4, 4]],
    'timeAnalog': [[2, 2], [3, 3], [4, 4]],
    'countdown': [[2, 2], [3, 3], [4, 4]],
    'stopwatch': [[2, 2], [3, 3], [4, 4]],
    'timer': [[2, 2], [3, 3], [4, 4]],
    'worldClock': [[2, 2], [3, 3], [4, 4]],
    'worldAnalog': [[2, 2], [3, 3], [4, 4]],
    'calendar': [[2, 2], [3, 3], [4, 4]],
    'calendar-grid': [[2, 2], [3, 3], [4, 4]],
    'calendarTasks': [[2, 2], [3, 3], [4, 4]],
    'todayHistory': [[2, 2], [3, 3], [4, 4]],
    // --- 2. IDŐJÁRÁS ÉS KÖRNYEZET ---
    'weatherStandard': [[2, 2], [3, 3], [4, 4]],
    'weatherSimple': [[2, 2], [3, 3], [4, 4]],
    'weatherCards': [[2, 2], [3, 3], [4, 4]],
    'weatherForecast': [[4, 2], [5, 3], [6, 4]],
    'weatherBars': [[4, 4], [5, 5], [6, 6]],
    'sun-schedule': [[2, 2], [3, 3], [4, 4]],
    'moon': [[4, 2], [5, 3], [6, 4]],
    'calendarWeather': [[4, 2], [5, 3], [6, 4]],
    'calendarEvents': [[4, 2], [5, 3], [6, 4]],
    // --- 3. HARDVER ÉS MONITORING ---
    'system-info': [[2, 2], [3, 3], [4, 4]],
    'ping-monitor':[[2, 2], [3, 3], [4, 4]],
    'updates': [[2, 2], [3, 3], [4, 4]],
    'mailGoa': [[2, 2], [3, 3], [4, 4]],
    'cpu-ram': [[4, 2], [5, 3], [6, 4]],
    'network-speed': [[4, 2], [5, 3], [6, 4]],
    'binary': [[4, 2], [5, 3], [6, 4]],
    'uptime': [[4, 2], [5, 3], [6, 4]],
    'system-dashboard': [[2, 2], [6, 5], [8, 6]],
    'resource-wheel': [[2, 2], [3, 3], [4, 4]],
    'storageBar': [[4, 2], [5, 3], [6, 4]],
    'hardwerinfo': [[4, 4], [5, 5], [6, 6]],
    'commandRunner': [[4, 2], [5, 3], [6, 4]],
    // --- 4. MÉDIA ÉS HANG ---
    'musicSmall': [[2, 2], [3, 3], [4, 4]],
    'musicWide': [[4, 2], [5, 3], [6, 4]],
    'audioOutput': [[2, 2], [3, 3], [4, 4]],
    'lyrics': [[4, 2], [5, 3], [6, 4]],
    'audioVisualizer': [[4, 2], [10, 4], [12, 4]],
    // --- 5. KAPCSOLÓK ÉS VEZÉRLÉS ---
    'battery-status': [[2, 2], [3, 3], [4, 4]],
    'powerProfiles': [[2, 2], [3, 3], [4, 4]],
    'powerToggles': [[2, 2], [3, 3], [4, 4]],
    'quickToggles': [[2, 2], [3, 3], [4, 4]],
    'controlsSliders': [[4, 2], [5, 3], [6, 4]],
    'bluetoothDevices': [[2, 2], [3, 3], [4, 4]],
    'lavaLamp': [[2, 4], [3, 5], [4, 6]],
    // --- 6. PRODUKTIVITÁS ÉS PÉNZÜGY ---
    'notes': [[2, 2], [3, 3], [4, 4]],
    'clipboard': [[2, 2], [3, 3], [4, 4]],
    'quotes': [[2, 2], [3, 3], [4, 4]],
    'pomodoro': [[2, 2], [3, 3], [4, 4]],
    'watermind': [[2, 2], [3, 3], [4, 4]],
    'downloads': [[4, 2], [5, 3], [6, 4]],
    'pomodoro-focus': [[4, 2], [5, 3], [6, 4]],
    'todo': [[2, 2], [3, 3], [4, 4]],
    'github': [[4, 2], [5, 3], [6, 4]],
    'mood': [[4, 2], [5, 3], [6, 4]],
    'currency-tracker': [[4, 2], [5, 3], [6, 4]],
    'cryptoWidget': [[4, 2], [5, 3], [6, 4]],
    'habitTracker': [[4, 2], [5, 3], [6, 4]],
    'screen-time': [[4, 2], [5, 3], [6, 4]],
    'rss-headlines': [[2, 2], [3, 3], [4, 4]],
    'steamRecent': [[2, 4], [3, 5], [4, 6]],
}; 

export const FREE_FLOW_SIZE_TYPES = ['image', 'slideshow'];

function resolveSizePresetTable(widgetData) {
    switch (widgetData.type) {
        case 'worldAnalog':
            return SIZE_PRESETS.worldAnalog;
        case 'time':
            if (widgetData.layout === 'worldAnalog' || widgetData.layout === 'worldClockAnalog') {
                return SIZE_PRESETS.worldAnalog;
            }
            if (widgetData.layout === 'analog' || widgetData.type === 'analogClock') {
                return SIZE_PRESETS.timeAnalog;
            }
            return (widgetData.layout === 'world') ? SIZE_PRESETS.worldClock : SIZE_PRESETS.time;
        case 'weather': {    
            const layout = widgetData.layout || 'standard';
            if (layout === 'cards')
                return SIZE_PRESETS.weatherCards;
            if (layout === 'bars')
                return SIZE_PRESETS.weatherBars;
            if (layout === 'forecast')
                return SIZE_PRESETS.weatherForecast;
            return (layout === 'simple') ? SIZE_PRESETS.weatherSimple : SIZE_PRESETS.weatherStandard;
        }
        case 'weather_bars':
            return SIZE_PRESETS.weatherBars;
        case 'weather_cards':
            return SIZE_PRESETS.weatherCards;
        case 'music':
            return isWideMusicLayout(widgetData) ? SIZE_PRESETS.musicWide : SIZE_PRESETS.musicSmall;
        default:
            return SIZE_PRESETS[widgetData.type] || null;
    }
}

/** App launcher tiles grow with the app count; frames scale one step per preset tier. */
function resolveAppLauncherPreset(widgetData, sizeIndex) {
    const appCount = Array.isArray(widgetData.apps) ? widgetData.apps.length : 0;
    
    // Alapértelmezett indító méretek az appok száma szerint:
    // Legfeljebb 4 appnál kényelmes a 4x4, 4 felett (max 8-ig) kell a 8x4-es sáv
    if (appCount > 4) {
        // [Small (8x4), Medium (10x5), Large (12x6)]
        const presets = [[4, 2], [5, 3], [6, 3]];
        const [width, height] = presets[sizeIndex] || presets[0];
        return { width, height };
    } else {
        // 1-4 app esetén:
        // [Small (4x4), Medium (5x5), Large (6x6)]
        const presets = [[2, 2], [3, 3], [4, 4]];
        const [width, height] = presets[sizeIndex] || presets[0];
        return { width, height };
    }
}

/** Returns whether the widget's context menu should offer S/M/L sizing. */
export function supportsSizePresets(widgetData) {
    return !FREE_FLOW_SIZE_TYPES.includes(widgetData.type)
        && (resolveSizePresetTable(widgetData) !== null || widgetData.type === 'app-launcher');
}

/** Returns the {width, height} footprint for a preset tier, or null when unsupported. */
export function resolveWidgetSizePreset(widgetData, sizeIndex) {
    if (widgetData.type === 'app-launcher')
        return resolveAppLauncherPreset(widgetData, sizeIndex);
    const table = resolveSizePresetTable(widgetData);
    if (!table || !table[sizeIndex])
        return null;
    return { width: table[sizeIndex][0], height: table[sizeIndex][1] };
}

export const WIDE_MUSIC_LAYOUT_ASPECT_RATIO = 1.5;

/**
 * Single source of truth for classifying the wide music layout; shared by the
 * shell-side music widget and the preferences catalog/edit panel.
 */
export function isWideMusicLayout(widget) {
    if (widget.isLargeLayout) return true;
    return widget.height > 0 && widget.width / widget.height >= WIDE_MUSIC_LAYOUT_ASPECT_RATIO;
}

/** Validates and constrains a widget's proposed new position and size during resize operations. */
export function calculateResizedDimensions(widgetData, newCols, newRows, newGridX, widgets = null, maxCols = COLUMNS_COUNT, maxRows = ROWS_COUNT) {
    const minLimits = MIN_WIDGET_SIZES[widgetData.type] || { minCols: 2, minRows: 2 };
    let validX = Math.max(0, Math.min(newGridX, maxCols - minLimits.minCols));
    let validCols = Math.max(minLimits.minCols, Math.min(newCols, maxCols - validX));
    let validRows = Math.max(minLimits.minRows, Math.min(newRows, maxRows - widgetData.y));

    if (widgetData.type === 'music' && widgetData.isLargeLayout) {
        validRows = Math.max(minLimits.minRows, Math.floor(validCols / 2));
        validCols = validRows * 2;
        if (validX + validCols > maxCols)
            validX = maxCols - validCols;

        if (widgetData.y + validRows > maxRows) {
            validRows = Math.max(1, maxRows - widgetData.y);
            validCols = validRows * 2;
        }
    }

    const otherWidgets = widgets ? widgets.filter(widget => widget.id !== widgetData.id) : [];

    if (otherWidgets.length > 0) {

        // Shrink width first, then height, so resize feedback stays predictable while avoiding overlap.
        while (validCols > minLimits.minCols && checkOverlap(validX, widgetData.y, validCols, validRows, otherWidgets)) {
            validCols--;
        }

        while (validRows > minLimits.minRows && checkOverlap(validX, widgetData.y, validCols, validRows, otherWidgets)) {
            validRows--;
        }

        if (checkOverlap(validX, widgetData.y, validCols, validRows, otherWidgets)) {
            validCols = Math.min(widgetData.width || minLimits.minCols, validCols);
            validRows = Math.min(widgetData.height || minLimits.minRows, validRows);
        }
    }

    return {
        validCols,
        validRows,
        validX,
    };
}

export function checkOverlap(x, y, width, height, widgets) {
    for (const widget of widgets) {
        const overlapX = x < (widget.x + widget.width) && (x + width) > widget.x;
        const overlapY = y < (widget.y + widget.height) && (y + height) > widget.y;
        if (overlapX && overlapY)
            return true;
    }
    return false;
}

export function todayDateString() {
    return toDateString(GLib.DateTime.new_now_local());
}

export function toDateString(dateTime) {
    return `${dateTime.get_year()}-${dateTime.get_month().toString().padStart(2, '0')}-${dateTime.get_day_of_month().toString().padStart(2, '0')}`;
}

const DEFAULT_SCREEN_ASPECT_RATIO = 16 / 9;

export function findEmptySpot(widgets, reqWidth, reqHeight, maxCols = COLUMNS_COUNT, maxRows = ROWS_COUNT) {
    const effectiveReqW = Math.max(1, Math.min(reqWidth, maxCols));
    const effectiveReqH = Math.max(1, reqHeight);
    const limitRows = Math.max(maxRows || ROWS_COUNT, 50);

    for (let row = 0; row <= limitRows - effectiveReqH; row++) {
        for (let col = 0; col <= maxCols - effectiveReqW; col++) {
            if (!checkOverlap(col, row, effectiveReqW, effectiveReqH, widgets)) {
                return { x: col, y: row };
            }
        }
    }
    return null;
}

export function getWidgets(settings) {
    if (!settings) return [];
    try {
        const jsonString = settings.get_string('widgets');
        return jsonString ? JSON.parse(jsonString) : [];
    } catch (e) {
        return [];
    }
}

export function serializeWidgets(widgets) {
    return JSON.stringify(widgets || []);
}

export function saveWidgets(settings, widgets) {
    if (!settings) return;
    try {
        settings.set_string('widgets', serializeWidgets(widgets));
    } catch (e) {

    }
}

/** Generates a unique widget ID by incrementing the highest existing counter for the given prefix. */
export function nextWidgetId(settings, prefix) {
    const idStem = `widget-${prefix}-`;
    let maxCounter = 0;
    for (const widget of getWidgets(settings)) {
        if (typeof widget.id !== 'string' || !widget.id.startsWith(idStem))
            continue;
        const counter = parseInt(widget.id.slice(idStem.length), 10);
        if (!isNaN(counter) && counter > maxCounter)
            maxCounter = counter;
    }
    return `${idStem}${maxCounter + 1}`;
}

/** Finds an empty grid spot, assigns position/size, and persists the widget. */
export function addWidget(settings, widgetData, defaultWidth, defaultHeight) {
    const widgets = getWidgets(settings);

    if (widgetData.type === 'app-launcher') {
        const appCount = Array.isArray(widgetData.apps) ? widgetData.apps.length : 0;
        if (appCount > 4) {
            defaultWidth = 4;
            defaultHeight = 2;
        }
    }
    

    const defaultPreset = supportsSizePresets(widgetData)
        ? resolveWidgetSizePreset(widgetData, 0)
        : null;
    const spawnWidth = defaultPreset ? defaultPreset.width : defaultWidth;
    const spawnHeight = defaultPreset ? defaultPreset.height : defaultHeight;

    const cellSize = settings ? (settings.get_int('grid-cell-size') || 80) : 80;
    const gridGap = settings ? (settings.get_int('grid-gap-size') || 16) : 16;
    const step = cellSize + gridGap;

    let screenWidth = 2560; // Biztonságos fallback a korábbi 1920 helyett!

    if (widgetData.type === 'app-launcher' && defaultWidth > spawnWidth) {
        spawnWidth = defaultWidth;
        spawnHeight = defaultHeight;
    }
    
    try {
        try {
            if (typeof global !== 'undefined' && global.stage && global.stage.width) {
                screenWidth = global.stage.width;
            } else if (typeof global !== 'undefined' && global.display) {
                const primaryMonIdx = global.display.get_primary_monitor();
                const geom = global.display.get_monitor_geometry(primaryMonIdx);
                if (geom && geom.width > 0) {
                    screenWidth = geom.width;
                }
            }
        } catch (e) {
            screenWidth = 1920;
        }
    } catch (e) {
        screenWidth = 2560;
    }

    const availableWidth = Math.max(step, screenWidth - (GRID_MARGIN_PX * 2));
    const actualGridCols = Math.max(1, Math.floor((availableWidth + GRID_GAP_PX) / step));

    const emptySpot = findEmptySpot(widgets, spawnWidth, spawnHeight, actualGridCols);
    widgetData.x = emptySpot ? emptySpot.x : 0;
    widgetData.y = emptySpot ? emptySpot.y : 0;
    widgetData.width = spawnWidth;
    widgetData.height = spawnHeight;
    widgets.push(widgetData);
    saveWidgets(settings, widgets);
}

/**
 * Resolves a .desktop app id to a DesktopAppInfo;
 * the class lives in the GioUnix platform library.
 */
export function resolveDesktopAppInfo(appId) {
    if (!appId || typeof appId !== 'string') return null;

    const idCandidates = appId.endsWith('.desktop') ? [appId] : [appId, `${appId}.desktop`];

    for (const candidate of idCandidates) {
        const appInfo = GioUnix.DesktopAppInfo.new(candidate);
        if (appInfo && appInfo.get_id()) return appInfo;
    }
    return null;
}

export function calculateDesktopIconPositions(files, settings, gridCols, gridRows) {
    const showLabels = settings.get_boolean('desktop-icons-show-labels');
    const side = settings.get_string('desktop-icons-side') || 'left';
    const direction = settings.get_string('desktop-icons-direction') || 'vertical';
    
    const size = 2;
    const icons = [];

    // Kezdőpozíciók
    let startX = (side === 'left') ? 0 : gridCols - size;
    let currentX = startX;
    let currentY = 0;

    for (const file of files) {
        icons.push({
            ...file,
            x: currentX,
            y: currentY,
            width: size,
            height: size,
            showLabel: showLabels,
            isDesktopIcon: true, // Jelölő a context menu tiltáshoz
            type: 'desktop-icon'
        });

        if (direction === 'vertical') {
            currentY += size;
            if (currentY + size > gridRows) {
                currentY = 0;
                currentX = (side === 'left') ? currentX + size : currentX - size;
            }
        } else {
            // Horizontal
            currentX = (side === 'left') ? currentX + size : currentX - size;
            if (currentX < 0 || currentX + size > gridCols) {
                currentX = startX;
                currentY += size;
            }
        }
    }
    return icons;
}