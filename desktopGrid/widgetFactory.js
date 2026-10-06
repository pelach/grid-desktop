import { createTimeNode } from '../widgets/time/index.js';
import { createTimerNode } from '../widgets/time/timerWidget.js';
import { createCountdownNode } from '../widgets/time/countdownWidget.js';
import { createStopwatchNode } from '../widgets/time/stopwatchWidget.js';
import { createWeatherNode } from '../widgets/weather/index.js';
import { createMusicNode } from '../widgets/music/index.js';
import { createNotesNode } from '../widgets/notes.js';
import { createClipboardNode } from '../widgets/clipboard.js';
import { createCalendarNode } from '../widgets/calendar.js';
import { createQuotesNode } from '../widgets/quotes.js';
import {
    createCpuRamNode,
    createNetworkSpeedNode,
    createSystemDashboardNode,
    createBatteryStatusNode,
    createSystemInfoNode,
    createResourceWheelNode,
    createQuickTogglesNode,
    createAudioOutputNode,
    createControlsSlidersNode,
    createPowerProfilesNode,
    createStorageBarNode
} from '../widgets/system/index.js';
import { createPomodoroNode } from '../widgets/pomodoro.js';
import { createPomodoroFocusNode } from '../widgets/pomodoroFocus.js';
import { createAppLauncherNode } from '../widgets/appLauncher.js';
import { createScreenTimeNode } from '../widgets/screenTimeWidget.js';
import { createCalendarGridNode } from '../widgets/calendarGrid.js';
import { createTodoNode } from '../widgets/todo.js';
import { createGithubNode } from '../widgets/github.js';
import { createSunScheduleNode } from '../widgets/solarSchedule.js';
import { createRssHeadlinesNode } from '../widgets/rssHeadlines.js';
import { createCurrencyTrackerNode } from '../widgets/currencyTracker.js';
import { createMoodNode } from '../widgets/moodLogger.js';
import { createHabitTrackerNode } from '../widgets/habitTracker.js';
import {
    createStaticImageNode,
    createAnimatedImageNode,
    createSlideshowNode
} from '../widgets/media/index.js';
import { isAnimatedImageFile } from '../utils/widgetUtils.js';
import { createDesktopIconNode } from '../widgets/desktopIcon.js';
import { createPingNode } from '../widgets/system/pingWidget.js';

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
};

export function createWidgetNode(data, width, height, x, y) {
    const creator = WIDGET_CREATORS[data.type];
    if (!creator) {
        console.error(`Unknown widget type: ${data.type}`);
        return null;
    }
    return creator(data, width, height, x, y);
}