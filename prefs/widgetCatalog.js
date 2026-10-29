import { isWideMusicLayout } from '../utils/widgetUtils.js';
import { LAVA_THEMES } from '../utils/lavaThemes.js';


export const STORE_WIDGETS = Object.freeze({
    // ── Weather ────────────────────────────────────────────────────────
    weatherStandard: {
        title: 'Weather Standard',
        description: 'A clean weather widget with current conditions and temperature.',
        gridSize: '4x4',
        thumbnail: 'weather/weatherStandard.svg',
        fallbackIconName: 'weather-few-clouds-symbolic',
    },
    weatherMinimal: {
        title: 'Weather Minimal',
        description: 'A compact weather widget focused on current conditions and temperature.',
        gridSize: '4x4',
        thumbnail: 'weather/weatherMinimal.svg',
        fallbackIconName: 'weather-few-clouds-symbolic',
    },
    weatherForecast: {
        title: 'Weather Forecast',
        description: 'An expanded weather layout with hourly forecast details.',
        gridSize: '6x4',
        thumbnail: 'weather/weatherForecast.svg',
        fallbackIconName: 'weather-overcast-symbolic',
    },
    weatherBars: {
        title: 'Weather Daily Bars',
        description: 'Daily weather forecast with temperature range bars.',
        gridSize: '6x6',
        thumbnail: 'weather/weatherBar.svg',
        fallbackIconName: 'weather-few-clouds-symbolic',
    },
    weatherCards: {
        title: 'Weather Cards',
        description: 'Minimal weather cards with UV index, humidity, AQI, and trend chart.',
        gridSize: '3x3',
        thumbnail: 'weather/weatherCards.svg',
        fallbackIconName: 'weather-clear-symbolic',
    },
    sunScheduleWidget: {
        title: 'Solar Schedule',
        description: 'Sunrise and sunset times for any city, powered by Open-Meteo.',
        gridSize: '4x4',
        thumbnail: 'weather/solar-schedule.svg',
        fallbackIconName: 'daytime-sunset-symbolic',
    },
    moonWidget: {
        title: 'Moon',
        description: 'Current moon phase and upcoming phases.',
        gridSize: '6x3',
        thumbnail: 'weather/moon.svg',
        fallbackIconName: 'weather-clear-night-symbolic',
    },

    // ── Media ──────────────────────────────────────────────────────────
    musicPlayer: {
        title: 'Music Player',
        description: 'Displays the currently playing media album art.',
        gridSize: '4x4',
        thumbnail: 'media/musicSmall.svg',
        fallbackIconName: 'audio-x-generic-symbolic',
    },
    musicPlayerWide: {
        title: 'Music Player (Wide)',
        description: 'Wide layout displaying album art and player controls.',
        gridSize: '8x4',
        thumbnail: 'media/musicLarge.svg',
        fallbackIconName: 'audio-x-generic-symbolic',
    },
    lyricsWidget: {
        title: 'Lyrics',
        description: 'Synchronized real-time song lyrics for currently playing media.',
        gridSize: '6x4',
        thumbnail: 'media/lyrics.svg', 
        fallbackIconName: 'text-editor-symbolic',
    },
    imageGif: {
        title: 'Image / GIF',
        description: 'Display an image or animated GIF directly on your desktop.',
        gridSize: '4x3',
        thumbnail: 'media/images.svg',
        fallbackIconName: 'image-x-generic-symbolic',
    },
    imageSlideshow: {
        title: 'Image Slideshow',
        description: 'Cycle through images in a folder with crossfade transitions.',
        gridSize: '4x3',
        thumbnail: 'media/slideshow.svg',
        fallbackIconName: 'view-paged-symbolic',
    },

    // ── System Monitor ─────────────────────────────────────────────────
    systemDashboard: {
        title: 'System Dashboard',
        description: 'All-in-one system dashboard with CPU history, temp, tasks, network speed, and RAM.',
        gridSize: '4x4',
        thumbnail: 'system/system-dashboard.svg',
        fallbackIconName: 'resources-symbolic',
    },
    systemMonitor: {
        title: 'System Monitor',
        description: 'Monitor your CPU and RAM resource usage in real time.',
        gridSize: '4x2',
        thumbnail: 'system/system-monitor.svg',
        fallbackIconName: 'resources-symbolic',
    },
    systemInfo: {
        title: 'System Info',
        description: 'Compact tile showing real-time CPU, RAM, or Disk utilization.',
        gridSize: '2x2',
        thumbnail: 'system/system-info.svg',
        fallbackIconName: 'utilities-system-monitor-symbolic',
    },
    resourceWheel: {
        title: 'Resource Wheel',
        description: 'Circular hardware telemetry showing CPU, RAM, Disk, and Temp.',
        gridSize: '5x4',
        thumbnail: 'system/resource-wheel.svg',
        fallbackIconName: 'utilities-system-monitor-symbolic',
    },
    storageBar: {
        title: 'Storage Bar',
        description: 'Visual storage space and disk usage bar.',
        gridSize: '7x4',
        thumbnail: 'system/storage-bar.svg',
        fallbackIconName: 'drive-harddisk-symbolic',
    },
    batteryStatus: {
        title: 'Battery Status',
        description: 'Monitor your laptop and connected Bluetooth devices\' battery levels.',
        gridSize: '4x4',
        thumbnail: 'system/battery-status.svg',
        fallbackIconName: 'battery-level-100-charged-symbolic',
    },
    networkSpeed: {
        title: 'Network Speed',
        description: 'A live tracker for upload and download speeds.',
        gridSize: '4x2',
        thumbnail: 'system/network-speed.svg',
        fallbackIconName: 'network-workgroup-symbolic',
    },
    pingMonitor: {
        title: 'Ping Monitor',
        description: 'Live latency monitor with status indicator and history trend.',
        gridSize: '2x2',
        thumbnail: 'system/ping-monitor.svg',
        fallbackIconName: 'network-transmit-receive-symbolic',
    },
    quickToggles: {
        title: 'Quick Toggles',
        description: 'Quickly toggle Dark Mode, Night Light, DND, and lock screen.',
        gridSize: '4x4',
        thumbnail: 'system/quick-toggles.svg',
        fallbackIconName: 'preferences-system-symbolic',
    },
    audioOutput: {
        title: 'Audio Output',
        description: 'Switch between audio output devices.',
        gridSize: '4x4',
        thumbnail: 'system/audio-output.svg',
        fallbackIconName: 'preferences-system-symbolic',
    },
    controlsSliders: {
        title: 'Control Sliders',
        description: 'Quick brightness and volume sliders.',
        gridSize: '5x3',
        thumbnail: 'system/controls-sliders.svg',
        fallbackIconName: 'preferences-system-symbolic',
    },
    powerProfiles: {
        title: 'Power Profiles',
        description: 'Switch between system power profiles.',
        gridSize: '4x4',
        thumbnail: 'system/energy_management.svg',
        fallbackIconName: 'preferences-system-symbolic',
    },
    powerToggles: {
        title: 'Power Controls',
        description: 'Quick power management buttons for suspend, reboot, shutdown, and logout.',
        gridSize: '4x4',
        thumbnail: 'system/power.svg',
        fallbackIconName: 'system-shutdown-symbolic',
    },
    bluetoothDevices: {
        title: 'Bluetooth Devices',
        description: 'List connected Bluetooth devices with battery info. Click to disconnect.',
        gridSize: '4x4',
        thumbnail: 'system/bluetooth.svg',
        fallbackIconName: 'bluetooth-active-symbolic',
    },
    downloads: {
        title: 'Folder Preview',
        description: 'Quick access grid for downloaded files or any watched directory with previews.',
        gridSize: '4x5',
        thumbnail: 'system/downloads.svg',
        fallbackIconName: 'folder-download-symbolic',
    },
    uptime: {
        title: 'Uptime',
        description: 'Displays system running time since the last boot.',
        gridSize: '4x2',
        thumbnail: 'system/uptime.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    updates: {
        title: 'Updates',
        description: 'Displays pending package updates for APT, DNF, Pacman, or Zypper.',
        gridSize: '2x2',
        thumbnail: 'system/updates.svg',
        fallbackIconName: 'software-update-available-symbolic',
    },
    hardwerinfo: {
        title: 'Hardwerinfo',
        description: 'Detailed system and hardware inventory (CPU, GPU, RAM, OS), as well as real-time tracking of connected USB and Thunderbolt devices.',
        gridSize: '6x5', 
        thumbnail: 'system/hardwerinfo.svg',
        fallbackIconName: 'preferences-system-symbolic',
    },

    // ── Focus & Productivity ───────────────────────────────────────────
    pomodoroTimer: {
        title: 'Pomodoro Timer',
        description: 'A focus timer with work and break cycles.',
        gridSize: '4x4',
        thumbnail: 'productivity/pomodoro.svg',
        fallbackIconName: 'alarm-symbolic',
    },
    pomodoroFocus: {
        title: 'Pomodoro Focus',
        description: 'Compact focus timer with mode switching, a circular gauge, and session tracking.',
        gridSize: '8x4',
        thumbnail: 'productivity/pomodoro-focus.svg',
        fallbackIconName: 'alarm-symbolic',
    },
    todoWidget: {
        title: 'To-do',
        description: 'A to-do list with a pending counter, checkable tasks, and quick add.',
        gridSize: '6x4',
        thumbnail: 'productivity/todo.svg',
        fallbackIconName: 'view-list-symbolic',
    },
    quickNotes: {
        title: 'Quick Notes',
        description: 'A markdown sticky note to quickly write down notes.',
        gridSize: '4x4',
        thumbnail: 'productivity/quick-notes.svg',
        fallbackIconName: 'text-editor-symbolic',
    },
    clipboardHistory: {
        title: 'Clipboard History',
        description: 'Access a history of your recently copied text items.',
        gridSize: '4x4',
        thumbnail: 'productivity/clipboard.svg',
        fallbackIconName: 'edit-copy-symbolic',
    },
    appLauncher: {
        title: 'App Launcher',
        description: 'Launch up to 8 installed applications from a compact desktop widget.',
        gridSize: '4x3',
        thumbnail: 'productivity/app-launcher.svg',
        fallbackIconName: 'view-grid-symbolic',
    },
    mailGoa: {
        title: 'Unread Mail',
        description: 'List unread mail.',
        gridSize: '2x2',
        thumbnail: 'productivity/mailGoa.svg',
        fallbackIconName: 'mail-unread-symbolic',
    },

    // ── Time & Calendar ────────────────────────────────────────────────
    timeAndDate: {
        title: 'Time & Date',
        description: 'A clean digital clock with the current date.',
        gridSize: '4x3',
        thumbnail: 'time/timeDigital.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    analogClock: {
        title: 'Analog Clock',
        description: 'A customizable vector analog clock with a smooth second hand.',
        gridSize: '4x4',
        thumbnail: 'time/analog-clock.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    worldClock: {
        title: 'World Clock',
        description: 'Multi-city digital clock displaying time across global timezones.',
        gridSize: '4x4',
        thumbnail: 'time/worldClock.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    worldAnalog: {
        title: 'World Analog Clock',
        description: 'Multi-city world clock displaying time across global timezones.',
        gridSize: '4x4',
        thumbnail: 'time/worldAnalog.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    binary: {
        title: 'Binary Time',
        description: 'A clean BCD binary clock display.',
        gridSize: '4x2',
        thumbnail: 'time/binary.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    stopwatch: {
        title: 'Stopwatch',
        description: 'Simple stopwatch widget.',
        gridSize: '4x4',
        thumbnail: 'time/stopwatch.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    timer: {
        title: 'Timer',
        description: 'Simple timer widget.',
        gridSize: '4x4',
        thumbnail: 'time/timer.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    countdown: {
        title: 'Countdown',
        description: 'Simple countdown widget.',
        gridSize: '4x4',
        thumbnail: 'time/countdown.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    calendarWidget: {
        title: 'Calendar',
        description: 'A monthly calendar with today highlighted and month navigation.',
        gridSize: '4x4',
        thumbnail: 'time/calendar.svg',
        fallbackIconName: 'x-office-calendar-symbolic',
    },
    calendarGrid: {
        title: 'Month Calendar',
        description: 'A compact month grid with today highlighted and weekends colored.',
        gridSize: '5x4',
        thumbnail: 'time/calendarGrid.svg',
        fallbackIconName: 'x-office-calendar-symbolic',
    },

    // ── Personal ───────────────────────────────────────────────────────
    todayHistory: {
        title: 'Today in History',
        description: 'Historical events and milestones on this day via Wikipedia.',
        gridSize: '4x4',
        thumbnail: 'personal/history.svg',
        fallbackIconName: 'help-about-symbolic',
    },
    quotesWidget: {
        title: 'Quotes',
        description: 'Daily quotes from philosophers, programmers, and thinkers, updated automatically.',
        gridSize: '4x4',
        thumbnail: 'personal/quotes.svg',
        fallbackIconName: 'help-about-symbolic',
    },
    rssHeadlinesWidget: {
        title: 'RSS Headlines',
        description: 'A compact card that auto-rotates through article headlines from any feed.',
        gridSize: '4x4',
        thumbnail: 'personal/rss-headlines.svg',
        fallbackIconName: 'application-rss+xml-symbolic',
    },
    calendarTasks: {
        title: 'Calendar Tasks',
        description: 'Displays today\'s events from your synchronized calendars with their custom colors.',
        gridSize: '4x4',
        thumbnail: 'personal/calendarTasks.svg',
        fallbackIconName: 'x-office-calendar-symbolic',
    },
    habitTracker: {
        title: 'Habit Tracker',
        description: 'Simple tool to record and measure your daily routines.',
        gridSize: '7x4',
        thumbnail: 'personal/habit-tracker.svg',
        fallbackIconName: 'checkbox-checked-symbolic',
    },
    moodWidget: {
        title: 'Mood Logger',
        description: 'Log how you feel each day and watch the past four weeks fill with color.',
        gridSize: '8x4',
        thumbnail: 'personal/mood-logger.svg',
        fallbackIconName: 'face-smile-big-symbolic',
    },
    watermind: {
        title: 'Watermind',
        description: 'Track daily water intake, hydration levels, and receive periodic reminders.',
        gridSize: '4x4',
        thumbnail: 'personal/watermind.svg',
        customIcon: 'icons/watermind-symbolic.svg',
        fallbackIconName: 'cup-symbolic',
    },
    screenTimeWidget: {
        title: 'Screen Time',
        description: 'Track your desktop screen time at a glance.',
        gridSize: '8x4',
        thumbnail: 'personal/screen-time.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    currencyTracker: {
        title: 'Currency Tracker',
        description: 'Track exchange rates with history trend chart via Frankfurter.',
        gridSize: '7x4',
        thumbnail: 'personal/currencytracker.svg',
        fallbackIconName: 'bank-symbolic',
    },
    cryptoWidget: {
        title: 'Crypto Tracker',
        description: 'Track BTC, ETH, and SOL rates with trend chart via CoinGecko.',
        gridSize: '7x4',
        thumbnail: 'personal/cryptotracker.svg',
        fallbackIconName: 'bank-symbolic',
    },
    githubWidget: {
        title: 'GitHub Activity',
        description: 'Your GitHub contribution graph with avatar, yearly total, and sync status.',
        gridSize: '8x4',
        thumbnail: 'personal/github.svg',
        fallbackIconName: 'starred-symbolic',
    },
    lavaLamp: {
        title: 'Lava Lamp',
        description: 'Ambient lava lamp with fluid wax metaball morphing.',
        gridSize: '4x8',
        thumbnail: 'personal/lavaLamp.svg',
        customIcon: 'icons/lavalamp-symbolic.svg',
        fallbackIconName: 'weather-clear-symbolic',
    },
});

