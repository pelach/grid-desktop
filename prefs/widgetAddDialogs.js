import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { openImageFileDialog, openFolderFileDialog } from './fileDialogs.js';
import {
    addImageWidget,
    addSlideshowWidget,
    addTimeWidget,
    addGithubWidget,
    addRssHeadlinesWidget,
    addSunScheduleWidget,
    addAppLauncherWidget,
    addCountdownWidget,
    addWorldAnalogWidget,
    addMoonWidget,
    addWatermindWidget,
    addCommandRunnerWidget,
    addSteamRecentWidget,
    addDualClockWidget,
    addWebRadioWidget,
} from './widgetAdders.js';
import { createAppSelectionControls } from './appSelection.js';
import { createLiveCitySearchRow, buildOpenMeteoCitySearchRow } from './citySearch.js';
import { DEFAULT_WORLD_CLOCK_CITIES, MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC, DEFAULT_SLIDESHOW_INTERVAL_SEC } from './widgetConstants.js';


export { DEFAULT_WORLD_CLOCK_CITIES, MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC, DEFAULT_SLIDESHOW_INTERVAL_SEC } from './widgetConstants.js';


function getGlobalDefaultLocation(settings) {
    return {
        name: settings.get_string('weather-city') || 'Nyíregyháza',
        latitude: settings.get_double('weather-lat') || 47.955,
        longitude: settings.get_double('weather-lon') || 21.716,
    };
}

function createModernWidgetAddDialog(parentWindow, title, onConfirm) {
    const window = new Adw.Window({
        title,
        transient_for: parentWindow,
        modal: true,
        default_width: 460,
        default_height: 320,
    });

    const toolbarView = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar();

    const cancelBtn = new Gtk.Button({ label: 'Cancel' });
    cancelBtn.connect('clicked', () => window.close());
    headerBar.pack_start(cancelBtn);

    const addBtn = new Gtk.Button({
        label: 'Add Widget',
        css_classes: ['suggested-action'],
    });
    headerBar.pack_end(addBtn);

    toolbarView.add_top_bar(headerBar);

    const clamp = new Adw.Clamp({
        maximum_size: 520,
        margin_top: 16,
        margin_bottom: 16,
        margin_start: 16,
        margin_end: 16,
    });

    const group = new Adw.PreferencesGroup();
    clamp.set_child(group);

    const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        propagate_natural_height: true,
    });
    scrolled.set_child(clamp);
    toolbarView.set_content(scrolled);

    window.set_content(toolbarView);

    addBtn.connect('clicked', () => {
        if (onConfirm) {
            const success = onConfirm();
            if (success !== false) {
                window.close();
            }
        } else {
            window.close();
        }
    });

    return { window, group, addBtn };
}

export function openAddCountdownDialog(parentWindow, settings) {
    let nameRow, dateRow;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Countdown Widget', () => {
        const eventName = nameRow.get_text().trim() || 'My Event';
        const targetDate = dateRow.get_text().trim();
        if (targetDate) {
            addCountdownWidget(settings, eventName, `${targetDate}T00:00:00`, 4, 4);
            return true;
        }
        return false;
    });

    nameRow = new Adw.EntryRow({
        title: 'Event Name',
        text: '',
    });

    const now = new Date();
    const defaultDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    dateRow = new Adw.EntryRow({
        title: 'Target Date (YYYY-MM-DD)',
        text: defaultDate,
    });

    group.add(nameRow);
    group.add(dateRow);

    window.present();
}

export function openAddGithubDialog(parentWindow, settings) {
    let userRow;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure GitHub Activity Widget', () => {
        const username = userRow.get_text().trim().replace(/^@/, '');
        if (username) {
            addGithubWidget(settings, username);
            return true;
        }
        return false;
    });

    userRow = new Adw.EntryRow({
        title: 'GitHub Username',
        text: '',
    });

    group.add(userRow);
    window.present();
}

export function openAddImageDialog(parentWindow, settings) {
    let imageRow, captionRow, showCaptionRow;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Image Widget', () => {
        const imagePath = imageRow.get_text().trim();
        if (imagePath) {
            addImageWidget(settings, imagePath, captionRow.get_text().trim(), showCaptionRow.get_active(), 4, 4);
            return true;
        }
        return false;
    });

    imageRow = new Adw.EntryRow({
        title: 'Image File',
    });

    const browseBtn = new Gtk.Button({
        icon_name: 'document-open-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    browseBtn.connect('clicked', () => {
        openImageFileDialog(window, (selectedPath) => {
            if (selectedPath) {
                imageRow.set_text(selectedPath);
            }
        });
    });
    imageRow.add_suffix(browseBtn);

    captionRow = new Adw.EntryRow({
        title: 'Caption',
        text: 'My Image',
    });

    showCaptionRow = new Adw.SwitchRow({
        title: 'Show Caption',
        active: true,
    });

    group.add(imageRow);
    group.add(captionRow);
    group.add(showCaptionRow);

    window.present();
}

