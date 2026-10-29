import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

// ── Widget Adders (kategóriák szerint rendezve) ─────────────────────────
import {
    // Weather
    addWeatherWidget,
    addWeatherBarsWidget,
    addWeatherCardsWidget,

    // Media
    addMusicWidget,
    addLyricsWidget,

    // System Monitor
    addAudioOutputWidget,
    addBatteryStatusWidget,
    addBluetoothDevicesWidget,
    addControlsSlidersWidget,
    addCpuRamWidget,
    addNetworkSpeedWidget,
    addPingWidget,
    addPowerProfilesWidget,
    addPowerTogglesWidget,
    addQuickTogglesWidget,
    addResourceWheelWidget,
    addStorageBarWidget,
    addSystemDashboardWidget,
    addSystemInfoWidget,
    addDownloadsWidget,
    addUptimeWidget,
    addUpdatesWidget,
    addHardwerInfoWidget,   

    // Focus & Productivity
    addClipboardWidget,
    addMailGoaWidget,
    addNotesWidget,
    addPomodoroFocusWidget,
    addPomodoroWidget,
    addTodoWidget,

    // Time & Calendar
    addAnalogClockWidget,
    addBinaryWidget,
    addCalendarGridWidget,
    addCalendarWidget,
    addStopWatchWidget,
    addTimeWidget,
    addTimerWidget,

    // Personal
    addCalendarTasksWidget,
    addCryptoWidget,
    addCurrencyTrackerWidget,
    addHabitTrackerWidget,
    addLavaLampWidget,
    addMoodWidget,
    addQuotesWidget,
    addScreenTimeWidget,
    addTodayHistoryWidget
} from './widgetAdders.js';

// ── Widget Dialogs (kategóriák szerint rendezve) ────────────────────────
import {
    // Weather
    openAddMoonDialog,
    openAddSunScheduleDialog,

    // Media
    openAddImageDialog,
    openAddSlideshowDialog,

    // Focus & Productivity
    openAddAppLauncherDialog,

    // Time & Calendar
    openAddCountdownDialog,
    openAddWorldAnalogDialog,
    openAddWorldClockDialog,

    // Personal
    openAddGithubDialog,
    openAddRssHeadlinesDialog,
    openAddWatermindDialog
} from './widgetAddDialogs.js';

import { STORE_CATEGORIES, STORE_WIDGETS } from './widgetCatalog.js';

const THUMBNAIL_WIDTH = 120;
const THUMBNAIL_HEIGHT = 80;

