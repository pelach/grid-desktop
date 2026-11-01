import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { getWidgets, saveWidgets } from '../utils/widgetUtils.js';
import {
    buildStandardSettings,
    buildRssSettings,
    buildSunScheduleSettings,
    buildWeatherSettings,
    buildTimeSettings,
    buildMusicSettings,
    buildPomodoroSettings,
    buildAppLauncherSettings,
    buildSlideshowSettings,
    buildGifSettings,
    buildImageSettings,
    buildSystemInfoSettings,
    buildCurrencyTrackerSettings,
    buildWeatherCardsSettings,
    buildTimerSettings,     
    buildCountdownSettings,
    buildPingSettings,
    buildCryptoTrackerSettings,
    buildHistoryTrackerSettings,
    buildStorageBarSettings,
    buildWatermindSettings,
    buildLavaLampSettings,
    buildMoonSettings,
    buildDownloadsSettings,
    buildAudioVisualizerSettings,
} from './widgetSettings.js';

export function buildWidgetEditPanel(parentWindow, widget, settings, onSavedCallback) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 8,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });

    // A nyers Gtk.Grid helyett egy Adw.PreferencesGroup fogja össze a beállítási kártyákat
    const group = new Adw.PreferencesGroup();
    box.append(group);

    const saveHandlers = [];

    // Általános beállítások (pozíció, méret, monitor, egyedi színek stb.)
    buildStandardSettings(group, widget, settings, saveHandlers);

    // Widget-specifikus beállítások
    switch (widget.type) {
        case 'rss-headlines':
        case 'rss-feed':
            buildRssSettings(group, widget, saveHandlers);
            break;
        case 'sun-schedule':
            buildSunScheduleSettings(group, widget, saveHandlers);
            break;
        case 'weather':
        case 'weather_bars':
            buildWeatherSettings(group, widget, settings, saveHandlers);
            break;
        case 'weather_cards':
            buildWeatherCardsSettings(group, widget, saveHandlers);
            break;
        case 'time':
            buildTimeSettings(group, widget, settings, saveHandlers);
            break;
        case 'music':
            buildMusicSettings(group, widget, saveHandlers);
            break;
        case 'pomodoro-focus':
            buildPomodoroSettings(group, widget, saveHandlers);
            break;
        case 'app-launcher':
            buildAppLauncherSettings(group, widget, saveHandlers);
            break;
        case 'slideshow':
            buildSlideshowSettings(group, widget, settings, saveHandlers);
            break;
        case 'gif':
            buildGifSettings(group, widget, saveHandlers);
            break;
        case 'image':
            buildImageSettings(group, widget, settings, saveHandlers, parentWindow);
            break;
        case 'system-info':
            buildSystemInfoSettings(group, widget, saveHandlers);
            break;
        case 'currency-tracker':
            buildCurrencyTrackerSettings(group, widget, saveHandlers);
            break;
        case 'timer': 
            buildTimerSettings(group, widget, saveHandlers);
            break;
        case 'countdown': 
            buildCountdownSettings(group, widget, saveHandlers);
            break;
        case 'ping-monitor':
            buildPingSettings(group, widget, saveHandlers);
            break;
        case 'cryptoWidget':
            buildCryptoTrackerSettings(group, widget, saveHandlers);
            break;
        case 'todayHistory':
            buildHistoryTrackerSettings(group, widget, saveHandlers);
            break;
        case 'storage-bar':
        case 'storageBar':
        case 'storage_bar':
            buildStorageBarSettings(group, widget, saveHandlers, parentWindow);
            break;
        case 'watermind':
            buildWatermindSettings(group, widget, saveHandlers);
            break;
        case 'lavaLamp':
            buildLavaLampSettings(group, widget, saveHandlers);
            break;
        case 'moon':
            buildMoonSettings(group, widget, saveHandlers);
            break;
        case 'system-downloads':
        case 'downloads':
            buildDownloadsSettings(group, widget, saveHandlers, parentWindow);
            break;
        case 'audioVisualizer':
            buildAudioVisualizerSettings(group, widget, saveHandlers);
            break;
    }

    const saveRow = new Adw.ActionRow({
        title: 'Apply Settings',
        subtitle: 'Save changes made to this widget',
    });

    const saveButton = new Gtk.Button({
        label: 'Save Changes',
        css_classes: ['suggested-action'],
        valign: Gtk.Align.CENTER,
    });

    saveButton.connect('clicked', () => {
        const target = { ...widget };
        for (const handler of saveHandlers) {
            handler(target);
        }

        const widgets = getWidgets(settings);
        const idx = widgets.findIndex(w => w.id === widget.id);
        if (idx !== -1) {
            widgets[idx] = target;
            saveWidgets(settings, widgets);
        }

        if (onSavedCallback) {
            onSavedCallback(target);
        }
    });

    saveRow.add_suffix(saveButton);
    saveRow.set_activatable_widget(saveButton);
    group.add(saveRow);
    return box;
}