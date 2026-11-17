import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import Pango from 'gi://Pango';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveExplicitFontFamily, DEFAULT_BG_COLOR, buildBaseWidgetStyle, celsiusToFahrenheit, isDarkBackgroundColor } from '../../utils/widgetUtils.js';
import { isActorDestroyed, watchActorLifecycle } from '../../utils/actorLifecycle.js';
import { resolveWidgetGlassHighlight } from '../../shell/widgetUIUtils.js';

export const REFRESH_INTERVAL_SECONDS = 1800;
export const FALLBACK_LOCATION = 'London';
export const HTTP_STATUS_OK = 200;
export const HOURLY_FORECAST_COUNT = 6;
export const DEFAULT_WEATHER_BORDER_RADIUS_PX = 24;
export const FORECAST_MIN_GRID_WIDTH = 6;
export const SIMPLE_MIN_GRID_WIDTH = 4;

const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
const weatherBaseDir = GLib.path_get_dirname(currentFilePath);

const WEATHER_CACHE = new Map();
const WEATHER_PROMISES = new Map();
const CACHE_TTL_MS = 60 * 1000;

let sharedWeatherSession = null;
export function getSharedWeatherSession() {
    if (!sharedWeatherSession)
        sharedWeatherSession = new Soup.Session({ user_agent: 'grid-desktop-gnome' });
    return sharedWeatherSession;
}

export async function fetchCachedJson(url, cancellable = null) {
    const now = Date.now();
    const cached = WEATHER_CACHE.get(url);
    if (cached && (now - cached.timestamp < CACHE_TTL_MS))
        return cached.data;

    if (WEATHER_PROMISES.has(url))
        return WEATHER_PROMISES.get(url);

    const session = getSharedWeatherSession();
    const promise = fetchJsonAsync(session, url, cancellable).then(data => {
        WEATHER_CACHE.set(url, { timestamp: Date.now(), data });
        WEATHER_PROMISES.delete(url);
        return data;
    }).catch(err => {
        WEATHER_PROMISES.delete(url);
        throw err;
    });

    WEATHER_PROMISES.set(url, promise);
    return promise;
}

export function buildOpenMeteoForecastUrl(latitude, longitude) {
    return 'https://api.open-meteo.com/v1/forecast?latitude='
        + `${latitude}&longitude=${longitude}`
        + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_gusts_10m,uv_index'
        + '&past_days=1&forecast_days=6'
        + '&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation,weather_code,surface_pressure,cloud_cover,wind_speed_10m,wind_gusts_10m,uv_index,is_day'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto';
}

const TEXT_COLOR_ON_LIGHT_BG = '#000000';
const TEXT_COLOR_ON_DARK_BG = '#ffffff';

export function buildFontCss(widgetData) {
    const fontFamily = resolveExplicitFontFamily(widgetData);
    return fontFamily ? `font-family: ${fontFamily}; ` : '';
}

const decoder = new TextDecoder('utf-8');
const MILLISECONDS_PER_SECOND = 1000;
const LAYOUT_PADDING_PX = 12;
const GEOCODE_CACHE = new Map();
const GEOCODE_CACHE_LIMIT = 32;

function cacheBounded(map, limit, key, value) {
    if (map.size >= limit)
        map.delete(map.keys().next().value);
    map.set(key, value);
}

export function configureWrappingLabel(label, alignment = Pango.Alignment.LEFT) {
    label.clutter_text.single_line_mode = false;
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    label.clutter_text.set_line_alignment(alignment);
}

const WEATHER_CODE_CLEAR = 1000;
const WEATHER_CODE_PARTLY_CLOUDY = 1003;
const WEATHER_CODE_CLOUDY_1 = 1006;
const WEATHER_CODE_CLOUDY_2 = 1009;
const WEATHER_CODE_FOG_GROUP = [1030, 1039, 1042, 1135, 1147];
const WEATHER_CODE_DUST_GROUP = [1015, 1018, 1021, 1024, 1027, 1033, 1036, 1045, 1048];
const WEATHER_CODE_SLEET_GROUP = [1198, 1201];
const WEATHER_CODE_HAIL_GROUP = [1237, 1261, 1264];
const WEATHER_CODE_RAIN_GROUP = [1063, 1072, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195];
const WEATHER_CODE_THUNDERSTORMS_GROUP = [1087, 1273, 1276, 1279, 1282];
const WEATHER_CODE_SNOW_BLIZZARD = 1117;
const WEATHER_CODE_SNOW_GROUP = [1066, 1114, 1210, 1213, 1219, 1222, 1225];

