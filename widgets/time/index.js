import { createDigitalTimeNode } from './timeDigital.js';
import { createWorldTimeNode } from './timeWorld.js';
import { createWorldTimeAnalogNode } from './timeWorldAnalog.js';
import { createAnalogTimeNode } from './timeAnalog.js';
import { createTimerNode } from './timerWidget.js';
import { createCountdownNode } from './countdownWidget.js';
import { createBinaryNode } from './binary.js';

export {
    createDigitalTimeNode,
    createWorldTimeNode,
    createWorldTimeAnalogNode,
    createAnalogTimeNode,
    createTimerNode,
    createCountdownNode,
    createBinaryNode
};

export { createCalendarNode } from './calendar.js';
export { createCalendarGridNode } from './calendarGrid.js';
export { createStopwatchNode } from './stopwatchWidget.js';
export { createCalendarWeatherNode } from './calendarWeather.js';

export function createTimeNode(widgetData, width, height, xPosition, yPosition) {
    if (widgetData.layout === 'analog' || widgetData.type === 'analogClock') {
        return createAnalogTimeNode(widgetData, width, height, xPosition, yPosition);
    }
    if (widgetData.layout === 'world' || widgetData.type === 'worldClock') {
        return createWorldTimeNode(widgetData, width, height, xPosition, yPosition);
    }
    if (widgetData.layout === 'worldAnalog' || widgetData.type === 'worldClockAnalog') {
        return createWorldTimeAnalogNode(widgetData, width, height, xPosition, yPosition);
    }
    if (widgetData.layout === 'timer') {
        return createTimerNode(widgetData, width, height, xPosition, yPosition);
    }
    if (widgetData.layout === 'countdown') {
        return createCountdownNode(widgetData, width, height, xPosition, yPosition);
    }
    if (widgetData.layout === 'binary') {
        return createBinaryNode(widgetData, width, height, xPosition, yPosition);
    }
    return createDigitalTimeNode(widgetData, width, height, xPosition, yPosition);
}
