import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
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
} from './widgetAdders.js';
import { createAppSelectionControls } from './appSelection.js';
import { createLiveCitySearchRow, buildOpenMeteoCitySearchRow } from './citySearch.js';
import { buildCaptionRows } from './captionControls.js';
import { DEFAULT_WORLD_CLOCK_CITIES, MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC, DEFAULT_SLIDESHOW_INTERVAL_SEC } from './widgetConstants.js';

export { DEFAULT_WORLD_CLOCK_CITIES, MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC, DEFAULT_SLIDESHOW_INTERVAL_SEC } from './widgetConstants.js';

const DIALOG_CONTENT_MARGIN_PX = 15;
const DIALOG_CONTENT_SPACING_PX = 10;
const DIALOG_GRID_SPACING_PX = 12;

function createBaseWidgetAddDialog(parentWindow, title) {
    const dialog = new Gtk.Dialog({
        title,
        transient_for: parentWindow,
        modal: true,
        use_header_bar: 1
    });

    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.add_button('Add Widget', Gtk.ResponseType.OK);

    const content = dialog.get_content_area();
    content.set_margin_top(DIALOG_CONTENT_MARGIN_PX);
    content.set_margin_bottom(DIALOG_CONTENT_MARGIN_PX);
    content.set_margin_start(DIALOG_CONTENT_MARGIN_PX);
    content.set_margin_end(DIALOG_CONTENT_MARGIN_PX);
    content.set_spacing(DIALOG_CONTENT_SPACING_PX);

    const grid = new Gtk.Grid({
        column_spacing: DIALOG_GRID_SPACING_PX,
        row_spacing: DIALOG_GRID_SPACING_PX
    });
    content.append(grid);

    return { dialog, grid };
}

export function openAddAppLauncherDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure App Launcher Widget');
    dialog.set_default_size(560, 560);

    const appSelection = createAppSelectionControls(grid, 0);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const selectedApps = appSelection.getSelectedApps();
            if (selectedApps.length > 0) {
                addAppLauncherWidget(settings, selectedApps);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddImageDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Image Widget');

    const imagePathLabel = new Gtk.Label({ label: 'Image File:', xalign: 0 });
    const imagePathEntry = new Gtk.Entry({ placeholder_text: 'Select image file...', hexpand: true });
    const imageBrowseBtn = new Gtk.Button({ label: 'Browse...' });

    imageBrowseBtn.connect('clicked', () => {
        openImageFileDialog(parentWindow, (selectedPath) => {
            if (selectedPath) {
                imagePathEntry.set_text(selectedPath);
            }
        });
    });

    const imagePathBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    imagePathBox.append(imagePathEntry);
    imagePathBox.append(imageBrowseBtn);

    grid.attach(imagePathLabel, 0, 0, 1, 1);
    grid.attach(imagePathBox, 1, 0, 1, 1);

    const { captionEntry, showCaptionSwitch } = buildCaptionRows(grid, 1, 'My Image');

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const imagePath = imagePathEntry.get_text().trim();
            if (imagePath) {
                addImageWidget(settings, imagePath, captionEntry.get_text().trim(), showCaptionSwitch.get_active(), 4, 3);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddSlideshowDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Slideshow Widget');

    const folderLabel = new Gtk.Label({ label: 'Image Folder:', xalign: 0 });
    const folderEntry = new Gtk.Entry({ placeholder_text: 'Select folder...', hexpand: true });
    const folderBrowseBtn = new Gtk.Button({ label: 'Browse...' });

    folderBrowseBtn.connect('clicked', () => {
        openFolderFileDialog(parentWindow, (selectedPath) => {
            if (selectedPath) {
                folderEntry.set_text(selectedPath);
            }
        });
    });

    const folderBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    folderBox.append(folderEntry);
    folderBox.append(folderBrowseBtn);

    grid.attach(folderLabel, 0, 0, 1, 1);
    grid.attach(folderBox, 1, 0, 1, 1);

    const intervalLabel = new Gtk.Label({ label: 'Interval (seconds):', xalign: 0 });
    const intervalSpin = Gtk.SpinButton.new_with_range(MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC);
    intervalSpin.set_value(DEFAULT_SLIDESHOW_INTERVAL_SEC);
    grid.attach(intervalLabel, 0, 1, 1, 1);
    grid.attach(intervalSpin, 1, 1, 1, 1);

    const { captionEntry, showCaptionSwitch } = buildCaptionRows(grid, 2, 'My Slideshow');

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const folderPath = folderEntry.get_text().trim();
            if (folderPath) {
                addSlideshowWidget(settings, folderPath, intervalSpin.get_value_as_int(), 4, 3, captionEntry.get_text().trim(), showCaptionSwitch.get_active());
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddWorldClockDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure World Clock Widget');

    const [primaryDefault, sec1Default, sec2Default] = DEFAULT_WORLD_CLOCK_CITIES;
    const primaryPicker = createLiveCitySearchRow(grid, 'Primary City (Top):', primaryDefault, 0);
    const sec1Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Left):', sec1Default, 1);
    const sec2Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Right):', sec2Default, 2);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const primaryCity = primaryPicker.getSelectedCity();
            const sec1City = sec1Picker.getSelectedCity();
            const sec2City = sec2Picker.getSelectedCity();
            addTimeWidget(settings, 4, 4, 'world', [primaryCity, sec1City, sec2City]);
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddGithubDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure GitHub Activity Widget');

    const userLabel = new Gtk.Label({ label: 'GitHub Username:', xalign: 0 });
    const userEntry = new Gtk.Entry({ placeholder_text: 'e.g. pelach', hexpand: true });
    grid.attach(userLabel, 0, 0, 1, 1);
    grid.attach(userEntry, 1, 0, 1, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const username = userEntry.get_text().trim().replace(/^@/, '');
            if (username) {
                addGithubWidget(settings, username);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

function openAddRssUrlDialog(parentWindow, settings, title, hintText, addWidget) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, title);

    const urlLabel = new Gtk.Label({ label: 'Feed URL:', xalign: 0 });
    const urlEntry = new Gtk.Entry({
        placeholder_text: 'https://example.com/feed.xml',
        hexpand: true,
        input_purpose: Gtk.InputPurpose.URL,
    });
    grid.attach(urlLabel, 0, 0, 1, 1);
    grid.attach(urlEntry, 1, 0, 1, 1);

    const hintLabel = new Gtk.Label({
        label: hintText,
        xalign: 0,
        hexpand: true,
        css_classes: ['dim-label'],
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        max_width_chars: 44,
    });
    grid.attach(hintLabel, 0, 1, 2, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            addWidget(settings, urlEntry.get_text().trim());
        }
        dialogWindow.destroy();
    });

    dialog.present();
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