export function resolveConditionCode(code, text = '') {
    if (typeof code === 'number' && code > 0) return code;
    const lower = (text || '').toLowerCase();
    if (lower.includes('clear') || lower.includes('sun')) return WEATHER_CODE_CLEAR;
    if (lower.includes('partly')) return WEATHER_CODE_PARTLY_CLOUDY;
    if (lower.includes('cloud') || lower.includes('overcast')) return WEATHER_CODE_CLOUDY_1;
    if (lower.includes('fog') || lower.includes('mist')) return WEATHER_CODE_FOG_GROUP[0];
    if (lower.includes('dust') || lower.includes('sand')) return WEATHER_CODE_DUST_GROUP[0];
    if (lower.includes('sleet') || lower.includes('freezing')) return WEATHER_CODE_SLEET_GROUP[0];
    if (lower.includes('hail')) return WEATHER_CODE_HAIL_GROUP[0];
    if (lower.includes('rain') || lower.includes('drizzle') || lower.includes('shower')) return WEATHER_CODE_RAIN_GROUP[0];
    if (lower.includes('thunder') || lower.includes('storm')) return WEATHER_CODE_THUNDERSTORMS_GROUP[0];
    if (lower.includes('blizzard')) return WEATHER_CODE_SNOW_BLIZZARD;
    if (lower.includes('snow') || lower.includes('flurry')) return WEATHER_CODE_SNOW_GROUP[0];
    return WEATHER_CODE_CLEAR;
}

let _gnomeWeatherSettings = undefined;
export function getGnomeDefaultWeatherCity() {
    try {
        if (_gnomeWeatherSettings === undefined) {
            const schemaSource = Gio.SettingsSchemaSource.get_default();
            const schema = schemaSource?.lookup('org.gnome.shell.weather', true);
            _gnomeWeatherSettings = schema ? new Gio.Settings({ settings_schema: schema }) : null;
        }
        if (!_gnomeWeatherSettings) return null;

        const locations = _gnomeWeatherSettings.get_value('locations').deep_unpack();
        if (locations && locations.length > 0 && Array.isArray(locations[0]) && locations[0][0]) {
            return locations[0][0];
        }
    } catch (_e) {}
    return null;
}

let _extSettingsCache = null;
export function getExtensionSettings() {
    if (_extSettingsCache) return _extSettingsCache;
    try {
        const schemaDir = GLib.build_filenamev([weatherBaseDir, '..', '..', 'schemas']);
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            schemaDir,
            Gio.SettingsSchemaSource.get_default(),
            false
        );
        const schema = schemaSource.lookup('org.gnome.shell.extensions.grid-desktop', true);
        if (schema) {
            _extSettingsCache = new Gio.Settings({ settings_schema: schema });
            return _extSettingsCache;
        }
    } catch (_e) {}
    return null;
}

let _ifaceSettingsCache = undefined;
export function resolveUse24Hour(widgetData) {
    if (widgetData?.use24Hour !== undefined) return Boolean(widgetData.use24Hour);
    if (widgetData?.globalUse24Hour !== undefined) return Boolean(widgetData.globalUse24Hour);
    if (widgetData?.timeFormat24h !== undefined) return Boolean(widgetData.timeFormat24h);

    const extSettings = widgetData?.settings || getExtensionSettings();
    if (extSettings) {
        try {
            return extSettings.get_boolean('time-format-24h');
        } catch (_e) {}
    }

    try {
        if (_ifaceSettingsCache === undefined) {
            _ifaceSettingsCache = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        }
        return _ifaceSettingsCache.get_string('clock-format') === '24h';
    } catch (_e) {
        return true;
    }
}