export function openAddSlideshowDialog(parentWindow, settings) {
    let folderRow, intervalRow, transitionRow, captionRow, showCaptionRow;

    const transitionKeys = ['crossfade', 'slide_horizontal', 'slide_vertical', 'zoom_in'];
    const transitionLabels = [
        'Crossfade (Default)',
        'Slide Horizontal',
        'Slide Vertical',
        'Zoom In',
    ];

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Slideshow Widget', () => {
        const folderPath = folderRow.get_text().trim();
        if (folderPath) {
            const selectedTransition = transitionKeys[transitionRow.get_selected()] || 'crossfade';
            addSlideshowWidget(
                settings,
                folderPath,
                Math.round(intervalRow.get_value()),
                4, 4,
                captionRow.get_text().trim(),
                showCaptionRow.get_active(),
                selectedTransition
            );
            return true;
        }
        return false;
    });

    folderRow = new Adw.EntryRow({
        title: 'Image Folder',
    });

    const browseBtn = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    browseBtn.connect('clicked', () => {
        openFolderFileDialog(window, (selectedPath) => {
            if (selectedPath) {
                folderRow.set_text(selectedPath);
            }
        });
    });
    folderRow.add_suffix(browseBtn);

    intervalRow = new Adw.SpinRow({
        title: 'Interval (seconds)',
        adjustment: new Gtk.Adjustment({
            lower: MIN_SLIDESHOW_INTERVAL_SEC,
            upper: MAX_SLIDESHOW_INTERVAL_SEC,
            step_increment: STEP_SLIDESHOW_INTERVAL_SEC,
            page_increment: STEP_SLIDESHOW_INTERVAL_SEC * 2,
            value: DEFAULT_SLIDESHOW_INTERVAL_SEC,
        }),
    });

    transitionRow = new Adw.ComboRow({
        title: 'Transition Effect',
        model: new Gtk.StringList({ strings: transitionLabels }),
    });
    transitionRow.set_selected(0);

    captionRow = new Adw.EntryRow({
        title: 'Caption',
        text: 'My Slideshow',
    });

    showCaptionRow = new Adw.SwitchRow({
        title: 'Show Caption',
        active: true,
    });

    group.add(folderRow);
    group.add(intervalRow);
    group.add(transitionRow);
    group.add(captionRow);
    group.add(showCaptionRow);

    window.present();
}

export function openAddWatermindDialog(parentWindow, settings) {
    let targetRow, intervalRow, b1Row, b2Row, b3Row;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Watermind Widget', () => {
        addWatermindWidget(
            settings,
            Math.round(targetRow.get_value()),
            Math.round(intervalRow.get_value()),
            Math.round(b1Row.get_value()),
            Math.round(b2Row.get_value()),
            Math.round(b3Row.get_value()),
            4, 4
        );
        return true;
    });

    targetRow = new Adw.SpinRow({
        title: 'Hourly Target (ml/hour)',
        adjustment: new Gtk.Adjustment({ lower: 50, upper: 1000, step_increment: 25, value: 250 }),
    });

    intervalRow = new Adw.SpinRow({
        title: 'Reminder Interval (Minutes)',
        adjustment: new Gtk.Adjustment({ lower: 15, upper: 180, step_increment: 5, value: 60 }),
    });

    b1Row = new Adw.SpinRow({
        title: 'Quick Button 1 (ml)',
        adjustment: new Gtk.Adjustment({ lower: 50, upper: 1000, step_increment: 25, value: 200 }),
    });

    b2Row = new Adw.SpinRow({
        title: 'Quick Button 2 (ml)',
        adjustment: new Gtk.Adjustment({ lower: 50, upper: 1000, step_increment: 25, value: 500 }),
    });

    b3Row = new Adw.SpinRow({
        title: 'Quick Button 3 (ml)',
        adjustment: new Gtk.Adjustment({ lower: 50, upper: 1000, step_increment: 25, value: 750 }),
    });

    group.add(targetRow);
    group.add(intervalRow);
    group.add(b1Row);
    group.add(b2Row);
    group.add(b3Row);

    window.present();
}

