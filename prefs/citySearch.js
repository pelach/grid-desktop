import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { createOpenMeteoCitySearch } from './weatherSearch.js';
import { clearBox } from './displayUtils.js';

const REMOTE_CITIES_DATABASE_URL = 'https://raw.githubusercontent.com/lutangar/cities.json/master/cities.json';
const MIN_QUERY_LENGTH = 2;
const MAX_SEARCH_RESULTS_COUNT = 15;
const MAX_SCROLLED_WINDOW_HEIGHT_PX = 160;

let cachedCitiesDatabase = null;
let citiesRemoteFetchInFlight = null;

function getCitiesDatabase() {
    if (cachedCitiesDatabase && cachedCitiesDatabase.length > 0) return Promise.resolve(cachedCitiesDatabase);
    return fetchRemoteCitiesDatabase();
}

function fetchRemoteCitiesDatabase() {
    if (citiesRemoteFetchInFlight) return citiesRemoteFetchInFlight;

    citiesRemoteFetchInFlight = new Promise((resolve) => {
        const session = new Soup.Session();
        const message = Soup.Message.new('GET', REMOTE_CITIES_DATABASE_URL);

        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try {
                if (message.get_status() !== 200) {
                    console.error(`Gridgets: Remote cities database fetch failed with HTTP ${message.get_status()}`);
                    resolve([]);
                    return;
                }
                const bytes = s.send_and_read_finish(res);
                const jsonText = new TextDecoder('utf-8').decode(bytes.get_data());
                const data = JSON.parse(jsonText);
                if (Array.isArray(data) && data.length > 0) {
                    cachedCitiesDatabase = data;
                    resolve(data);
                    return;
                }
                console.error('Gridgets: Remote cities database was empty');
                resolve([]);
            } catch (err) {
                console.error(`Gridgets: Failed parsing remote cities database: ${err.message}`);
                resolve([]);
            }
        });
    });

    citiesRemoteFetchInFlight.finally(() => {
        citiesRemoteFetchInFlight = null;
    });
    return citiesRemoteFetchInFlight;
}


function buildCitySearchScaffold(grid, labelTitle, placeholderText, rowIdx) {
    const label = new Gtk.Label({ label: labelTitle, xalign: 0, valign: Gtk.Align.START, margin_top: 8 });
    const vBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, hexpand: true, valign: Gtk.Align.START });

    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: placeholderText,
        hexpand: true
    });

    const statusLabel = new Gtk.Label({ xalign: 0, wrap: true,
        wrap_mode: Pango.WrapMode.WORD, max_width_chars: 36 });

    const resultsListBox = new Gtk.ListBox({
        css_classes: ['boxed-list'],
        selection_mode: Gtk.SelectionMode.NONE
    });

    const scrolledWindow = new Gtk.ScrolledWindow({
        max_content_height: MAX_SCROLLED_WINDOW_HEIGHT_PX,
        min_content_height: 120,
        propagate_natural_height: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC
    });
    scrolledWindow.set_child(resultsListBox);
    scrolledWindow.set_visible(false);

    vBox.append(searchEntry);
    vBox.append(statusLabel);
    vBox.append(scrolledWindow);

    grid.attach(label, 0, rowIdx, 1, 1);
    grid.attach(vBox, 1, rowIdx, 1, 1);

    return { searchEntry, statusLabel, resultsListBox, scrolledWindow };
}