export function getWeatherAssets(extensionPath, code, isDay, folderName = '3x3', text = '') {
    const effectiveCode = resolveConditionCode(code, text);
    const timeOfDay = isDay ? 'day' : 'night';

    const getImgPath = (name) => GLib.build_filenamev([weatherBaseDir, 'weather', folderName, `${name}.png`]);
    const getIconPath = (name) => GLib.build_filenamev([weatherBaseDir, 'weather', 'icons', `wi_${name}.svg`]);

    const assets = {
        iconPath: GLib.build_filenamev([weatherBaseDir, 'weather', 'icons', `wi_clear-${timeOfDay}.svg`]),
        bgStart: DEFAULT_BG_COLOR,
        bgEnd: DEFAULT_BG_COLOR,
        bgImagePath: '',
    };

    if (effectiveCode === WEATHER_CODE_CLEAR) {
        assets.iconPath = isDay ? getIconPath('clear-day') : getIconPath('clear-night');
        assets.bgStart = isDay ? '#2b84d4' : '#121e33';
        assets.bgEnd = isDay ? '#1a5a9e' : '#0a1221';
        assets.bgImagePath = isDay ? getImgPath('clear-day') : getImgPath('clear-night');
    } else if (effectiveCode === WEATHER_CODE_PARTLY_CLOUDY) {
        assets.iconPath = isDay ? getIconPath('partly-cloudy-day') : getIconPath('partly-cloudy-night');
        assets.bgStart = isDay ? '#5b8cbd' : '#25354a';
        assets.bgEnd = isDay ? '#3d6a94' : '#152335';
        assets.bgImagePath = isDay ? getImgPath('partly-cloudy-day') : getImgPath('partly-cloudy-night');
    } else if (effectiveCode === WEATHER_CODE_CLOUDY_1) {
        assets.iconPath = getIconPath('cloudy');
        assets.bgStart = isDay ? '#121D2B' : '#14181a';
        assets.bgEnd = isDay ? '#1a2a3d' : '#0c0f12';
        assets.bgImagePath = getImgPath('cloudy-day');
    } else if (effectiveCode === WEATHER_CODE_CLOUDY_2) {
        assets.iconPath = getIconPath('overcast');
        assets.bgStart = isDay ? '#0e1520' : '#0c0f12';
        assets.bgEnd = isDay ? '#162030' : '#0a0d10';
        assets.bgImagePath = getImgPath('overcast-day');
    } else if (WEATHER_CODE_FOG_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('fog');
        assets.bgStart = isDay ? '#a1aba3' : '#3c403e';
        assets.bgEnd = isDay ? '#7a8480' : '#252825';
        assets.bgImagePath = getImgPath('fog-day');
    } else if (WEATHER_CODE_DUST_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('dust');
        assets.bgStart = isDay ? '#c2a884' : '#4a3d2c';
        assets.bgEnd = isDay ? '#a08460' : '#302618';
        assets.bgImagePath = getImgPath('sandstorm-day');
    } else if (WEATHER_CODE_SLEET_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('sleet');
        assets.bgStart = isDay ? '#5a8f9c' : '#1d343b';
        assets.bgEnd = isDay ? '#3d6e78' : '#112126';
        assets.bgImagePath = getImgPath('rain-day');
    } else if (WEATHER_CODE_HAIL_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('hail');
        assets.bgStart = isDay ? '#7b8c9c' : '#212a33';
        assets.bgEnd = isDay ? '#5a6b7a' : '#131a22';
        assets.bgImagePath = getImgPath('rain-day');
    } else if (WEATHER_CODE_RAIN_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('rain');
        assets.bgStart = isDay ? '#121D2B' : '#14181a';
        assets.bgEnd = isDay ? '#1a2a3d' : '#0c0f12';
        assets.bgImagePath = getImgPath('rain-day');
    } else if (WEATHER_CODE_THUNDERSTORMS_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('thunderstorms');
        assets.bgStart = '#232533';
        assets.bgEnd = '#151622';
        assets.bgImagePath = getImgPath('rain-day');
    } else if (effectiveCode === WEATHER_CODE_SNOW_BLIZZARD) {
        assets.iconPath = getIconPath('snow');
        assets.bgStart = isDay ? '#b8d6eb' : '#465661';
        assets.bgEnd = isDay ? '#8bb5d0' : '#2e3b44';
        assets.bgImagePath = getImgPath('snow-day');
    } else if (WEATHER_CODE_SNOW_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('snow');
        assets.bgStart = isDay ? '#8dafc4' : '#243a4a';
        assets.bgEnd = isDay ? '#6d92a8' : '#162633';
        assets.bgImagePath = getImgPath('snow-day');
    }

    if (!GLib.file_test(assets.iconPath, GLib.FileTest.EXISTS)) {
        assets.iconPath = GLib.build_filenamev([weatherBaseDir, 'weather', 'icons', `wi_clear-${timeOfDay}.svg`]);
    }

    if (assets.bgImagePath && !GLib.file_test(assets.bgImagePath, GLib.FileTest.EXISTS))
        assets.bgImagePath = '';

    return assets;
}

export function createBackgroundImageActor(widgetNode) {
    return watchActorLifecycle(new St.Widget({
        style: '',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    }));
}

export function createMainLayout(widgetNode) {
    return watchActorLifecycle(new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        style: `padding: ${LAYOUT_PADDING_PX}px;`,
    }));
}

export function createFallbackIcon(extensionPath) {
    return new Gio.FileIcon({
        file: Gio.File.new_for_path(GLib.build_filenamev([weatherBaseDir, 'weather', 'icons', 'wi_clear-day.svg'])),
    });
}