function openAddRssUrlDialog(parentWindow, settings, title, hintText, addWidget) {
    let urlRow;

    const { window, group } = createModernWidgetAddDialog(parentWindow, title, () => {
        const url = urlRow.get_text().trim();
        if (url) {
            addWidget(settings, url);
            return true;
        }
        return false;
    });

    urlRow = new Adw.EntryRow({
        title: 'Feed URL',
    });

    group.add(urlRow);

    if (hintText) {
        const hintLabel = new Gtk.Label({
            label: hintText,
            xalign: 0,
            css_classes: ['dim-label'],
            wrap: true,
            margin_top: 8,
        });
        group.add(hintLabel);
    }

    window.present();
}

export function openAddRssHeadlinesDialog(parentWindow, settings) {
    openAddRssUrlDialog(
        parentWindow,
        settings,
        'Configure RSS Headlines Widget',
        'Tip: the card auto-rotates through recent article headlines.',
        addRssHeadlinesWidget
    );
}

export function openAddAppLauncherDialog(parentWindow, settings) {
    let appSelection = null;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure App Launcher Widget', () => {
        if (appSelection) {
            const selectedApps = appSelection.getSelectedApps();
            addAppLauncherWidget(settings, selectedApps);
            return true;
        }
        return false;
    });

    window.set_default_size(560, 580);

    const containerBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    appSelection = createAppSelectionControls(containerBox, 0);
    group.add(containerBox);

    window.present();
}

export function openAddWorldClockDialog(parentWindow, settings) {
    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure World Clock Widget', () => {
        const primaryCity = primaryPicker.getSelectedCity();
        const sec1City = sec1Picker.getSelectedCity();
        const sec2City = sec2Picker.getSelectedCity();
        addTimeWidget(settings, 4, 4, 'world', [primaryCity, sec1City, sec2City]);
        return true;
    });

    const [primaryDefault, sec1Default, sec2Default] = DEFAULT_WORLD_CLOCK_CITIES;
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
    const primaryPicker = createLiveCitySearchRow(box, 'Primary City (Top):', primaryDefault, 0);
    const sec1Picker = createLiveCitySearchRow(box, 'Secondary City (Bottom Left):', sec1Default, 1);
    const sec2Picker = createLiveCitySearchRow(box, 'Secondary City (Bottom Right):', sec2Default, 2);

    group.add(box);
    window.present();
}

export function openAddSunScheduleDialog(parentWindow, settings) {
    let locationPicker;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Solar Schedule Widget', () => {
        const location = locationPicker.getSelectedLocation();
        if (location && location.name && location.latitude !== undefined && location.longitude !== undefined) {
            addSunScheduleWidget(settings, location.name, location.latitude, location.longitude);
            return true;
        }
        return false;
    });

    const defaultLoc = getGlobalDefaultLocation(settings);

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
    locationPicker = buildOpenMeteoCitySearchRow(box, 'City Location:', defaultLoc, 0);

    group.add(box);
    window.present();
}

export function openAddWorldAnalogDialog(parentWindow, settings) {
    let picker1, picker2, picker3, picker4;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure World Analog Clock Widget', () => {
        const cities = [
            picker1.getSelectedCity(),
            picker2.getSelectedCity(),
            picker3.getSelectedCity(),
            picker4.getSelectedCity(),
        ];

        if (typeof addWorldAnalogWidget === 'function') {
            addWorldAnalogWidget(settings, 4, 4, cities);
        } else {
            addTimeWidget(settings, 4, 4, 'worldAnalog', cities);
        }
        return true;
    });

    const [c1Default, c2Default, c3Default, c4Default] = DEFAULT_WORLD_CLOCK_CITIES || [];
    const city1 = c1Default || { name: 'Toronto', timezone: 'America/Toronto', country: 'CA' };
    const city2 = c2Default || { name: 'Vancouver', timezone: 'America/Vancouver', country: 'CA' };
    const city3 = c3Default || { name: 'Calgary', timezone: 'America/Edmonton', country: 'CA' };
    const city4 = c4Default || { name: 'Winnipeg', timezone: 'America/Winnipeg', country: 'CA' };

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
    picker1 = createLiveCitySearchRow(box, 'City 1 (Top Left):', city1, 0);
    picker2 = createLiveCitySearchRow(box, 'City 2 (Top Right):', city2, 1);
    picker3 = createLiveCitySearchRow(box, 'City 3 (Bottom Left):', city3, 2);
    picker4 = createLiveCitySearchRow(box, 'City 4 (Bottom Right):', city4, 3);

    group.add(box);
    window.present();
}