export function createLiveCitySearchRow(grid, labelTitle, defaultCity, rowIdx) {
    const placeholderText = defaultCity && defaultCity.name
        ? `e.g. ${defaultCity.name} (${defaultCity.timezone || ''})`
        : 'Search city (e.g. London, Tokyo)...';

    const { searchEntry, statusLabel, resultsListBox, scrolledWindow } =
        buildCitySearchScaffold(grid, labelTitle, placeholderText, rowIdx);

    let selectedCityObj = { ...defaultCity };
    let lastSelectedCityName = null;
    let isInternalUpdate = false;

    const updateStatusLabel = (isSelected = false) => {
        if (!selectedCityObj || !selectedCityObj.name) {
            statusLabel.set_text('');
            return;
        }
        const escapedName = GLib.markup_escape_text(selectedCityObj.name, -1);
        const escapedDisplay = GLib.markup_escape_text(selectedCityObj.country || selectedCityObj.timezone || '', -1);
        if (isSelected) {
            statusLabel.set_markup(`<span size='x-small' weight='bold'>Selected: ${escapedName} (${escapedDisplay})</span>`);
        } else {
            statusLabel.set_markup(`<span size='x-small' alpha='60%'>Default: <b>${escapedName}</b> (${escapedDisplay})</span>`);
        }
    };
    updateStatusLabel(false);

    const selectCity = (cityItem) => {
        const resolvedTz = resolveTimezoneForCity(cityItem);
        selectedCityObj = { 
            name: cityItem.name, 
            timezone: resolvedTz, 
            country: cityItem.country || '' 
        };
        lastSelectedCityName = cityItem.name;
        updateStatusLabel(true);
        isInternalUpdate = true;
        searchEntry.set_text(cityItem.name);
        isInternalUpdate = false;
        clearBox(resultsListBox);
        scrolledWindow.set_visible(false);
    };

    resultsListBox.connect('row-activated', (_box, row) => {
        if (row && row._cityItem) {
            selectCity(row._cityItem);
        }
    });

    let searchRequestSequence = 0;
    const filterAndRenderCities = async () => {
        if (isInternalUpdate) return;
        const requestId = ++searchRequestSequence;
        const rawQuery = searchEntry.get_text().trim();
        const query = rawQuery.toLowerCase();
        clearBox(resultsListBox);

        if (lastSelectedCityName) {
            if (rawQuery === lastSelectedCityName) {
                scrolledWindow.set_visible(false);
                return;
            } else {
                lastSelectedCityName = null;
            }
        }

        if (!query || query.length < MIN_QUERY_LENGTH) {
            scrolledWindow.set_visible(false);
            if (!query) {
                selectedCityObj = { ...defaultCity };
                updateStatusLabel(false);
            }
            return;
        }

        if (!cachedCitiesDatabase) {
            statusLabel.set_markup(`<span size='x-small' alpha='70%'>Loading city database...</span>`);
            scrolledWindow.set_visible(false);
        }

        const cities = await getCitiesDatabase();
        if (requestId !== searchRequestSequence) return;
        const rawMatches = [];
        const normalizedQuery = query.replace(/[\s_]+/g, '').toLowerCase();

        for (let i = 0; i < cities.length; i++) {
            const item = cities[i];
            if (item.name && item.name.toLowerCase().replace(/[\s_]+/g, '').includes(normalizedQuery)) {
                rawMatches.push(item);
            }
        }

        rawMatches.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const matches = rawMatches.slice(0, MAX_SEARCH_RESULTS_COUNT);

        if (matches.length > 0) {
            for (const item of matches) {
                const row = new Gtk.ListBoxRow({ selectable: false, activatable: true });
                row._cityItem = item;

                const rowBox = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 12,
                    margin_top: 6,
                    margin_bottom: 6,
                    margin_start: 10,
                    margin_end: 10
                });

                const nameLabel = new Gtk.Label({
                    label: `${item.name} (${item.country || ''})`,
                    xalign: 0,
                    hexpand: true
                });

                rowBox.append(nameLabel);
                row.set_child(rowBox);

                const gesture = new Gtk.GestureClick();
                gesture.connect('pressed', () => selectCity(item));
                row.add_controller(gesture);

                resultsListBox.append(row);
            }
            scrolledWindow.set_visible(true);
        } else {
            statusLabel.set_markup(`<span size='x-small' alpha='70%'>No matching city found for "<b>${GLib.markup_escape_text(searchEntry.get_text().trim(), -1)}</b>"</span>`);
            scrolledWindow.set_visible(false);
        }
    };

    searchEntry.connect('search-changed', () => filterAndRenderCities());
    searchEntry.connect('activate', () => filterAndRenderCities());

    return { getSelectedCity: () => selectedCityObj };
}

export function buildOpenMeteoCitySearchRow(grid, labelTitle, defaultLocation, rowIdx) {
    const performCitySearch = createOpenMeteoCitySearch();
    const placeholderText = defaultLocation && defaultLocation.name
        ? `e.g. ${defaultLocation.name}`
        : 'Search city (e.g. London, Tokyo)...';

    const { searchEntry, statusLabel, resultsListBox, scrolledWindow } =
        buildCitySearchScaffold(grid, labelTitle, placeholderText, rowIdx);

    let selectedLocation = defaultLocation ? { ...defaultLocation } : null;
    let suppressNextSearch = false;

    const updateStatusLabel = () => {
        if (!selectedLocation || !selectedLocation.name) {
            statusLabel.set_text('');
            return;
        }
        const hasCoords = selectedLocation.latitude !== undefined && selectedLocation.longitude !== undefined;
        const coordText = hasCoords
            ? ` (${Number(selectedLocation.latitude).toFixed(2)}, ${Number(selectedLocation.longitude).toFixed(2)})`
            : '';
        statusLabel.set_markup(
            `<span size='x-small' weight='bold'>Selected: ${GLib.markup_escape_text(selectedLocation.name, -1)}${GLib.markup_escape_text(coordText, -1)}</span>`
        );
    };
    updateStatusLabel();

    const selectLocation = (loc) => {
        selectedLocation = { name: loc.name, latitude: loc.latitude, longitude: loc.longitude };
        updateStatusLabel();
        suppressNextSearch = true;
        searchEntry.set_text(loc.name);
        suppressNextSearch = false;
        clearBox(resultsListBox);
        scrolledWindow.set_visible(false);
    };

    searchEntry.connect('search-changed', () => {
        if (suppressNextSearch) return;
        const query = searchEntry.get_text().trim();
        if (!query || query.length < 2) {
            clearBox(resultsListBox);
            scrolledWindow.set_visible(false);
            return;
        }
        scrolledWindow.set_visible(true);
        performCitySearch(query, resultsListBox, selectLocation);
    });

    return { getSelectedLocation: () => selectedLocation };
}