export function resolveWeatherLayoutVariant(widgetData) {
    if (!widgetData) return 'standard';

    const type = widgetData.type || '';
    if (type === 'weather_cards' || type === 'weatherCards') return 'cards';
    if (type === 'weather_bars' || type === 'weatherBars') return 'bars';
    if (type === 'weather_forecast' || type === 'weatherForecast') return 'forecast';
    if (type === 'weather_simple' || type === 'weatherSimple') return 'simple';
    if (type === 'weather_standard' || type === 'weatherStandard') return 'standard';

    if (widgetData.layout) return widgetData.layout;

    const w = widgetData.width || 4;
    const h = widgetData.height || 4;

    if (w >= 6 && h < 6) return 'forecast';
    if (w >= 6 && h >= 6) return 'bars';
    return 'standard';
}

export function getAssetSizeForWidget(widgetData) {
    const layoutVariant = resolveWeatherLayoutVariant(widgetData);
    if (layoutVariant === 'forecast' || layoutVariant === 'bars') {
        return '4x6';
    }
    return '3x3';
}

export function updateHourlyForecastUi(json, uiElements, currentEpoch, extensionPath, useFahrenheit, folderName = '3x3', use24Hour = true) {
    if (!uiElements.hourlyActors || uiElements.hourlyActors.length === 0 || !json.forecast || !json.forecast.forecastday)
        return;

    let allHours = [];
    for (const dayEntry of json.forecast.forecastday) {
        if (dayEntry?.hour)
            allHours = allHours.concat(dayEntry.hour);
    }

    const currentHourStr = json.current ? json.current.last_updated_hour : null;
    let futureHours;
    if (currentHourStr) {
        futureHours = allHours.filter(h => h.time_str && h.time_str.slice(0, 13) > currentHourStr);
    } else {
        const refEpoch = currentEpoch || Math.floor(Date.now() / 1000);
        futureHours = allHours.filter(h => h.time_epoch > refEpoch);
    }

    if (futureHours.length < HOURLY_FORECAST_COUNT && allHours.length >= HOURLY_FORECAST_COUNT) {
        futureHours = allHours.slice(-HOURLY_FORECAST_COUNT);
    }

    for (let i = 0; i < HOURLY_FORECAST_COUNT; i++) {
        if (futureHours[i] && uiElements.hourlyActors[i]) {
            const hourData = futureHours[i];
            let hours;
            if (hourData.time_str) {
                const timeMatch = hourData.time_str.match(/T(\d{2}):/);
                hours = timeMatch ? parseInt(timeMatch[1], 10) : 0;
            } else {
                hours = new Date(hourData.time_epoch * 1000).getHours();
            }

            let timeText;
            if (use24Hour) {
                timeText = `${String(hours).padStart(2, '0')}:00`;
            } else {
                const ampm = hours >= 12 ? 'PM' : 'AM';
                const hour12 = hours % 12 || 12;
                timeText = `${hour12} ${ampm}`;
            }

            const displayTemperature = useFahrenheit ? hourData.temp_f : hourData.temp_c;
            uiElements.hourlyActors[i].timeLbl.text = timeText;
            uiElements.hourlyActors[i].tempLbl.text = `${Math.round(displayTemperature)}°`;

            const condCode = resolveConditionCode(hourData.condition ? hourData.condition.code : null, hourData.condition ? hourData.condition.text : '');
            const isDay = hourData.is_day !== undefined ? (hourData.is_day === 1 || hourData.is_day === true) : true;
            const hourlyAssets = getWeatherAssets(extensionPath, condCode, isDay, folderName, hourData.condition ? hourData.condition.text : '');
            uiElements.hourlyActors[i].icon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(hourlyAssets.iconPath) });
        }
    }
}

export function refreshDailyBarGeometry(actor, forcedWidth = null) {
    if (!actor || !actor.barBg || !actor.activeBar) return;

    let barWidth = forcedWidth;
    if (!barWidth || barWidth <= 0) {
        barWidth = actor.barBg.width > 0 ? actor.barBg.width : actor.barBg.get_allocation_box().get_width();
    }
    if (!barWidth || barWidth <= 0) {
        barWidth = 60;
    }

    const leftRatio = actor._leftRatio ?? 0;
    const widthRatio = actor._widthRatio ?? 0.2;

    const activeLeft = Math.round(leftRatio * barWidth);
    let activeWidth = Math.round(widthRatio * barWidth);
    activeWidth = Math.max(4, Math.min(activeWidth, barWidth - activeLeft));

    actor.activeBar.set_x(activeLeft);
    actor.activeBar.set_width(activeWidth);
}