function escapeMarkup(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildRowPrefix(extensionPath, thumbnail, fallbackIconName) {
    const box = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        margin_end: 12,
    });
    // Kőkemény fix méret a konténernek:
    box.set_size_request(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

    if (thumbnail) {
        // Gtk.Picture HELYETT Gtk.Image fix fájlbetöltéssel:
        const img = Gtk.Image.new_from_file(`${extensionPath}/assets/thumbnails/${thumbnail}`);
        img.set_pixel_size(THUMBNAIL_HEIGHT); // Fix méret, soha, semmilyen körülmények között nem tud megnőni!
        img.set_halign(Gtk.Align.CENTER);
        img.set_valign(Gtk.Align.CENTER);
        box.append(img);
    } else {
        const icon = new Gtk.Image({
            icon_name: fallbackIconName || 'application-x-executable-symbolic',
            pixel_size: 40,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        box.append(icon);
    }

    return box;
}

function createWidgetRow(extensionPath, entry, onAddClick) {
    const row = new Adw.ActionRow({
        title: escapeMarkup(entry.title),
        subtitle: escapeMarkup(entry.description || ''),
        subtitle_lines: 2,
    });

    row._searchText = `${entry.title || ''} ${entry.description || ''}`.toLowerCase();

    // 1. Prefix: Fix 84x44-es előnézet
    row.add_prefix(buildRowPrefix(extensionPath, entry.thumbnail, entry.fallbackIconName));

    // 2. Suffix: Rácsméret badge (pl. 4x4, 8x4)
    if (entry.gridSize) {
        const sizeBadge = new Gtk.Label({
            label: entry.gridSize,
            css_classes: ['dim-label', 'caption'],
            valign: Gtk.Align.CENTER,
            margin_end: 8,
        });
        row.add_suffix(sizeBadge);
    }

    // 3. Suffix: Add gomb (pill NÉLKÜL, natív Adwaita stílusban, mint a Refresh és Save Changes!)
    const addButton = new Gtk.Button({
        label: 'Add',
        css_classes: ['suggested-action'], // Nincs 'pill', pontosan illik az ablak többi gombjához!
        valign: Gtk.Align.CENTER,
        margin_end: 4,
    });
    addButton.connect('clicked', onAddClick);
    row.add_suffix(addButton);

    row.set_activatable_widget(addButton);

    return row;
}

export function buildStorePage(window, settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Store',
        icon_name: 'software-update-available-symbolic',
    });

    const addWeather = (width, height, layout) => {
        addWeatherWidget(settings, settings.get_string('weather-city'), width, height, layout);
    };

    // ── Keresőmező fejléc ─────────────────────────────────────────────
    const searchGroup = new Adw.PreferencesGroup();
    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: 'Search widgets...',
        hexpand: true,
        margin_bottom: 8,
    });
    searchGroup.add(searchEntry);
    page.add(searchGroup);

    const noResultsLabel = new Gtk.Label({
        label: 'No widgets found',
        css_classes: ['dim-label', 'title-3'],
        margin_top: 24,
        margin_bottom: 24,
        halign: Gtk.Align.CENTER,
        visible: false,
    });
    searchGroup.add(noResultsLabel);

    const def = (entry, onAdd) => createWidgetRow(extensionPath, entry, onAdd);

    // ── Kategóriák ────────────────────────────────────────────────────
    const categoryConfigs = [
        {
            title: 'Weather',
            items: [
                def(STORE_WIDGETS[STORE_CATEGORIES.weather[0]], () => addWeather(3, 3, 'standard')),
                def(STORE_WIDGETS[STORE_CATEGORIES.weather[1]], () => addWeather(3, 3, 'simple')),
                def(STORE_WIDGETS[STORE_CATEGORIES.weather[2]], () => addWeather(6, 4, 'forecast')),
                def(STORE_WIDGETS.weatherBars, () => addWeatherBarsWidget(settings, settings.get_string('weather-city'), 6, 6)),
                def(STORE_WIDGETS.weatherCards, () => addWeatherCardsWidget(settings, settings.get_string('weather-city'), 3, 3)),
                def(STORE_WIDGETS.sunScheduleWidget, () => openAddSunScheduleDialog(window, settings)),
                def(STORE_WIDGETS.moonWidget, () => openAddMoonDialog(window, settings)),
            ]
        },
        {
            title: 'Media',
            items: [
                def(STORE_WIDGETS[STORE_CATEGORIES.music[0]], () => addMusicWidget(settings, 4, 4)),
                def(STORE_WIDGETS[STORE_CATEGORIES.music[1]], () => addMusicWidget(settings, 8, 4)),
                def(STORE_WIDGETS.lyricsWidget, () => addLyricsWidget(settings, 6, 4)),
                def(STORE_WIDGETS[STORE_CATEGORIES.media[0]], () => openAddImageDialog(window, settings)),
                def(STORE_WIDGETS[STORE_CATEGORIES.media[1]], () => openAddSlideshowDialog(window, settings)),
            ]
        },
        {
            title: 'System Monitor',
            items: [
                // Fő műszerfal és erőforrások
                def(STORE_WIDGETS.systemDashboard, () => addSystemDashboardWidget(settings, 4, 4)),
                def(STORE_WIDGETS.hardwerinfo, () => addHardwerInfoWidget(settings)),
                def(STORE_WIDGETS.systemMonitor, () => addCpuRamWidget(settings, 4, 2)),
                def(STORE_WIDGETS.systemInfo, () => addSystemInfoWidget(settings, 'cpu', 2, 2)),
                def(STORE_WIDGETS.resourceWheel, () => addResourceWheelWidget(settings, 'cpu', 5, 4)),
                def(STORE_WIDGETS.uptime, () => addUptimeWidget(settings)),
                def(STORE_WIDGETS.updates, () => addUpdatesWidget(settings)),
                def(STORE_WIDGETS.storageBar, () => addStorageBarWidget(settings)),
                def(STORE_WIDGETS.batteryStatus, () => addBatteryStatusWidget(settings, 4, 3)),

                // Hálózat
                def(STORE_WIDGETS.networkSpeed, () => addNetworkSpeedWidget(settings, 3, 2)),
                def(STORE_WIDGETS.pingMonitor, () => addPingWidget(settings)),

                // Hardver- és gyorskapcsolók
                def(STORE_WIDGETS.quickToggles, () => addQuickTogglesWidget(settings)),
                def(STORE_WIDGETS.powerToggles, () => addPowerTogglesWidget(settings)),
                def(STORE_WIDGETS.powerProfiles, () => addPowerProfilesWidget(settings)),
                def(STORE_WIDGETS.controlsSliders, () => addControlsSlidersWidget(settings)),
                def(STORE_WIDGETS.audioOutput, () => addAudioOutputWidget(settings)),
                def(STORE_WIDGETS.bluetoothDevices, () => addBluetoothDevicesWidget(settings)),
                
                // Fájlgyorselérés
                def(STORE_WIDGETS.downloads, () => addDownloadsWidget(settings)),
            ]
        },
        {
            title: 'Focus & Productivity',
            items: [
                def(STORE_WIDGETS.pomodoroTimer, () => addPomodoroWidget(settings, 4, 4)),
                def(STORE_WIDGETS.pomodoroFocus, () => addPomodoroFocusWidget(settings, 4, 2)),
                def(STORE_WIDGETS.todoWidget, () => addTodoWidget(settings)),
                def(STORE_WIDGETS.quickNotes, () => addNotesWidget(settings, 4, 4)),
                def(STORE_WIDGETS.clipboardHistory, () => addClipboardWidget(settings, 4, 4)),
                def(STORE_WIDGETS.appLauncher, () => openAddAppLauncherDialog(window, settings)),
                def(STORE_WIDGETS.mailGoa, () => addMailGoaWidget(settings)),
            ]
        },
        {
            title: 'Time & Calendar',
            items: [
                // Órák
                def(STORE_WIDGETS[STORE_CATEGORIES.time[0]], () => addTimeWidget(settings, 3, 2, 'digital')),
                def(STORE_WIDGETS.analogClock, () => addAnalogClockWidget(settings, 'basic', 3, 3)),
                def(STORE_WIDGETS.worldClock, () => openAddWorldClockDialog(window, settings)),
                def(STORE_WIDGETS.worldAnalog, () => openAddWorldAnalogDialog(window, settings)),
                def(STORE_WIDGETS.binary, () => addBinaryWidget(settings)),

                // Időzítők
                def(STORE_WIDGETS.stopwatch, () => addStopWatchWidget(settings)),
                def(STORE_WIDGETS.timer, () => addTimerWidget(settings)),
                def(STORE_WIDGETS.countdown, () => openAddCountdownDialog(window, settings)),

                // Naptárak
                def(STORE_WIDGETS.calendarWidget, () => addCalendarWidget(settings)),
                def(STORE_WIDGETS.calendarGrid, () => addCalendarGridWidget(settings)),
            ]
        },
        {
            title: 'Personal',
            items: [
                def(STORE_WIDGETS.todayHistory, () => addTodayHistoryWidget(settings)),
                def(STORE_WIDGETS.quotesWidget, () => addQuotesWidget(settings)),
                def(STORE_WIDGETS.rssHeadlinesWidget, () => openAddRssHeadlinesDialog(window, settings)),
                def(STORE_WIDGETS.calendarTasks, () => addCalendarTasksWidget(settings)),
                def(STORE_WIDGETS.habitTracker, () => addHabitTrackerWidget(settings)),
                def(STORE_WIDGETS.moodWidget, () => addMoodWidget(settings)),
                def(STORE_WIDGETS.watermind, () => openAddWatermindDialog(window, settings)),
                def(STORE_WIDGETS.screenTimeWidget, () => addScreenTimeWidget(settings)),
                def(STORE_WIDGETS.currencyTracker, () => addCurrencyTrackerWidget(settings)),
                def(STORE_WIDGETS.cryptoWidget, () => addCryptoWidget(settings)),
                def(STORE_WIDGETS.githubWidget, () => openAddGithubDialog(window, settings)),
                def(STORE_WIDGETS.lavaLamp, () => addLavaLampWidget(settings)),
            ]
        }
    ];

    const categoryGroups = [];

    categoryConfigs.forEach(cat => {
        const group = new Adw.PreferencesGroup({ title: escapeMarkup(cat.title) });
        cat.items.forEach(row => {
            group.add(row);
        });
        page.add(group);
        categoryGroups.push({ group, items: cat.items });
    });

    // ── Keresési eseménykezelő ───────────────────────────────────────
    searchEntry.connect('search-changed', (entry) => {
        const query = entry.get_text().trim().toLowerCase();
        let totalVisible = 0;

        categoryGroups.forEach(({ group, items }) => {
            let visibleInGroup = 0;

            items.forEach(row => {
                const matches = query.length < 2 || (row._searchText && row._searchText.includes(query));
                row.set_visible(matches);
                if (matches) visibleInGroup++;
            });

            group.set_visible(visibleInGroup > 0);
            totalVisible += visibleInGroup;
        });

        noResultsLabel.set_visible(query.length >= 2 && totalVisible === 0);
    });

    return page;
}