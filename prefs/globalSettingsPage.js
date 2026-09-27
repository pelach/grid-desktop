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

    const themeGroup = new Adw.PreferencesGroup({
        title: 'Theme',
        description: 'Widget color behavior.',
    });
    themeGroup.add(createSwitchRow(
        'Follow System Theme',
        'Use Adwaita light/dark colors based on the GNOME color scheme instead of the custom colors below.',
        settings,
        'follow-system-theme'
    ).row);
    page.add(themeGroup);

    const imageConfigGroup = new Adw.PreferencesGroup({
        title: 'Image Settings',
        description: 'Configuration for image and GIF widgets.',
    });
    imageConfigGroup.add(createSwitchRow('Animate GIFs', 'Toggle GIF animations on or off.', settings, 'image-animate-gif').row);
    imageConfigGroup.add(createSwitchRow('Show Image Captions', 'Toggle captions for image and GIF widgets.', settings, 'image-show-caption').row);
    imageConfigGroup.add(createSwitchRow('Show Slideshow Captions', 'Toggle captions for slideshow widgets.', settings, 'slideshow-show-caption').row);
    page.add(imageConfigGroup);

    const weatherConfigGroup = new Adw.PreferencesGroup({
        title: 'Weather Settings',
        description: 'Configure your default city and appearance.',
    });
    weatherConfigGroup.add(createSwitchRow('Use Fahrenheit (°F)', 'Display temperatures in Fahrenheit instead of Celsius by default.', settings, 'weather-use-fahrenheit').row);
    weatherConfigGroup.add(createSwitchRow('Dynamic Weather Color', 'Change weather widget background color depending on the weather and time of day.', settings, 'weather-dynamic-color').row);
    weatherConfigGroup.add(createSwitchRow('Dynamic Weather Overlay Image', 'Show an overlay image depending on the weather condition.', settings, 'weather-dynamic-image').row);

    const searchRow = new Adw.ActionRow({
        title: 'Default City',
        subtitle: `Current: ${settings.get_string('weather-city')}`,
    });

    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: 'Search city and press Enter...',
        width_request: 240,
        valign: Gtk.Align.CENTER,
    });
    searchRow.add_suffix(searchEntry);

    const resultsList = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.SINGLE,
        css_classes: ['boxed-list']
    });
    resultsList.set_margin_top(10);
    resultsList.set_margin_bottom(10);
    resultsList.set_visible(false);

    weatherConfigGroup.add(searchRow);
    weatherConfigGroup.add(resultsList);

    searchEntry.connect('activate', () => {
        const query = searchEntry.get_text();
        performCitySearch(query, resultsList, (location) => {
            const locationName = location.name;
            settings.set_string('weather-city', locationName);
            searchRow.set_subtitle(`Current: ${locationName}`);
            searchEntry.set_text('');

            const widgets = getWidgets(settings);
            let modified = false;
            for (const widget of widgets) {
                if (widget.type === 'weather') {
                    widget.location = locationName;
                    modified = true;
                }
            }
            if (modified) {
                saveWidgets(settings, widgets);
            }

            clearBox(resultsList);
            resultsList.set_visible(false);
        });
    });

    page.add(weatherConfigGroup);

    const timeConfigGroup = new Adw.PreferencesGroup({
        title: 'Time Settings',
        description: 'Configuration for time widgets.',
    });
    timeConfigGroup.add(createSwitchRow('24-Hour Format', 'Use 24-hour time format instead of 12-hour.', settings, 'time-format-24h').row);
    
    page.add(timeConfigGroup);
    

    const desktopGroup = new Adw.PreferencesGroup({ title: 'Desktop icons' });

    const showIconsRow = new Adw.SwitchRow({ title: 'Show icons' });
    settings.bind('show-desktop-icons', showIconsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showIconsRow);

    const showLabelsRow = new Adw.SwitchRow({ title: 'Icon labels' });
    settings.bind('desktop-icons-show-labels', showLabelsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showLabelsRow);

    // IGAZÍTÁS OLDALA (0: left, 1: right)
    const sideRow = new Adw.ComboRow({
        title: 'Alignment',
        model: new Gtk.StringList({ strings: ['Left side', 'Right side'] }),
        selected: settings.get_enum('desktop-icons-side'),
    });
    sideRow.connect('notify::selected', () => {
        const val = sideRow.get_selected();
        settings.set_enum('desktop-icons-side', val);
        syncDesktopIcons(settings, true); // Azonnal rendezzen is
    });
    desktopGroup.add(sideRow);

    // RENDEZÉS IRÁNYA (0: vertical, 1: horizontal)
    const directionRow = new Adw.ComboRow({
        title: 'Sort order',
        model: new Gtk.StringList({ strings: ['Vertical', 'Horizontal'] }),
        selected: settings.get_enum('desktop-icons-direction'),
    });
    directionRow.connect('notify::selected', () => {
        const val = directionRow.get_selected();
        settings.set_enum('desktop-icons-direction', val);
        syncDesktopIcons(settings, true); // Azonnal rendezzen is
    });
    desktopGroup.add(directionRow);

    const showHomeRow = new Adw.SwitchRow({ title: 'Show home folder' });
    settings.bind('desktop-icons-show-home', showHomeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showHomeRow);

    const showTrashRow = new Adw.SwitchRow({ title: 'Show traschan' });
    settings.bind('desktop-icons-show-trash', showTrashRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showTrashRow);

    const showMountsRow = new Adw.SwitchRow({ title: 'Show mapped drives and network locations' });
    settings.bind('desktop-icons-show-mounts', showMountsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.add(showMountsRow);

    // RENDRAKÁS GOMB
    const organizeButton = new Gtk.Button({
        label: 'Refresh (Auto-Layout)',
        margin_top: 12,
        css_classes: ['suggested-action'],
    });
    organizeButton.connect('clicked', () => {
        const currentSide = settings.get_enum('desktop-icons-side');
        const tempSide = currentSide === 0 ? 1 : 0;
        
        settings.set_enum('desktop-icons-side', tempSide);
        settings.set_enum('desktop-icons-side', currentSide);
    });
    desktopGroup.add(organizeButton);

    page.add(desktopGroup);

    return page;
}