export function openAddMoonDialog(parentWindow, settings) {
    let locationPicker;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Moon Widget', () => {
        const location = locationPicker.getSelectedLocation();
        if (location && location.name && location.latitude !== undefined && location.longitude !== undefined) {
            addMoonWidget(settings, location.name, location.latitude, location.longitude);
            return true;
        }
        return false;
    });

    const defaultLoc = getGlobalDefaultLocation(settings);

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
    locationPicker = buildOpenMeteoCitySearchRow(box, 'City Location:', defaultLoc, 0);

    group.add(box);
    window.present();
}

export function openAddCommandRunnerDialog(parentWindow, settings) {
    let titleRow;
    let items = [
        { id: 'cmd_1', label: 'Drop Caches', command: 'sync && echo 3 | sudo tee /proc/sys/vm/drop_caches', inTerminal: false },
        { id: 'cmd_2', label: 'SSH Server', command: 'ssh user@192.168.1.50', inTerminal: true },
    ];

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Command Runner Widget', () => {
        const title = titleRow.get_text().trim() || 'Command Runner';
        const validCommands = items.filter(it => it.label || it.command);
        addCommandRunnerWidget(settings, title, validCommands, 8, 4);
        return true;
    });

    window.set_default_size(520, 560);

    titleRow = new Adw.EntryRow({
        title: 'Widget Title',
        text: 'Command Runner',
    });
    group.add(titleRow);

    const cmdSectionGroup = new Adw.PreferencesGroup({
        title: 'Commands & Actions',
        description: 'Add commands to run in the background or launch in a terminal.',
    });
    group.add(cmdSectionGroup);

    const listContainer = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        margin_top: 6,
        margin_bottom: 6,
    });
    cmdSectionGroup.add(listContainer);

    const rebuildListUI = () => {
        let child = listContainer.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            listContainer.remove(child);
            child = next;
        }

        items.forEach((item, index) => {
            const cardBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 6,
                css_classes: ['card'],
                margin_start: 2,
                margin_end: 2,
            });

            const headerRow = new Adw.ActionRow({
                title: `Action #${index + 1}`,
            });

            const termSwitch = new Gtk.Switch({
                active: item.inTerminal === true,
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Open in Terminal (for SSH or interactive commands)',
            });
            termSwitch.connect('notify::active', () => {
                item.inTerminal = termSwitch.get_active();
            });

            const termBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER,
            });
            termBox.append(new Gtk.Label({ label: 'Terminal:', css_classes: ['dim-label'] }));
            termBox.append(termSwitch);

            const deleteBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'destructive-action'],
                tooltip_text: 'Remove Action',
            });
            deleteBtn.connect('clicked', () => {
                items.splice(index, 1);
                rebuildListUI();
            });

            headerRow.add_suffix(termBox);
            headerRow.add_suffix(deleteBtn);
            cardBox.append(headerRow);

            const labelEntry = new Adw.EntryRow({
                title: 'Button Label',
                text: item.label || '',
            });
            labelEntry.connect('changed', () => {
                item.label = labelEntry.get_text().trim();
            });
            cardBox.append(labelEntry);

            const commandEntry = new Adw.EntryRow({
                title: 'Bash Command',
                text: item.command || '',
            });
            commandEntry.connect('changed', () => {
                item.command = commandEntry.get_text().trim();
            });
            cardBox.append(commandEntry);

            listContainer.append(cardBox);
        });
    };

    rebuildListUI();

    const addActionRow = new Adw.ActionRow();
    const addBtn = new Gtk.Button({
        label: '+ Add Action',
        css_classes: ['suggested-action'],
        halign: Gtk.Align.CENTER,
        hexpand: true,
        margin_top: 6,
    });
    addBtn.connect('clicked', () => {
        items.push({
            id: `cmd_${Date.now()}`,
            label: 'New Action',
            command: 'echo "Done"',
            inTerminal: false,
        });
        rebuildListUI();
    });

    addActionRow.set_child(addBtn);
    cmdSectionGroup.add(addActionRow);

    window.present();
}