export const STORE_CATEGORIES = Object.freeze({
    weather: ['weatherStandard', 'weatherMinimal', 'weatherForecast', 'weatherBars', 'sunScheduleWidget', 'weatherCards', 'moonWidget'],
    music: ['musicPlayer', 'musicPlayerWide', 'lyricsWidget'],
    time: ['timeAndDate', 'analogClock', 'worldClock', 'calendarWidget', 'calendarGrid', 'countdown', 'timer', 'stopwatch', 'worldAnalog', 'binary'],
    media: ['imageGif', 'imageSlideshow'],
    utilities: [
        'systemDashboard',
        'batteryStatus',
        'pomodoroTimer',
        'pomodoroFocus',
        'systemMonitor',
        'networkSpeed',
        'quickNotes',
        'clipboardHistory',
        'appLauncher',
        'quotesWidget',
        'screenTimeWidget',
        'githubWidget',
        'todoWidget',
        'rssHeadlinesWidget',
        'moodWidget',
        'systemInfo',
        'resourceWheel',
        'currencyTracker',
        'habitTracker',
        'quickToggles',
        'audioOutput',
        'controlsSliders',
        'powerProfiles',
        'pingMonitor',
        'storageBar',
        'cryptoWidget',
        'todayHistory',
        'powerToggles',
        'calendarTasks',
        'watermind',
        'bluetoothDevices',
        'mailGoa',
        'lavaLamp',
        'downloads',
        'uptime',
        'updates',
        'hardwerinfo'

    ],
});