export function updateDailyForecastUi(json, uiElements, extensionPath, useFahrenheit, folderName = '3x3') {
    if (!uiElements.dailyActors || uiElements.dailyActors.length === 0 || !json.forecast || !json.forecast.forecastday)
        return;

    const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

    const forecastDays = json.forecast.forecastday;
    const todayStr = json.current?.last_updated_hour?.slice(0, 10);
    const futureDays = todayStr ? forecastDays.filter(d => d.date > todayStr) : forecastDays.slice(1);
    const displayDays = (futureDays.length > 0 ? futureDays : forecastDays).slice(0, 5);

    if (displayDays.length === 0) return;

    let globalMin = Math.min(...displayDays.map(d => useFahrenheit ? d.day.mintemp_f : d.day.mintemp_c));
    let globalMax = Math.max(...displayDays.map(d => useFahrenheit ? d.day.maxtemp_f : d.day.maxtemp_c));
    if (globalMin === globalMax) globalMax += 1;
    const totalRange = globalMax - globalMin;

    displayDays.forEach((dayData, i) => {
        if (!uiElements.dailyActors[i]) return;
        const actor = uiElements.dailyActors[i];

        const minVal = useFahrenheit ? dayData.day.mintemp_f : dayData.day.mintemp_c;
        const maxVal = useFahrenheit ? dayData.day.maxtemp_f : dayData.day.maxtemp_c;

        let dayName = '--';
        if (dayData.date) {
            const dateObj = new Date(dayData.date + 'T00:00:00');
            const formatted = weekdayFormatter.format(dateObj);
            dayName = formatted.charAt(0).toUpperCase() + formatted.slice(1);
        }
        actor.dayLabel.text = dayName;

        const condCode = resolveConditionCode(dayData.day.condition ? dayData.day.condition.code : null);
        const assets = getWeatherAssets(extensionPath, condCode, true, folderName, dayData.day.condition ? dayData.day.condition.text : '');
        actor.icon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(assets.iconPath) });

        actor.minLabel.text = `${Math.round(minVal)}°`;
        actor.maxLabel.text = `${Math.round(maxVal)}°`;

        if (totalRange > 0 && Number.isFinite(minVal) && Number.isFinite(maxVal)) {
            const leftRatio = Math.max(0, Math.min(1, (minVal - globalMin) / totalRange));
            const rightRatio = Math.max(0, Math.min(1, (maxVal - globalMin) / totalRange));
            actor._leftRatio = leftRatio;
            actor._widthRatio = Math.max(0.05, rightRatio - leftRatio);
        } else {
            actor._leftRatio = 0;
            actor._widthRatio = 0.2;
        }

        refreshDailyBarGeometry(actor);
    });
}

export function updateTextLabels(json, uiElements, useFahrenheit) {
    const current = json.current;
    if (!current) return;

    const todayStr = current.last_updated_hour?.slice(0, 10);
    const forecastDays = json.forecast?.forecastday || [];
    const todayForecast = (todayStr ? forecastDays.find(d => d.date === todayStr) : null) || forecastDays[0];
    const forecast = todayForecast ? todayForecast.day : null;
    const unit = useFahrenheit ? '°F' : '°C';

    const currentTemp = useFahrenheit ? current.temp_f : current.temp_c;
    if (uiElements.tempLabel) uiElements.tempLabel.text = `${Math.round(currentTemp)}${unit}`;
    if (uiElements.conditionLabel && current.condition) uiElements.conditionLabel.text = current.condition.text;
    if (json.location && json.location.name && uiElements.cityLabel) uiElements.cityLabel.text = json.location.name;

    if (forecast) {
        const highTemp = useFahrenheit ? forecast.maxtemp_f : forecast.maxtemp_c;
        const lowTemp = useFahrenheit ? forecast.mintemp_f : forecast.mintemp_c;
        if (uiElements.highLowLabel) uiElements.highLowLabel.text = `H:${Math.round(highTemp)}${unit} L:${Math.round(lowTemp)}${unit}`;
    }

    if (uiElements.dateLabel) {
        const epoch = current.last_updated_epoch ? current.last_updated_epoch * 1000 : Date.now();
        const date = new Date(epoch);
        const dateHeaderFormatter = new Intl.DateTimeFormat(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
        uiElements.dateLabel.text = dateHeaderFormatter.format(date);
    }
}

export function updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage) {
    if (widgetData.type === 'weather_cards' || widgetData.layout === 'cards') {
        bgImageActor.hide();
        return;
    }

    const glassHighlight = resolveWidgetGlassHighlight(widgetData);
    const fontCss = buildFontCss(widgetData);
    const baseStyle = buildBaseWidgetStyle(widgetData);

    if (isDynamicColor) {
        const bgEnd = assets.bgEnd || assets.bgStart;
        const textColor = isDarkBackgroundColor(assets.bgStart || DEFAULT_BG_COLOR)
            ? TEXT_COLOR_ON_DARK_BG
            : TEXT_COLOR_ON_LIGHT_BG;

        widgetNode.style = `background-gradient-direction: vertical; `
            + `background-gradient-start: ${assets.bgStart}; `
            + `background-gradient-end: ${bgEnd}; `
            + `color: ${textColor}; `
            + `${fontCss}`
            + `${baseStyle}`
            + `${glassHighlight}`;
    } else {
        const bgColor = resolveWidgetBackgroundColor(widgetData);
        const textColor = resolveWidgetForegroundColor(widgetData);
        widgetNode.style = `background-color: ${bgColor}; `
            + `color: ${textColor}; `
            + `${fontCss}`
            + `${baseStyle}`
            + `${glassHighlight}`;
    }

    if (isDynamicImage && assets.bgImagePath) {
        const rawRadius = widgetData.appliedBorderRadius ?? widgetData.borderRadius;
        const borderRadius = (Number.isFinite(rawRadius) && rawRadius >= 0)
            ? Math.round(rawRadius)
            : DEFAULT_WEATHER_BORDER_RADIUS_PX;

        bgImageActor.style = `background-image: url("${assets.bgImagePath}"); `
            + `border-radius: ${borderRadius}px;`;
        bgImageActor.show();
    } else {
        bgImageActor.hide();
    }
}

