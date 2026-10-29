// Utilities & Desktop
import { isAnimatedImageFile } from '../utils/widgetUtils.js';
import { createDesktopIconNode } from '../widgets/desktopIcon.js';

// Weather
import { 
    createWeatherNode, 
    createMoonNode, 
    createSunScheduleNode 
} from '../widgets/weather/index.js';

// Media & Music
import { 
    createAnimatedImageNode, 
    createSlideshowNode, 
    createStaticImageNode 
} from '../widgets/media/index.js';
import { 
    createMusicNode 
} from '../widgets/music/index.js';
import { 
    createLyricsNode 
} from '../widgets/music/lyrics.js';

// System
import {
    createAudioOutputNode,
    createBatteryStatusNode,
    createBluetoothDevicesNode,
    createControlsSlidersNode,
    createCpuRamNode,
    createNetworkSpeedNode,
    createPingNode,
    createPowerProfilesNode,
    createPowerTogglesNode,
    createQuickTogglesNode,
    createResourceWheelNode,
    createStorageBarNode,
    createSystemDashboardNode,
    createSystemInfoNode,
    createDownloadsNode,
    createUptimeNode,
    createUpdatesNode,
    createHardwareInfoNode
} from '../widgets/system/index.js';

// Time & Calendar
import {
    createBinaryNode,
    createCalendarGridNode,
    createCalendarNode,
    createCountdownNode,
    createStopwatchNode,
    createTimeNode,
    createTimerNode,
    createWorldTimeAnalogNode
} from '../widgets/time/index.js';

// Focus & Productivity
import {
    createAppLauncherNode,
    createClipboardNode,
    createMailGoaNode,
    createNotesNode,
    createPomodoroFocusNode,
    createPomodoroNode,
    createTodoNode
} from '../widgets/productivity/index.js';

// Personal
import {
    createCalendarTasksNode,
    createCryptoTrackerNode,
    createCurrencyTrackerNode,
    createGithubNode,
    createHabitTrackerNode,
    createLavaLampNode,
    createMoodNode,
    createQuotesNode,
    createRssHeadlinesNode,
    createScreenTimeNode,
    createTodayHistoryNode,
    createWatermindNode
} from '../widgets/personal/index.js';

const weatherCreator = (data, w, h, x, y) => {
    const dynamicColor = data.dynamicColor !== undefined ? data.dynamicColor : (data.globalWeatherDynamicColor !== false);
    const dynamicImage = data.dynamicImage !== undefined ? data.dynamicImage : (data.globalWeatherDynamicImage !== false);
    return createWeatherNode(data, w, h, x, y, dynamicColor, dynamicImage);
};