function getWeatherEntryKey(widget) {
    if (widget.type === 'weather_cards' || widget.layout === 'cards') {
        return 'weatherCards';
    }
    if (widget.type === 'weather_bars' || widget.layout === 'bars') {
        return 'weatherBars';
    }

    const layout = widget.layout || (widget.width >= 6 ? 'forecast' : (widget.width === 4 ? 'simple' : 'standard'));
    if (layout === 'forecast') {
        return 'weatherForecast';
    }
    if (layout === 'simple') {
        return 'weatherMinimal';
    }
    return 'weatherStandard';
}

function getMusicEntryKey(widget) {
    if (isWideMusicLayout(widget)) {
        return 'musicPlayerWide';
    }
    return 'musicPlayer';
}

function getStoreWidgetKey(widget) {
    switch (widget.type) {
        case 'weather':
            return getWeatherEntryKey(widget);
        case 'weather_bars':
            return 'weatherBars';    
        case 'music':
            return getMusicEntryKey(widget);
        case 'worldAnalog':
            return 'worldAnalog';
        case 'time':
            if (widget.layout === 'worldAnalog' || widget.layout === 'worldClockAnalog') {
                return 'worldAnalog';
            }
            if (widget.layout === 'analog' || widget.type === 'analogClock') {
                return 'analogClock';
            }
            if (widget.layout === 'binary') {
                return 'binary';
            }
            return widget.layout === 'world' ? 'worldClock' : 'timeAndDate';
        case 'slideshow':
            return 'imageSlideshow';
        case 'image':
            return 'imageGif';
        case 'system-dashboard':
            return 'systemDashboard';
        case 'battery-status': 
            return 'batteryStatus';    
        case 'pomodoro':
            return 'pomodoroTimer';
        case 'pomodoro-focus':
            return 'pomodoroFocus';
        case 'cpu-ram':
            return 'systemMonitor';
        case 'network-speed':
            return 'networkSpeed';
        case 'notes':
            return 'quickNotes';
        case 'clipboard':
            return 'clipboardHistory';
        case 'app-launcher':
            return 'appLauncher';
        case 'calendar':
            return 'calendarWidget';
        case 'calendar-grid':
            return 'calendarGrid';
        case 'quotes':
            return 'quotesWidget';
        case 'screen-time':
            return 'screenTimeWidget';
        case 'todo':
            return 'todoWidget';
        case 'github':
            return 'githubWidget';
        case 'rss-headlines':
        case 'rss-feed':
            return 'rssHeadlinesWidget';
        case 'mood':
            return 'moodWidget';
        case 'sun-schedule':
            return 'sunScheduleWidget';
        case 'system-info':
            return 'systemInfo';
        case 'resource-wheel': 
            return 'resourceWheel';
        case 'currency-tracker':
            return 'currencyTracker';
        case 'habitTracker':
            return 'habitTracker';
        case 'quickToggles':
            return 'quickToggles';
        case 'audioOutput':
            return 'audioOutput';   
        case 'controlsSliders':
            return 'controlsSliders';
        case 'powerProfiles':
            return 'powerProfiles';
        case 'weather_cards':
            return 'weatherCards';
        case 'timer':
            return 'timer';
        case 'countdown':
            return 'countdown';
        case 'stopwatch':
            return 'stopwatch';  
        case 'ping-monitor':
            return 'pingMonitor';  
        case 'storageBar':
            return 'storageBar';
        case 'cryptoWidget':
            return 'cryptoWidget';
        case 'todayHistory':
            return 'todayHistory';
        case 'calendarTasks':
            return 'calendarTasks';
        case 'watermind':
            return 'watermind';
        case 'bluetoothDevices':
            return 'bluetoothDevices';
        case 'mailGoa':
            return 'mailGoa';
        case 'lavaLamp':
            return 'lavaLamp';
        case 'moon':
            return 'moonWidget';
        case 'binary':
            return 'binary';
        case 'downloads':
            return 'downloads';
        case 'uptime':
            return 'uptime';
        case 'updates':
            return 'updates';
        case 'hardwerinfo':
            return 'hardwerinfo';
        case 'lyrics':
            return 'lyricsWidget';
        default:
            return null;
    }
}