export function openAddSunScheduleDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Solar Schedule Widget');

    const locationPicker = buildOpenMeteoCitySearchRow(grid, 'City Location:', null, 0);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const location = locationPicker.getSelectedLocation();
            if (location && location.name && location.latitude !== undefined && location.longitude !== undefined) {
                addSunScheduleWidget(settings, location.name, location.latitude, location.longitude);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddCountdownDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Countdown Widget');

    // Esemény neve
    const nameLabel = new Gtk.Label({ label: 'Event Name:', xalign: 0 });
    const nameEntry = new Gtk.Entry({ placeholder_text: 'e.g. Vacation, Project Launch', hexpand: true });
    grid.attach(nameLabel, 0, 0, 1, 1);
    grid.attach(nameEntry, 1, 0, 1, 1);

    // Céldátum beviteli mező (vagy Gtk.Calendar)
    const dateLabel = new Gtk.Label({ label: 'Target Date (YYYY-MM-DD):', xalign: 0 });
    const now = new Date();
    // Default: mai nap + 7 nap
    const defaultDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dateEntry = new Gtk.Entry({ text: defaultDate, placeholder_text: 'YYYY-MM-DD', hexpand: true });
    grid.attach(dateLabel, 0, 1, 1, 1);
    grid.attach(dateEntry, 1, 1, 1, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const eventName = nameEntry.get_text().trim() || 'My Event';
            const targetDate = dateEntry.get_text().trim();
            if (targetDate) {
                // Átadjuk az addCountdownWidget-nek a paramétereket
                addCountdownWidget(settings, eventName, `${targetDate}T00:00:00`, 4, 4);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}


export function openAddWorldAnalogDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure World Analog Clock Widget');

    // Alapértelmezett 4 város tartalékkal (ha a DEFAULT_WORLD_CLOCK_CITIES csak 3 elemű lenne)
    const [c1Default, c2Default, c3Default, c4Default] = DEFAULT_WORLD_CLOCK_CITIES || [];
    const city1 = c1Default || { name: 'Toronto', timezone: 'America/Toronto', country: 'CA' };
    const city2 = c2Default || { name: 'Vancouver', timezone: 'America/Vancouver', country: 'CA' };
    const city3 = c3Default || { name: 'Calgary', timezone: 'America/Edmonton', country: 'CA' };
    const city4 = c4Default || { name: 'Winnipeg', timezone: 'America/Winnipeg', country: 'CA' };

    const picker1 = createLiveCitySearchRow(grid, 'City 1 (Top Left):', city1, 0);
    const picker2 = createLiveCitySearchRow(grid, 'City 2 (Top Right):', city2, 1);
    const picker3 = createLiveCitySearchRow(grid, 'City 3 (Bottom Left):', city3, 2);
    const picker4 = createLiveCitySearchRow(grid, 'City 4 (Bottom Right):', city4, 3);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const cities = [
                picker1.getSelectedCity(),
                picker2.getSelectedCity(),
                picker3.getSelectedCity(),
                picker4.getSelectedCity(),
            ];

            // A konkrét analóg hozzáadó függvényt hívjuk a 'worldAnalog' típus létrehozásához
            if (typeof addWorldAnalogWidget === 'function') {
                addWorldAnalogWidget(settings, 4, 4, cities);
            } else {
                // Tartalék, ha közvetlenül addWidgettel mentenéd:
                addTimeWidget(settings, 4, 4, 'worldAnalog', cities);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}