export function updateWeatherUi(json, context) {
    context.lastWeatherJson = json;
    const { widgetData, uiElements, widgetNode, bgImageActor, isDynamicColor, isDynamicImage, extensionPath } = context;
    if (isActorDestroyed(widgetNode) || !json || !json.current) return;

    const useFahrenheit = widgetData.useFahrenheit !== undefined ? widgetData.useFahrenheit : (widgetData.globalUseFahrenheit === true);
    const use24Hour = resolveUse24Hour(widgetData);
    const isDay = json.current.is_day !== undefined ? (json.current.is_day === 1 || json.current.is_day === true) : true;
    const condCode = resolveConditionCode(json.current.condition ? json.current.condition.code : null, json.current.condition ? json.current.condition.text : '');
    const folderName = getAssetSizeForWidget(widgetData);
    const assets = getWeatherAssets(extensionPath, condCode, isDay, folderName, json.current.condition ? json.current.condition.text : '');

    updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage);
    updateTextLabels(json, uiElements, useFahrenheit);

    if (uiElements.conditionIcon) {
        uiElements.conditionIcon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(assets.iconPath) });
    }

    updateHourlyForecastUi(json, uiElements, json.current.last_updated_epoch, extensionPath, useFahrenheit, folderName, use24Hour);
    updateDailyForecastUi(json, uiElements, extensionPath, useFahrenheit, folderName);

    if (uiElements && uiElements.isCardsLayout && typeof uiElements.updateCards === 'function') {
        uiElements.updateCards(json, useFahrenheit);
    }
}

function getWmoConditionText(code) {
    switch (code) {
        case 0: return 'Sunny';
        case 1: return 'Mainly Clear';
        case 2: return 'Partly Cloudy';
        case 3: return 'Overcast';
        case 45: case 48: return 'Foggy';
        case 51: case 53: case 55: return 'Drizzle';
        case 56: case 57: return 'Freezing Drizzle';
        case 61: case 63: case 65: return 'Rain';
        case 66: case 67: return 'Freezing Rain';
        case 71: case 73: case 75: return 'Snow';
        case 77: return 'Snow Grains';
        case 80: case 81: case 82: return 'Rain Showers';
        case 85: case 86: return 'Snow Showers';
        case 95: case 96: case 99: return 'Thunderstorm';
        default: return 'Clear';
    }
}

function wmoToWeatherApiCode(wmo) {
    if (wmo === 0) return 1000;
    if (wmo === 1 || wmo === 2) return 1003;
    if (wmo === 3) return 1006;
    if (wmo === 45 || wmo === 48) return 1030;
    if (wmo >= 51 && wmo <= 57) return 1153;
    if (wmo >= 61 && wmo <= 67) return 1189;
    if (wmo >= 71 && wmo <= 77) return 1213;
    if (wmo >= 80 && wmo <= 82) return 1240;
    if (wmo >= 85 && wmo <= 86) return 1255;
    if (wmo >= 95) return 1087;
    return 1000;
}

function fetchJsonAsync(session, url, cancellable = null) {
    return new Promise((resolve, reject) => {
        const message = Soup.Message.new('GET', url);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);

                let statusCode = 0;
                try {
                    statusCode = Number(message.status_code ?? message.get_status());
                } catch (_e) {
                    statusCode = 429;
                }

                if (statusCode !== HTTP_STATUS_OK) {
                    reject(new Error(`HTTP ${statusCode}`));
                    return;
                }
                resolve(JSON.parse(decoder.decode(bytes.get_data())));
            } catch (err) {
                reject(err);
            }
        });
    });
}

