import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import { createOpenMeteoCitySearch } from './weatherSearch.js';
import { clearBox } from './displayUtils.js';


const MIN_QUERY_LENGTH = 2;
const MAX_SCROLLED_WINDOW_HEIGHT_PX = 180;


function buildCitySearchScaffold(container, labelTitle, placeholderText) {
    // Ha a container már egy Adw.PreferencesGroup, ne hozzunk létre újabb csoportot!
    const isAlreadyGroup = container instanceof Adw.PreferencesGroup;
    const targetGroup = isAlreadyGroup 
        ? container 
        : new Adw.PreferencesGroup({ title: labelTitle });

    const searchEntryRow = new Adw.EntryRow({
        title: placeholderText,
        show_apply_button: false,
    });
    targetGroup.add(searchEntryRow);

    const statusLabel = new Gtk.Label({
        xalign: 0,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        css_classes: ['dim-label'],
        margin_top: 4,
        margin_start: 6,
    });

    const resultsListBox = new Gtk.ListBox({
        css_classes: ['boxed-list'],
        selection_mode: Gtk.SelectionMode.NONE,
        margin_top: 6,
    });

    const scrolledWindow = new Gtk.ScrolledWindow({
        max_content_height: MAX_SCROLLED_WINDOW_HEIGHT_PX,
        min_content_height: 100,
        propagate_natural_height: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    });
    scrolledWindow.set_child(resultsListBox);
    scrolledWindow.set_visible(false);

    targetGroup.add(scrolledWindow);

    // Csak akkor fűzzük hozzá a szülőhöz a targetGroup-ot, ha újonnan hoztuk létre:
    if (!isAlreadyGroup) {
        if (typeof container.add === 'function') {
            container.add(targetGroup);
        } else if (typeof container.append === 'function') {
            container.append(targetGroup);
        }
    }

    return { searchEntryRow, statusLabel, resultsListBox, scrolledWindow };
}

export function createLiveCitySearchRow(container, labelTitle, defaultCity) {
    const performCitySearch = createOpenMeteoCitySearch();
    const placeholderText = defaultCity && defaultCity.name
        ? `Search (Current: ${defaultCity.name})`
        : 'Search city (e.g. London, Tokyo)...';

    const { searchEntryRow, statusLabel, resultsListBox, scrolledWindow } =
        buildCitySearchScaffold(container, labelTitle, placeholderText);

    let selectedCityObj = { ...defaultCity };
    let isInternalUpdate = false;

    const updateStatusLabel = (isSelected = false) => {
        if (!selectedCityObj || !selectedCityObj.name) {
            statusLabel.set_text('');
            return;
        }
        const escapedName = GLib.markup_escape_text(selectedCityObj.name, -1);
        const escapedDisplay = GLib.markup_escape_text(selectedCityObj.country || selectedCityObj.timezone || '', -1);
        if (isSelected) {
            statusLabel.set_markup(`<span size='small' weight='bold'>Selected: ${escapedName} (${escapedDisplay})</span>`);
        } else {
            statusLabel.set_markup(`<span size='small'>Current: <b>${escapedName}</b> (${escapedDisplay})</span>`);
        }
    };
    updateStatusLabel(false);

    const selectCity = (loc) => {
        selectedCityObj = { 
            name: loc.name, 
            latitude: loc.latitude,
            longitude: loc.longitude,
            timezone: loc.timezone || resolveTimezoneForCity(loc), 
            country: loc.country || '' 
        };
        updateStatusLabel(true);
        isInternalUpdate = true;
        searchEntryRow.set_text(loc.name);
        isInternalUpdate = false;
        clearBox(resultsListBox);
        scrolledWindow.set_visible(false);
    };

    let debounceTimerId = 0;
    searchEntryRow.connect('notify::text', () => {
        if (isInternalUpdate) return;

        const query = searchEntryRow.get_text().trim();
        if (!query || query.length < MIN_QUERY_LENGTH) {
            clearBox(resultsListBox);
            scrolledWindow.set_visible(false);
            return;
        }

        // 250ms késleltetés gépelés közben, hogy ne terhelje feleslegesen az API-t
        if (debounceTimerId) {
            GLib.Source.remove(debounceTimerId);
        }
        debounceTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            debounceTimerId = 0;
            scrolledWindow.set_visible(true);
            performCitySearch(query, resultsListBox, selectCity);
            return GLib.SOURCE_REMOVE;
        });
    });

    return { getSelectedCity: () => selectedCityObj };
}

export function buildOpenMeteoCitySearchRow(container, labelTitle, defaultLocation) {
    const performCitySearch = createOpenMeteoCitySearch();
    const placeholderText = defaultLocation && defaultLocation.name
        ? `Search (Current: ${defaultLocation.name})`
        : 'Search city (e.g. London, Tokyo)...';

    const { searchEntryRow, statusLabel, resultsListBox, scrolledWindow } =
        buildCitySearchScaffold(container, labelTitle, placeholderText);

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
            `<span size='small' weight='bold'>Selected: ${GLib.markup_escape_text(selectedLocation.name, -1)}${GLib.markup_escape_text(coordText, -1)}</span>`
        );
    };
    updateStatusLabel();

    const selectLocation = (loc) => {
        selectedLocation = { name: loc.name, latitude: loc.latitude, longitude: loc.longitude };
        updateStatusLabel();
        suppressNextSearch = true;
        searchEntryRow.set_text(loc.name);
        suppressNextSearch = false;
        clearBox(resultsListBox);
        scrolledWindow.set_visible(false);
    };

    searchEntryRow.connect('notify::text', () => {
        if (suppressNextSearch) return;
        const query = searchEntryRow.get_text().trim();
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
    const lng = parseFloat(cityItem.longitude ?? cityItem.lng ?? 0);

    if (country === 'US' || country === 'CA') {
        if (lng < -114) return country === 'CA' ? 'America/Vancouver' : 'America/Los_Angeles';
        if (lng < -102) return country === 'CA' ? 'America/Edmonton' : 'America/Denver';
        if (lng < -85)  return country === 'CA' ? 'America/Winnipeg' : 'America/Chicago';
        return country === 'CA' ? 'America/Toronto' : 'America/New_York';
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

    const roughOffsetHours = Math.round(lng / 15);
    if (roughOffsetHours === 0) return 'UTC';
    return roughOffsetHours > 0 ? `Etc/GMT-${roughOffsetHours}` : `Etc/GMT+${Math.abs(roughOffsetHours)}`;
}