export function openAddSteamRecentDialog(parentWindow, settings) {
    let idRow;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Steam Recent Widget', () => {
        const steamId = idRow.get_text().trim();
        if (steamId) {
            addSteamRecentWidget(settings, steamId, 4, 2);
            return true;
        }
        return false;
    });

    idRow = new Adw.EntryRow({
        title: 'Steam ID or Vanity Name',
        text: '',
    });

    const hintLabel = new Gtk.Label({
        label: 'Enter your 64-bit Steam ID (e.g. 76561198...) or custom profile URL name. Note: Your profile and game details must be set to Public.',
        xalign: 0,
        css_classes: ['dim-label'],
        wrap: true,
        margin_top: 8,
    });

    group.add(idRow);
    group.add(hintLabel);

    window.present();
}

export function openAddDualClockDialog(parentWindow, settings) {
    let cityPicker;

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure City Clock Widget', () => {
        const city = cityPicker.getSelectedCity();
        if (city && city.timezone) {
            addDualClockWidget(settings, [city], 4, 2); // <-- addDualClockWidget hívása!
            return true;
        }
        return false;
    });

    const defaultCity = { name: 'Pensacola', timezone: 'America/Chicago', country: 'US', admin1: 'Florida' };
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
    cityPicker = createLiveCitySearchRow(box, 'Target City / Timezone:', defaultCity, 0);

    group.add(box);
    window.present();
}


export function openAddWebRadioDialog(parentWindow, settings) {
    let stations = [
        { name: 'Retro Rádió', url: 'https://icast.connectmedia.hu/5001/live.mp3' },
        { name: 'Rádió 1', url: 'https://icast.connectmedia.hu/5201/live.mp3' },
        { name: 'Petőfi Rádió', url: 'https://icast.connectmedia.hu/4738/mr2.mp3' },
        { name: 'Kossuth Rádió', url: 'http://mr-stream.mediaconnect.hu/4736/mr1.mp3' },
        { name: 'Smooth Jazz', url: 'https://smoothjazz.cdnstream1.com/2585_128.mp3' },
        { name: 'Klasszik Rádió', url: 'http://online.klasszikradio.hu/klasszik.mp3' },
    ];

    const { window, group } = createModernWidgetAddDialog(parentWindow, 'Configure Web Radio Widget', () => {
        const valid = stations.filter(s => s.name.trim() && s.url.trim());
        addWebRadioWidget(settings, 4, 2, valid.length > 0 ? valid : null);
        return true;
    });

    window.set_default_size(520, 560);

    const stationsGroup = new Adw.PreferencesGroup({
        title: 'Radio Stations',
        description: 'Edit names and stream URLs, or add new channels.',
    });
    group.add(stationsGroup);

    const listContainer = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        margin_top: 6,
        margin_bottom: 6,
    });
    stationsGroup.add(listContainer);

    const rebuildUI = () => {
        let child = listContainer.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            listContainer.remove(child);
            child = next;
        }

        stations.forEach((st, idx) => {
            const cardBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 6,
                css_classes: ['card'],
                margin_start: 2,
                margin_end: 2,
            });

            const headerRow = new Adw.ActionRow({
                title: `Station #${idx + 1}`,
            });

            const deleteBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'destructive-action'],
                tooltip_text: 'Remove Station',
            });
            deleteBtn.connect('clicked', () => {
                stations.splice(idx, 1);
                rebuildUI();
            });

            headerRow.add_suffix(deleteBtn);
            cardBox.append(headerRow);

            const nameEntry = new Adw.EntryRow({
                title: 'Station Name',
                text: st.name || '',
            });
            nameEntry.connect('changed', () => {
                st.name = nameEntry.get_text().trim();
            });
            cardBox.append(nameEntry);

            const urlEntry = new Adw.EntryRow({
                title: 'Stream URL (mp3/aac/ogg)',
                text: st.url || '',
            });
            urlEntry.connect('changed', () => {
                st.url = urlEntry.get_text().trim();
            });
            cardBox.append(urlEntry);

            listContainer.append(cardBox);
        });
    };

    rebuildUI();

    const addActionRow = new Adw.ActionRow();
    const addBtn = new Gtk.Button({
        label: '+ Add Station',
        css_classes: ['suggested-action'],
        halign: Gtk.Align.CENTER,
        hexpand: true,
        margin_top: 6,
    });
    addBtn.connect('clicked', () => {
        stations.push({
            name: 'New Station',
            url: 'https://',
        });
        rebuildUI();
    });

    addActionRow.set_child(addBtn);
    stationsGroup.add(addActionRow);

    window.present();
}