export async function fetchOpenMeteoFallback(locationName, context) {
    const { widgetNode } = context;
    if (isActorDestroyed(widgetNode)) return;

    try {
        const cached = GEOCODE_CACHE.get(locationName);
        if (cached) {
            await fetchOpenMeteoWeather(cached, context);
            return;
        }

        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=en&format=json`;
        const geoJson = await fetchCachedJson(geoUrl);

        if (isActorDestroyed(widgetNode) || !geoJson.results || geoJson.results.length === 0) return;
        const { latitude, longitude, name } = geoJson.results[0];
        cacheBounded(GEOCODE_CACHE, GEOCODE_CACHE_LIMIT, locationName, { latitude, longitude, name });

        await fetchOpenMeteoWeather({ latitude, longitude, name }, context);
    } catch (e) {
        if (e instanceof Gio.IOErrorEnum && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
        console.error('Error fetching Open-Meteo fallback:', e);
    }
}

export function clearGeocodeCache() {
    GEOCODE_CACHE.clear();
    WEATHER_CACHE.clear();
    WEATHER_PROMISES.clear();
}

async function fetchOpenMeteoWeather({ latitude, longitude, name }, context) {
    const { widgetNode, uiElements } = context;
    if (isActorDestroyed(widgetNode)) return;

    try {
        const weatherUrl = buildOpenMeteoForecastUrl(latitude, longitude);
        const metric = (context.widgetData?.weatherMetric || '').toLowerCase();
        const needsAqi = (uiElements && uiElements.aqiCard) || metric === 'aqi';

        const requests = [fetchCachedJson(weatherUrl)];
        if (needsAqi) {
            const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi&hourly=us_aqi&timezone=auto`;
            requests.push(fetchCachedJson(aqiUrl).catch(() => null));
        }

        const [wJson, aqiJson] = await Promise.all(requests);

        if (isActorDestroyed(widgetNode) || !wJson.current) return;

        const cur = wJson.current || {};
        const h = wJson.hourly || {};

        let curHourIdx = 0;
        if (h.time && cur.time) {
            const curTimePrefix = cur.time.slice(0, 13);
            const foundIdx = h.time.findIndex(t => t.startsWith(curTimePrefix));
            if (foundIdx !== -1) curHourIdx = foundIdx;
        }

        const currentCode = cur.weather_code ?? (h.weather_code ? h.weather_code[curHourIdx] : 0);
        const mappedCode = wmoToWeatherApiCode(currentCode);
        const conditionText = getWmoConditionText(currentCode);

        const utcOffsetSeconds = wJson.utc_offset_seconds || 0;
        const nowLocationMs = Date.now() + (utcOffsetSeconds * MILLISECONDS_PER_SECOND);
        const nowDate = new Date(nowLocationMs);
        const pad2 = (n) => String(n).padStart(2, '0');
        const nowLocationHourStr =
            `${nowDate.getUTCFullYear()}-${pad2(nowDate.getUTCMonth() + 1)}-${pad2(nowDate.getUTCDate())}` +
            `T${pad2(nowDate.getUTCHours())}`;

        const curTemp = cur.temperature_2m ?? (h.temperature_2m ? h.temperature_2m[curHourIdx] : 0);
        const curIsDay = cur.is_day ?? 1;

        const dailyGroups = new Map();
        if (h.time && h.temperature_2m) {
            h.time.forEach((timeStr, i) => {
                const code = (h.weather_code && h.weather_code[i] !== undefined) ? h.weather_code[i] : currentCode;
                const isDay = (h.is_day && h.is_day[i] !== undefined)
                    ? (h.is_day[i] === 1 || h.is_day[i] === true)
                    : (curIsDay === 1 || curIsDay === true);
                const hourEntry = {
                    time_epoch: Math.floor(new Date(timeStr).getTime() / 1000),
                    time_str: timeStr,
                    temp_c: h.temperature_2m[i],
                    temp_f: celsiusToFahrenheit(h.temperature_2m[i]),
                    is_day: isDay,
                    condition: {
                        code: wmoToWeatherApiCode(code),
                        text: getWmoConditionText(code),
                    },
                };

                const dayKey = timeStr.slice(0, 10);
                if (!dailyGroups.has(dayKey))
                    dailyGroups.set(dayKey, []);
                dailyGroups.get(dayKey).push(hourEntry);
            });
        }

        const forecastday = (wJson.daily && wJson.daily.time) ? wJson.daily.time.map((dayKey, dayIndex) => {
            const dayHigh = wJson.daily.temperature_2m_max[dayIndex] ?? curTemp;
            const dayLow = wJson.daily.temperature_2m_min[dayIndex] ?? curTemp;
            const dailyCode = (wJson.daily.weather_code && wJson.daily.weather_code[dayIndex] !== undefined)
                ? wJson.daily.weather_code[dayIndex]
                : currentCode;

            return {
                date: dayKey,
                day: {
                    maxtemp_c: dayHigh,
                    maxtemp_f: celsiusToFahrenheit(dayHigh),
                    mintemp_c: dayLow,
                    mintemp_f: celsiusToFahrenheit(dayLow),
                    condition: {
                        code: wmoToWeatherApiCode(dailyCode),
                        text: getWmoConditionText(dailyCode),
                    },
                },
                hour: dailyGroups.get(dayKey) || [],
            };
        }) : [];

        const curFeelsLike = cur.apparent_temperature ?? (h.apparent_temperature ? h.apparent_temperature[curHourIdx] : null);
        const curHumidity = cur.relative_humidity_2m ?? (h.relative_humidity_2m ? h.relative_humidity_2m[curHourIdx] : null);
        const curUv = cur.uv_index ?? (h.uv_index ? h.uv_index[curHourIdx] : null);
        const curWind = cur.wind_speed_10m ?? (h.wind_speed_10m ? h.wind_speed_10m[curHourIdx] : null);
        const curPressure = cur.surface_pressure ?? (h.surface_pressure ? h.surface_pressure[curHourIdx] : null);
        const curGusts = cur.wind_gusts_10m ?? (h.wind_gusts_10m ? h.wind_gusts_10m[curHourIdx] : null);
        const curDewPoint = h.dew_point_2m ? h.dew_point_2m[curHourIdx] : null;
        const curCloud = cur.cloud_cover ?? (h.cloud_cover ? h.cloud_cover[curHourIdx] : null);
        const curPrecip = cur.precipitation ?? (h.precipitation ? h.precipitation[curHourIdx] : 0);

        const trendSliceEnd = Math.min(h.time ? h.time.length : 48, curHourIdx + 24);

        const mapped = {
            location: { name },
            current: {
                temp_c: curTemp,
                temp_f: curTemp !== null ? celsiusToFahrenheit(curTemp) : null,
                is_day: curIsDay,
                humidity: curHumidity,
                uv_index: curUv,
                windspeed: curWind,
                pressure: curPressure,
                feels_like_c: curFeelsLike,
                feels_like_f: curFeelsLike !== null ? celsiusToFahrenheit(curFeelsLike) : null,
                gusts: curGusts,
                dew_point_c: curDewPoint,
                dew_point_f: curDewPoint !== null ? celsiusToFahrenheit(curDewPoint) : null,
                cloud: curCloud,
                precipitation: curPrecip,
                aqi: (aqiJson && aqiJson.current) ? Math.round(aqiJson.current.us_aqi) : null,
                last_updated_epoch: Math.floor(nowLocationMs / 1000),
                last_updated_hour: nowLocationHourStr,
                condition: { code: mappedCode, text: conditionText },
            },
            forecast: { forecastday },
            hourly_trends: {
                humidity: h.relative_humidity_2m ? h.relative_humidity_2m.slice(curHourIdx, trendSliceEnd) : [],
                uv: h.uv_index ? h.uv_index.slice(curHourIdx, trendSliceEnd) : [],
                wind: h.wind_speed_10m ? h.wind_speed_10m.slice(curHourIdx, trendSliceEnd) : [],
                aqi: (aqiJson?.hourly?.us_aqi) ? aqiJson.hourly.us_aqi.slice(curHourIdx, trendSliceEnd) : [],
                pressure: h.surface_pressure ? h.surface_pressure.slice(curHourIdx, trendSliceEnd) : [],
                feels_like: h.apparent_temperature ? h.apparent_temperature.slice(curHourIdx, trendSliceEnd) : [],
                gusts: h.wind_gusts_10m ? h.wind_gusts_10m.slice(curHourIdx, trendSliceEnd) : [],
                dew_point: h.dew_point_2m ? h.dew_point_2m.slice(curHourIdx, trendSliceEnd) : [],
                cloud: h.cloud_cover ? h.cloud_cover.slice(curHourIdx, trendSliceEnd) : [],
                precipitation: h.precipitation ? h.precipitation.slice(curHourIdx, trendSliceEnd) : [],
            },
        };

        updateWeatherUi(mapped, context);
    } catch (e) {
        if (e instanceof Gio.IOErrorEnum && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
        console.error('Error fetching Open-Meteo fallback:', e);
    }
}

export function fetchWeatherViaOpenMeteo(context) {
    const { widgetData, widgetNode } = context;
    if (isActorDestroyed(widgetNode)) return;

    const gnomeCity = getGnomeDefaultWeatherCity();
    const location = widgetData.location || widgetData.globalWeatherCity || gnomeCity || FALLBACK_LOCATION;

    fetchOpenMeteoFallback(location, context);
}

export function releaseWeatherSession(_widgetNode) {
    // Megosztott sessiont használunk, így widgetenként nincs mit bontani.
}