const WIDGET_CREATORS = {
    'time': (data, w, h, x, y) => createTimeNode(data, w, h, x, y),
    'timer': (data, w, h, x, y) => createTimerNode(data, w, h, x, y),
    'countdown': (data, w, h, x, y) => createCountdownNode(data, w, h, x, y),
    'stopwatch': (data, w, h, x, y) => createStopwatchNode(data, w, h, x, y),
    'weather': weatherCreator,
    'weather_bars': weatherCreator,
    'weather_cards': weatherCreator,
    'music': (data, w, h, x, y) => createMusicNode(data, w, h, x, y),
    'notes': (data, w, h, x, y) => createNotesNode(data, w, h, x, y),
    'clipboard': (data, w, h, x, y) => createClipboardNode(data, w, h, x, y),
    'cpu-ram': (data, w, h, x, y) => createCpuRamNode(data, w, h, x, y),
    'network-speed': (data, w, h, x, y) => createNetworkSpeedNode(data, w, h, x, y),
    'system-dashboard': (data, w, h, x, y) => createSystemDashboardNode(data, w, h, x, y),
    'resource-wheel': (data, w, h, x, y) => createResourceWheelNode(data, w, h, x, y),
    'battery-status': (data, w, h, x, y) => createBatteryStatusNode(data, w, h, x, y),
    'system-info': (data, w, h, x, y) => createSystemInfoNode(data, w, h, x, y),
    'pomodoro': (data, w, h, x, y) => createPomodoroNode(data, w, h, x, y),
    'pomodoro-focus': (data, w, h, x, y) => createPomodoroFocusNode(data, w, h, x, y),
    'currency-tracker': (data, w, h, x, y) => createCurrencyTrackerNode(data, w, h, x, y),
    'app-launcher': (data, w, h, x, y) => createAppLauncherNode(data, w, h, x, y),
    'calendar': (data, w, h, x, y) => createCalendarNode(data, w, h, x, y),
    'quotes': (data, w, h, x, y) => createQuotesNode(data, w, h, x, y),
    'screen-time': (data, w, h, x, y) => createScreenTimeNode(data, w, h, x, y),
    'calendar-grid': (data, w, h, x, y) => createCalendarGridNode(data, w, h, x, y),
    'todo': (data, w, h, x, y) => createTodoNode(data, w, h, x, y),
    'github': (data, w, h, x, y) => createGithubNode(data, w, h, x, y),
    'sun-schedule': (data, w, h, x, y) => createSunScheduleNode(data, w, h, x, y),
    'rss-headlines': (data, w, h, x, y) => createRssHeadlinesNode(data, w, h, x, y),
    'rss-feed': (data, w, h, x, y) => createRssHeadlinesNode(data, w, h, x, y),
    'mood': (data, w, h, x, y) => createMoodNode(data, w, h, x, y),
    'slideshow': (data, w, h, x, y) => createSlideshowNode(data, w, h, x, y),
    'image': (data, w, h, x, y) => {
        if (data.imagePath && isAnimatedImageFile(data.imagePath)) {
            const shouldAnimate = data.animateGif !== undefined ? data.animateGif : (data.globalAnimateGif !== false);
            return createAnimatedImageNode(data, w, h, x, y, shouldAnimate);
        }
        return createStaticImageNode(data, w, h, x, y);
    },
    'desktop-icon': (data, w, h, x, y) => createDesktopIconNode(data, w, h, x, y),
    'habitTracker': (data, w, h, x, y) => createHabitTrackerNode(data, w, h, x, y),
    'quickToggles': (data, w, h, x, y) => createQuickTogglesNode(data, w, h, x, y),
    'audioOutput': (data, w, h, x, y) => createAudioOutputNode(data, w, h, x, y),
    'controlsSliders': (data, w, h, x, y) => createControlsSlidersNode(data, w, h, x, y),
    'powerProfiles': (data, w, h, x, y) => createPowerProfilesNode(data, w, h, x, y),
    'ping-monitor': (data, w, h, x, y) => createPingNode(data, w, h, x, y),
    'storageBar': (data, w, h, x, y) => createStorageBarNode(data, w, h, x, y),
    'cryptoWidget': (data, w, h, x, y) => createCryptoTrackerNode(data, w, h, x, y),
    'todayHistory': (data, w, h, x, y) => createTodayHistoryNode(data, w, h, x, y),
    'powerToggles': (data, w, h, x, y) => createPowerTogglesNode(data, w, h, x, y),
    'worldAnalog': (data, w, h, x, y) => createWorldTimeAnalogNode(data, w, h, x, y),
    'calendarTasks': (data, w, h, x, y) => createCalendarTasksNode(data, w, h, x, y),
    'watermind': (data, w, h, x, y) => createWatermindNode(data, w, h, x, y),
    'bluetoothDevices': (data, w, h, x, y) => createBluetoothDevicesNode(data, w, h, x, y),
    'mailGoa': (data, w, h, x, y) => createMailGoaNode(data, w, h, x, y),
    'lavaLamp': (data, w, h, x, y) => createLavaLampNode(data, w, h, x, y),
    'moon': (data, w, h, x, y) => createMoonNode(data, w, h, x, y),
    'binary': (data, w, h, x, y) => createBinaryNode(data, w, h, x, y),
    'downloads': (data, w, h, x, y) => createDownloadsNode(data, w, h, x, y),
    'uptime': (data, w, h, x, y) => createUptimeNode(data, w, h, x, y),
    'updates': (data, w, h, x, y) => createUpdatesNode(data, w, h, x, y),
    'hardwerinfo': (data, w, h, x, y) => createHardwareInfoNode(data, w, h, x, y),
    'lyrics': (data, w, h, x, y) => createLyricsNode(data, w, h, x, y),
};

export function createWidgetNode(data, width, height, x, y) {
    const creator = WIDGET_CREATORS[data.type];
    if (!creator) {
        console.error(`Unknown widget type: ${data.type}`);
        return null;
    }
    return creator(data, width, height, x, y);
}