export function getStoreWidgetEntry(widget) {
    const key = getStoreWidgetKey(widget);
    if (!key) {
        return null;
    }
    return STORE_WIDGETS[key] || null;
}

function getPathBaseName(filePath, fallbackText) {
    if (!filePath) {
        return fallbackText;
    }
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length === 0) {
        return fallbackText;
    }
    return parts[parts.length - 1];
}

export function getWidgetDetailText(widget) {
    switch (widget.type) {
        case 'weather':
        case 'weather_bars':
        case 'weather_cards':
            return `Location: ${widget.location || 'London'}`; 
        case 'slideshow':
            return `Folder: ${getPathBaseName(widget.slideshowFolder, 'Unknown')}`;
        case 'image':
            return `File: ${getPathBaseName(widget.imagePath, 'Unknown')}`;
        case 'rss-headlines':
        case 'rss-feed':
            return `Feed: ${widget.feedUrl || 'Not configured'}`;
        case 'pomodoro-focus':
            return `Focus: ${widget.workMinutes || 25} min sessions`;
        case 'sun-schedule':
            return `Location: ${widget.city || 'Unknown'}`;
        case 'app-launcher': {
            const apps = Array.isArray(widget.apps) ? widget.apps : [];
            if (apps.length === 0) {
                return 'Apps: None selected';
            }
            const previewNames = apps.slice(0, 3).map(app => app.name || app.id);
            const remainingCount = apps.length - previewNames.length;
            const suffix = remainingCount > 0 ? ` +${remainingCount} more` : '';
            return `Apps: ${previewNames.join(', ')}${suffix}`;
        }
        case 'time':
            if (widget.layout === 'analog') {
                return `Skin: ${widget.skin || 'basic'}`;
            }
            return '';
        case 'system-info':
            return `Metric: ${(widget.systemInfoType || 'CPU').toUpperCase()}`;
        case 'currency-tracker': {
            const base = (widget.baseCurrency || 'EUR').toUpperCase();
            const target = (widget.targetCurrency || 'HUF').toUpperCase();
            return `Pair: ${base} / ${target}`;
        }
        case 'cryptoWidget': {
            const target = (widget.targetCurrency || 'HUF').toUpperCase();
            return `Currency: ${target}`;
        }
        case 'todayHistory': {
            const lang = (widget.language || 'hu').toUpperCase();
            return `Language: ${lang}`;
        }
        case 'watermind':
            return `Goal: ${widget.hourlyTargetMl || 250} ml/h (${widget.intervalMinutes || 60} min)`;
        case 'lavaLamp': {
            const themeKey = widget.lavaTheme || 'classic';
            const themeName = LAVA_THEMES[themeKey]?.name || themeKey.toUpperCase();
            return `Theme: ${themeName}`;
        }
        case 'moon':
            return `Location: ${widget.city || 'Unknown'}`;
        default:
            return '';
    }
}
