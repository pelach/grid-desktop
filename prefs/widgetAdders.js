import {
    addWidget,
    nextWidgetId,
    normalizeAppLauncherApps,
    WIDE_MUSIC_LAYOUT_ASPECT_RATIO,
} from '../utils/widgetUtils.js';

export const DEFAULT_RSS_REFRESH_MINUTES = 15;

export function addTimeWidget(settings, width = 4, height = 3, layout = 'digital', cities = null, skin = null) {
    const config = { id: nextWidgetId(settings, 'time'), type: 'time', layout };
    if (cities && Array.isArray(cities)) {
        config.cities = cities;
    }
    if (skin) {
        config.skin = skin;
    }
    addWidget(settings, config, width, height);
}

export function addAnalogClockWidget(settings, skin = 'basic', width = 4, height = 4) {
    const config = {
        id: nextWidgetId(settings, 'time'),
        type: 'time',
        layout: 'analog',
        skin,
    };
    addWidget(settings, config, width, height);
}

export function addWeatherWidget(settings, city = 'London', width = 4, height = 4, layout = 'standard') {
    addWidget(settings, { id: nextWidgetId(settings, 'weather'), type: 'weather', location: city, layout }, width, height);
}
export function addWeatherBarsWidget(settings, city = 'London', width = 6, height = 6) {
    addWidget(settings, { id: nextWidgetId(settings, 'weather_bars'), type: 'weather_bars', location: city, layout: 'bars' }, width, height);
}
export function addMusicWidget(settings, width = 4, height = 4) {
    const config = { id: nextWidgetId(settings, 'music'), type: 'music' };
    // Must set before addWidget, which keys off isWideMusicLayout()
    config.isLargeLayout = width / height >= WIDE_MUSIC_LAYOUT_ASPECT_RATIO;
    addWidget(settings, config, width, height);
}

export function addPomodoroWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'pomodoro'), type: 'pomodoro' }, width, height);
}

export function addPomodoroFocusWidget(settings, width = 8, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'pomodoro-focus'), type: 'pomodoro-focus' }, width, height);
}

export function addCpuRamWidget(settings, width = 4, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'cpu-ram'), type: 'cpu-ram' }, width, height);
}

export function addNetworkSpeedWidget(settings, width = 4, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'network-speed'), type: 'network-speed' }, width, height);
}

export function addSystemDashboardWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'system-dashboard'), type: 'system-dashboard' }, width, height);
}

export function addNotesWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'notes'), type: 'notes' }, width, height);
}

export function addClipboardWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'clipboard'), type: 'clipboard' }, width, height);
}

export function addCalendarWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'calendar'), type: 'calendar' }, width, height);
}

export function addQuotesWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'quotes'), type: 'quotes' }, width, height);
}

export function addScreenTimeWidget(settings, width = 8, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'screen-time'), type: 'screen-time' }, width, height);
}

export function addCalendarGridWidget(settings, width = 5, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'calendar-grid'), type: 'calendar-grid' }, width, height);
}

export function addTodoWidget(settings, width = 6, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'todo'), type: 'todo' }, width, height);
}

export function addGithubWidget(settings, username = '', width = 8, height = 4) {
    const widgetConfig = { id: nextWidgetId(settings, 'github'), type: 'github' };
    if (username)
        widgetConfig.username = username;
    addWidget(settings, widgetConfig, width, height);
}

export function addRssHeadlinesWidget(settings, feedUrl = '', width = 4, height = 4) {
    if (!feedUrl)
        return;
    addWidget(settings, {
        id: nextWidgetId(settings, 'rss-headlines'),
        type: 'rss-headlines',
        feedUrl,
        refreshMinutes: DEFAULT_RSS_REFRESH_MINUTES,
    }, width, height);
}

export function addMoodWidget(settings, width = 8, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'mood'), type: 'mood' }, width, height);
}

export function addSunScheduleWidget(settings, city, latitude, longitude, width = 4, height = 4) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'sun-schedule'),
        type: 'sun-schedule',
        city,
        latitude,
        longitude,
    }, width, height);
}

export function addAppLauncherWidget(settings, apps) {
    const normalizedApps = normalizeAppLauncherApps(apps);
    if (normalizedApps.length === 0) {
        return;
    }

    addWidget(settings, {
        id: nextWidgetId(settings, 'app-launcher'),
        type: 'app-launcher',
        apps: normalizedApps,
    }, 4, 3);
}

export function addSlideshowWidget(settings, folderPath, intervalSeconds = 10, width = 4, height = 3, caption = 'My Slideshow', showCaption = true, transitionType = 'crossfade') {
    const finalCaption = caption && caption.trim() !== '' ? caption.trim() : 'My Slideshow';
    const widgetConfig = {
        id: nextWidgetId(settings, 'slideshow'),
        type: 'slideshow',
        slideshowFolder: folderPath,
        intervalSeconds,
        caption: finalCaption,
        showCaption: showCaption !== false,
        transitionType,
    };

    addWidget(settings, widgetConfig, width, height);
}

export function addImageWidget(settings, imagePath, caption = 'My Image', showCaption = true, width = 4, height = 3) {
    const finalCaption = caption && caption.trim() !== '' ? caption.trim() : 'My Image';
    const widgetConfig = {
        id: nextWidgetId(settings, 'image'),
        type: 'image',
        imagePath,
        caption: finalCaption,
        showCaption: showCaption !== false,
    };

    addWidget(settings, widgetConfig, width, height);
}

