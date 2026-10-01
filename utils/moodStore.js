import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { getGridgetsDataDir, loadJsonFromFileAsync, saveJsonToFile, saveJsonToFileSync } from './widgetUtils.js';

import { todayDateString, toDateString } from './widgetUtils.js';
export { todayDateString, toDateString };

const DEBUG = false;
function logError(...args) {
    if (DEBUG) console.error(...args);
}

// Monthly-partitioned mood history: ~/.local/share/gridgets/mood/<year>/<month>.json
const monthCache = new Map();
/** Callbacks waiting on an in-flight month file read, keyed by 'YYYY-MM'. */
const pendingMonthLoads = new Map();
/** Generation counter — stale completions from before a clear are discarded. */
let monthLoadGeneration = 0;

function monthKeyOf(dateString) {
    return dateString.slice(0, 7);
}

function monthFilePath(dateString) {
    const [year, month] = dateString.split('-');
    return GLib.build_filenamev([getGridgetsDataDir('mood'), year, `${month}.json`]);
}

function requestMonthLoad(monthKey, dateString, onLoaded) {
    const filePath = monthFilePath(dateString);
    const queued = pendingMonthLoads.get(monthKey);
    if (queued) {
        queued.push(onLoaded);
        return;
    }

    const generation = monthLoadGeneration;
    const callbacks = [onLoaded];
    pendingMonthLoads.set(monthKey, callbacks);
    loadJsonFromFileAsync(filePath, (data) => {
        if (pendingMonthLoads.get(monthKey) === callbacks) {
            pendingMonthLoads.delete(monthKey);
        }
        if (generation === monthLoadGeneration) {
            monthCache.set(monthKey, data && typeof data === 'object' ? data : {});
            for (const callback of callbacks) {
                callback();
            }
        }
    });
}

/**
 * Ensures every month touched by dateKeys is cached, then invokes callback once.
 */
export function loadDatesAsync(dateKeys, callback) {
    const monthKeys = [...new Set(dateKeys.map(monthKeyOf))].filter(key => !monthCache.has(key));
    if (monthKeys.length === 0) {
        if (callback) callback();
        return;
    }

    let remaining = monthKeys.length;
    const onOneLoaded = () => {
        remaining -= 1;
        if (remaining === 0 && callback) {
            callback();
        }
    };
    for (const monthKey of monthKeys) {
        requestMonthLoad(monthKey, `${monthKey}-01`, onOneLoaded);
    }
}

/** Fallback wrapper calling async loader without blocking */
export function loadDatesSync(dateKeys) {
    loadDatesAsync(dateKeys, null);
}

/** Returns the logged mood level for a date, or 0 when nothing was logged. */
export function getMood(dateString) {
    const month = monthCache.get(monthKeyOf(dateString));
    return month ? (month[dateString] || 0) : 0;
}

/** Stores a mood level for a date and persists the whole month file. */
export function saveMood(dateString, level) {
    const monthKey = monthKeyOf(dateString);

    if (!monthCache.has(monthKey)) {
        requestMonthLoad(monthKey, `${monthKey}-01`, () => {
            let month = monthCache.get(monthKey);
            if (!month) {
                month = {};
                monthCache.set(monthKey, month);
            }
            month[dateString] = level;
            saveJsonToFile(monthFilePath(dateString), month);
        });
        return;
    }

    const month = monthCache.get(monthKey);
    month[dateString] = level;
    saveJsonToFile(monthFilePath(dateString), month);
}

/** Clears cached month data; called from the extension's disable(). */
export function clearMoodStoreCache() {
    monthLoadGeneration++;
    monthCache.clear();
    pendingMonthLoads.clear();
}

const MOOD_SEED_DAYS = 30;

export function generateFakeMoodData() {
    const today = GLib.DateTime.new_now_local();
    const todayStr = toDateString(today);
    const months = {};

    let startDate = today.add_days(-(MOOD_SEED_DAYS - 1));
    let day = startDate;
    while (day.compare(today) <= 0) {
        const dateString = toDateString(day);
        const monthKey = monthKeyOf(dateString);
        const existing = monthCache.has(monthKey) ? monthCache.get(monthKey) : null;
        if (existing && existing[dateString] !== undefined) {
            day = day.add_days(1);
            continue;
        }
        if (!months[monthKey]) {
            months[monthKey] = existing ? { ...existing } : {};
        }
        months[monthKey][dateString] = Math.floor(Math.random() * 5) + 1;
        day = day.add_days(1);
    }

    for (const [monthKey, data] of Object.entries(months)) {
        monthCache.set(monthKey, data);
        const [year, month] = monthKey.split('-');
        const filePath = GLib.build_filenamev([getGridgetsDataDir('mood'), year, `${month}.json`]);
        saveJsonToFile(filePath, data);
    }
}

export function listMoodDates(callback) {
    const moodDir = getGridgetsDataDir('mood');
    const dates = [];
    try {
        const dirFile = Gio.File.new_for_path(moodDir);
        if (!dirFile.query_exists(null)) {
            callback([]);
            return;
        }

        dirFile.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (source, res) => {
                try {
                    const enumerator = dirFile.enumerate_children_finish(res);
                    const readNextBatch = () => {
                        enumerator.next_files_async(10, GLib.PRIORITY_DEFAULT, null, (eSrc, eRes) => {
                            try {
                                const files = enumerator.next_files_finish(eRes);
                                if (!files || files.length === 0) {
                                    dates.sort().reverse();
                                    callback(dates);
                                    return;
                                }

                                for (const yearInfo of files) {
                                    if (yearInfo.get_file_type() !== Gio.FileType.DIRECTORY) continue;
                                    const yearName = yearInfo.get_name();
                                    const yearDir = Gio.File.new_for_path(GLib.build_filenamev([moodDir, yearName]));
                                    try {
                                        const monthEnum = yearDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                                        let monthInfo;
                                        while ((monthInfo = monthEnum.next_file(null)) !== null) {
                                            const monthName = monthInfo.get_name();
                                            if (!monthName.endsWith('.json')) continue;
                                            const monthKey = monthName.replace('.json', '');
                                            const fullMonthKey = `${yearName}-${monthKey}`;
                                            const cached = monthCache.get(fullMonthKey);
                                            if (cached) {
                                                for (const dateKey of Object.keys(cached)) {
                                                    if (dateKey.startsWith(fullMonthKey) && cached[dateKey] > 0)
                                                        dates.push(dateKey);
                                                }
                                            }
                                        }
                                    } catch (_) {}
                                }
                                readNextBatch();
                            } catch (_) {
                                dates.sort().reverse();
                                callback(dates);
                            }
                        });
                    };
                    readNextBatch();
                } catch (e) {
                    logError('Error listing mood dates:', e);
                    callback([]);
                }
            }
        );
    } catch (e) {
        logError('Error listing mood dates:', e);
        callback([]);
    }
}

export function listMoodDatesSync() {
    const dates = [];
    for (const [monthKey, contents] of monthCache.entries()) {
        if (typeof contents === 'object' && contents !== null) {
            for (const dateKey of Object.keys(contents)) {
                if (dateKey.startsWith(monthKey) && contents[dateKey] > 0) {
                    dates.push(dateKey);
                }
            }
        }
    }
    dates.sort().reverse();
    return dates;
}