function resolveTimezoneForCity(cityItem) {
    if (cityItem.timezone && cityItem.timezone.trim() !== '') {
        return cityItem.timezone;
    }

    const country = (cityItem.country || '').toUpperCase();
    const lng = parseFloat(cityItem.lng || 0);

    // 1. Több időzónás nagy országok koordináta (hosszúsági fok) alapján
    if (country === 'US' || country === 'CA') {
        if (lng < -114) return country === 'CA' ? 'America/Vancouver' : 'America/Los_Angeles'; // Csendes-óceáni
        if (lng < -102) return country === 'CA' ? 'America/Edmonton' : 'America/Denver';       // Hegyvidéki
        if (lng < -85)  return country === 'CA' ? 'America/Winnipeg' : 'America/Chicago';      // Központi
        return country === 'CA' ? 'America/Toronto' : 'America/New_York';                      // Keleti
    }

    if (country === 'RU') {
        if (lng < 40) return 'Europe/Moscow';
        if (lng < 55) return 'Europe/Samara';
        if (lng < 70) return 'Asia/Yekaterinburg';
        if (lng < 85) return 'Asia/Omsk';
        if (lng < 100) return 'Asia/Krasnoyarsk';
        if (lng < 115) return 'Asia/Irkutsk';
        if (lng < 130) return 'Asia/Yakutsk';
        return 'Asia/Vladivostok';
    }

    if (country === 'AU') {
        if (lng < 129) return 'Australia/Perth';
        if (lng < 138) return 'Australia/Adelaide';
        return 'Australia/Sydney';
    }

    if (country === 'BR') {
        if (lng < -54) return 'America/Manaus';
        return 'America/Sao_Paulo';
    }

    // 2. Főbb egy-időzónás országok IANA zónái
    const COUNTRY_TIMEZONES = {
        'HU': 'Europe/Budapest',
        'AE': 'Asia/Dubai',
        'GB': 'Europe/London',
        'UK': 'Europe/London',
        'FR': 'Europe/Paris',
        'DE': 'Europe/Berlin',
        'IT': 'Europe/Rome',
        'ES': 'Europe/Madrid',
        'NL': 'Europe/Amsterdam',
        'BE': 'Europe/Brussels',
        'AT': 'Europe/Vienna',
        'CH': 'Europe/Zurich',
        'PL': 'Europe/Warsaw',
        'CZ': 'Europe/Prague',
        'SK': 'Europe/Bratislava',
        'RO': 'Europe/Bucharest',
        'RS': 'Europe/Belgrade',
        'HR': 'Europe/Zagreb',
        'GR': 'Europe/Athens',
        'TR': 'Europe/Istanbul',
        'UA': 'Europe/Kyiv',
        'JP': 'Asia/Tokyo',
        'CN': 'Asia/Shanghai',
        'HK': 'Asia/Hong_Kong',
        'SG': 'Asia/Singapore',
        'KR': 'Asia/Seoul',
        'IN': 'Asia/Kolkata',
        'TH': 'Asia/Bangkok',
        'QA': 'Asia/Qatar',
        'SA': 'Asia/Riyadh',
        'IL': 'Asia/Jerusalem',
        'EG': 'Africa/Cairo',
        'ZA': 'Africa/Johannesburg',
        'NZ': 'Pacific/Auckland',
        'MX': 'America/Mexico_City',
        'AR': 'America/Argentina/Buenos_Aires',
    };

    if (COUNTRY_TIMEZONES[country]) {
        return COUNTRY_TIMEZONES[country];
    }

    // 3. Fallback: Hosszúsági fok szerinti UTC eltolás közelítés
    const roughOffsetHours = Math.round(lng / 15);
    if (roughOffsetHours === 0) return 'UTC';
    return roughOffsetHours > 0 ? `Etc/GMT-${roughOffsetHours}` : `Etc/GMT+${Math.abs(roughOffsetHours)}`;
}