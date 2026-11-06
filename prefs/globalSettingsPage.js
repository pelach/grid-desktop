import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { createSwitchRow } from './aestheticControls.js';
import { createOpenMeteoCitySearch } from './weatherSearch.js';
import { getWidgets, saveWidgets } from '../utils/widgetUtils.js';
import { clearBox, getConnectedMonitorsCount, buildMonitorEntries } from './displayUtils.js';
import { syncDesktopIcons } from '../utils/desktopIcons.js';

export function buildGlobalSettingsPage(settings) {
    const performCitySearch = createOpenMeteoCitySearch();
    const page = new Adw.PreferencesPage({
        title: 'Global Settings',
        icon_name: 'preferences-system-symbolic',
    });

    // 1. MULTI-MONITOR DISPLAY
    const monitorCount = getConnectedMonitorsCount();
    const monitorGroup = new Adw.PreferencesGroup({
        title: 'Multi-Monitor Display',
        description: 'Choose default monitor display mode for widgets.',
    });

    if (monitorCount > 1) {
        const strings = [
            'Primary Monitor',
            'All Monitors (Span Canvas)',
            'All Monitors (Independent Grids)'
        ];
        const monitorValues = ['primary', 'all', 'each'];

        for (const entry of buildMonitorEntries(monitorCount)) {
            strings.push(entry.label);
            monitorValues.push(entry.key);
        }

        const globalMonitorRow = new Adw.ComboRow({
            title: 'Global Target Monitor',
            subtitle: 'Choose which monitor(s) display widgets by default.',
            model: new Gtk.StringList({ strings }),
        });

        const currentGlobalMonitor = settings.get_string('global-monitor') || 'primary';
        const currentIdx = monitorValues.indexOf(currentGlobalMonitor);
        globalMonitorRow.set_selected(currentIdx >= 0 ? currentIdx : 0);

        globalMonitorRow.connect('notify::selected', () => {
            const selectedVal = monitorValues[globalMonitorRow.get_selected()];
            settings.set_string('global-monitor', selectedVal);
        });

        monitorGroup.add(globalMonitorRow);
    } else {
        const singleMonitorRow = new Adw.ActionRow({
            title: 'Global Target Monitor',
            subtitle: 'Single Monitor Detected (No additional monitors connected).',
        });
        monitorGroup.add(singleMonitorRow);
    }
    page.add(monitorGroup);

    // 2. IMAGE SETTINGS
    const imageConfigGroup = new Adw.PreferencesGroup({
        title: 'Image Settings',
        description: 'Configuration for image and GIF widgets.',
    });
    imageConfigGroup.add(createSwitchRow('Animate GIFs', 'Toggle GIF animations on or off.', settings, 'image-animate-gif').row);
    imageConfigGroup.add(createSwitchRow('Show Image Captions', 'Toggle captions for image and GIF widgets.', settings, 'image-show-caption').row);
    imageConfigGroup.add(createSwitchRow('Show Slideshow Captions', 'Toggle captions for slideshow widgets.', settings, 'slideshow-show-caption').row);
    page.add(imageConfigGroup);

    // 3. WEATHER SETTINGS (Adwaita EntryRow + Boxed List)
    const weatherConfigGroup = new Adw.PreferencesGroup({
        title: 'Weather Settings',
        description: 'Configure your default city and appearance.',
    });
    weatherConfigGroup.add(createSwitchRow('Use Fahrenheit (°F)', 'Display temperatures in Fahrenheit instead of Celsius by default.', settings, 'weather-use-fahrenheit').row);
    weatherConfigGroup.add(createSwitchRow('Dynamic Weather Color', 'Change weather widget background color depending on the weather and time of day.', settings, 'weather-dynamic-color').row);
    weatherConfigGroup.add(createSwitchRow('Dynamic Weather Overlay Image', 'Show an overlay image depending on the weather condition.', settings, 'weather-dynamic-image').row);

    const currentCity = settings.get_string('weather-city') || 'None';
    const citySearchRow = new Adw.EntryRow({
        title: `Default City (Current: ${currentCity})`,
        show_apply_button: false,
    });
    weatherConfigGroup.add(citySearchRow);

    const resultsList = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        css_classes: ['boxed-list'],
        margin_top: 6,
    });
    resultsList.set_visible(false);

    const resultsScroller = new Gtk.ScrolledWindow({
        max_content_height: 180,
        min_content_height: 100,
        propagate_natural_height: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    });
    resultsScroller.set_child(resultsList);
    resultsScroller.set_visible(false);
    weatherConfigGroup.add(resultsScroller);

    let suppressSearch = false;
    citySearchRow.connect('notify::text', () => {
        if (suppressSearch) return;

        const query = citySearchRow.get_text().trim();
        if (!query || query.length < 2) {
            clearBox(resultsList);
            resultsList.set_visible(false);
            resultsScroller.set_visible(false);
            return;
        }

        resultsList.set_visible(true);
        resultsScroller.set_visible(true);

        performCitySearch(query, resultsList, (location) => {
            const locationName = location.name;
            settings.set_string('weather-city', locationName);

            // Mentsük el a sémába a koordinátákat is:
            if (location.latitude !== undefined && location.longitude !== undefined) {
                settings.set_double('weather-lat', location.latitude);
                settings.set_double('weather-lon', location.longitude);
            }

            citySearchRow.set_title(`Default City (Current: ${locationName})`);

            suppressSearch = true;
            citySearchRow.set_text('');
            suppressSearch = false;

            const widgets = getWidgets(settings);
            let modified = false;
            for (const widget of widgets) {
                if (widget.type === 'weather' || widget.type === 'weather_bars' || widget.type === 'weather_cards') {
                    widget.location = locationName;
                    if (location.latitude !== undefined && location.longitude !== undefined) {
                        widget.lat = location.latitude;
                        widget.lon = location.longitude;
                    }
                    modified = true;
                }
            }
            if (modified) {
                saveWidgets(settings, widgets);
            }

            clearBox(resultsList);
            resultsList.set_visible(false);
            resultsScroller.set_visible(false);
        });
    });

    page.add(weatherConfigGroup);

    // 4. TIME SETTINGS
    const timeConfigGroup = new Adw.PreferencesGroup({
        title: 'Time Settings',
        description: 'Configuration for time widgets.',
    });
    timeConfigGroup.add(createSwitchRow('24-Hour Format', 'Use 24-hour time format instead of 12-hour.', settings, 'time-format-24h').row);
    page.add(timeConfigGroup);

    // 5. DESKTOP ICONS
    const desktopGroup = new Adw.PreferencesGroup({ 
        title: 'Desktop Icons',
        description: 'Configure desktop icon layout and visibility.',
    });

    const showIconsRow = new Adw.SwitchRow({ title: 'Show Icons' });
    settings.bind('show-desktop-icons', showIconsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showIconsRow);

    const showLabelsRow = new Adw.SwitchRow({ title: 'Icon Labels' });
    settings.bind('desktop-icons-show-labels', showLabelsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showLabelsRow);

    const sideRow = new Adw.ComboRow({
        title: 'Alignment',
        model: new Gtk.StringList({ strings: ['Left side', 'Right side'] }),
        selected: settings.get_enum('desktop-icons-side'),
    });
    sideRow.connect('notify::selected', () => {
        settings.set_enum('desktop-icons-side', sideRow.get_selected());
        syncDesktopIcons(settings, true);
    });
    desktopGroup.add(sideRow);

    const directionRow = new Adw.ComboRow({
        title: 'Sort Order',
        model: new Gtk.StringList({ strings: ['Vertical', 'Horizontal'] }),
        selected: settings.get_enum('desktop-icons-direction'),
    });
    directionRow.connect('notify::selected', () => {
        settings.set_enum('desktop-icons-direction', directionRow.get_selected());
        syncDesktopIcons(settings, true);
    });
    desktopGroup.add(directionRow);

    const showHomeRow = new Adw.SwitchRow({ title: 'Show Home Folder' });
    settings.bind('desktop-icons-show-home', showHomeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showHomeRow);

    const showTrashRow = new Adw.SwitchRow({ title: 'Show Trashcan' });
    settings.bind('desktop-icons-show-trash', showTrashRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showTrashRow);

    const showMountsRow = new Adw.SwitchRow({ title: 'Show Mapped Drives' });
    settings.bind('desktop-icons-show-mounts', showMountsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showMountsRow);

    const showNetworksRow = new Adw.SwitchRow({ title: 'Show Network Locations' });
    settings.bind('desktop-icons-show-networks', showNetworksRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showNetworksRow);

    const organizeRow = new Adw.ActionRow({
        title: 'Auto-Layout',
        subtitle: 'Re-align and organize all desktop icons',
    });
    const organizeButton = new Gtk.Button({
        label: 'Refresh',
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
    });
    organizeButton.connect('clicked', () => {
        const currentSide = settings.get_enum('desktop-icons-side');
        const tempSide = currentSide === 0 ? 1 : 0;
        settings.set_enum('desktop-icons-side', tempSide);
        settings.set_enum('desktop-icons-side', currentSide);
    });
    organizeRow.add_suffix(organizeButton);
    desktopGroup.add(organizeRow);

    page.add(desktopGroup);

    return page;
}