export function addBatteryStatusWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'battery-status'), type: 'battery-status' }, width, height);
}

export function addSystemInfoWidget(settings, systemInfoType = 'cpu', width = 2, height = 2) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'system-info'),
        type: 'system-info',
        systemInfoType,
    }, width, height);
}

export function addResourceWheelWidget(settings, width = 5, height = 4) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'resource-wheel'),
        type: 'resource-wheel',
    }, width, height);
}

export function addCurrencyTrackerWidget(settings, width = 7, height = 4) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'currency-tracker'),
        type: 'currency-tracker',
        baseCurrency: 'EUR',
        targetCurrency: 'HUF',
    }, width, height);
}

export function addHabitTrackerWidget(settings, width = 7, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'habit'), type: 'habitTracker' }, width, height);
}

export function addQuickTogglesWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'quickToggles'), type: 'quickToggles' }, width, height);
}

export function addAudioOutputWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'audioOutput'), type: 'audioOutput' }, width, height);
}

export function addControlsSlidersWidget(settings, width = 5, height = 3) {
    addWidget(settings, { id: nextWidgetId(settings, 'controlsSliders'), type: 'controlsSliders' }, width, height);
}

export function addPowerProfilesWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'powerProfiles'), type: 'powerProfiles' }, width, height);
}

export function addWeatherCardsWidget(settings, city = 'London', width = 3, height = 3, layout = 'standard') {
    addWidget(settings, { id: nextWidgetId(settings, 'weather_cards'), type: 'weather_cards', location: city, layout }, width, height);
}

export function addTimerWidget(settings, durationSeconds = 300, label = 'Timer', width = 4, height = 4) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'timer'),
        type: 'timer',
        timerDurationSeconds: durationSeconds,
        timerLabel: label,
    }, width, height);
}

export function addCountdownWidget(settings, eventName = 'Goal', targetDate = '', width = 4, height = 4) {
    addWidget(settings, { 
        id: nextWidgetId(settings, 'countdown'),
        type: 'countdown',
        eventName,
        targetDate,
        startDate: new Date().toISOString(), 
    }, width, height);
}

export function addStopWatchWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'stopwatch'), type: 'stopwatch' }, width, height);
}

export function addPingWidget(settings, width = 2, height = 2) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'ping'),
        type: 'ping-monitor',
        pingHost: '1.1.1.1',
        pingLabel: 'Cloudflare',
        showChart: false,
    }, width, height);
}

export function addStorageBarWidget(settings, width = 7, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'storageBar'), type: 'storageBar' }, width, height);
}

export function addCryptoWidget(settings, width = 7, height = 4) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'cryptoWidget'),
        type: 'cryptoWidget',
        targetCurrency: 'HUF' 
    }, width, height);
}

export function addTodayHistoryWidget(settings, width = 4, height = 4) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'today-history'),
        type: 'todayHistory',
        language: 'en',
        category: 'selected',
    }, width, height);
}

export function addPowerTogglesWidget(settings, width = 4, height = 4) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'power-toggles'),
        type: 'powerToggles',
    }, width, height);
}

export function addWorldAnalogWidget(settings, width = 4, height = 4, cities = null) {
    const config = {
        id: nextWidgetId(settings, 'world-analog'),
        type: 'worldAnalog',
    };
    if (cities && Array.isArray(cities)) {
        config.cities = cities;
    }
    addWidget(settings, config, width, height);
}

export function addCalendarTasksWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'calendarTasks'), type: 'calendarTasks' }, width, height);
}

export function addWatermindWidget(settings, hourlyTargetMl = 250, intervalMinutes = 60, btn1 = 200, btn2 = 500, btn3 = 750, width = 4, height = 4) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'watermind'),
        type: 'watermind',
        hourlyTargetMl,
        intervalMinutes,
        btn1Ml: btn1,
        btn2Ml: btn2,
        btn3Ml: btn3,
    }, width, height);
}

export function addBluetoothDevicesWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'bluetoothDevices'), type: 'bluetoothDevices' }, width, height);
}

export function addMailGoaWidget(settings, width = 2, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'mailGoa'), type: 'mailGoa' }, width, height);
}

export function addLavaLampWidget(settings, width = 4, height = 8) {
    addWidget(settings, { id: nextWidgetId(settings, 'lavaLamp'), type: 'lavaLamp' }, width, height);
}

export function addMoonWidget(settings, city, latitude, longitude, width = 6, height = 3) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'moon'),
        type: 'moon',
        city,
        latitude,
        longitude,
    }, width, height);
}

export function addBinaryWidget(settings, width = 4, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'binary'), type: 'binary' }, width, height);
}

export function addDownloadsWidget(settings, width = 4, height = 5) {
    addWidget(settings, { id: nextWidgetId(settings, 'downloads'), type: 'downloads' }, width, height);
}

export function addUptimeWidget(settings, width = 3, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'uptime'), type: 'uptime' }, width, height);
}

export function addUpdatesWidget(settings, width = 2, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'updates'), type: 'updates' }, width, height);
}

export function addHardwerInfoWidget(settings, width = 6, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'hardwerinfo'), type: 'hardwerinfo' }, width, height);
}

export function addLyricsWidget(settings, width = 6, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'lyrics'), type: 'lyrics' }, width, height);
}