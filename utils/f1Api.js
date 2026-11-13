import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1/';
const OPENF1_BASE = 'https://api.openf1.org/v1/';

export const TEAM_COLORS = {
    mclaren: '#F47600',
    ferrari: '#ED1131',
    red_bull: '#4781D7',
    mercedes: '#00D7B6',
    williams: '#1868DB',
    aston_martin: '#229971',
    alpine: '#00A1E8',
    haas: '#9C9FA2',
    rb: '#6C98FF',
    audi: '#F50537',
    sauber: '#52E252',
    cadillac: '#909090',
};

export function getTeamColor(constructorId) {
    return TEAM_COLORS[constructorId] || '#8E8E93';
}

const SESSION_KEYS = [
    ['FirstPractice', 'Practice 1', 'FP1'],
    ['SecondPractice', 'Practice 2', 'FP2'],
    ['ThirdPractice', 'Practice 3', 'FP3'],
    ['SprintQualifying', 'Sprint Qualifying', 'SQ'],
    ['SprintShootout', 'Sprint Shootout', 'SQ'],
    ['Sprint', 'Sprint', 'Sprint'],
    ['Qualifying', 'Qualifying', 'Quali'],
];

let _session = null;
function _getSession() {
    if (!_session) {
        _session = new Soup.Session({ timeout: 15 });
    }
    return _session;
}

let _lastOpenF1CallMs = 0;

function _sleep(ms, cancellable) {
    return new Promise((resolve, reject) => {
        if (cancellable?.is_cancelled()) {
            reject(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Cancelled'));
            return;
        }
        let cancelId = 0;
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            if (cancelId && cancellable) cancellable.disconnect(cancelId);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        if (cancellable) {
            cancelId = cancellable.connect(() => {
                GLib.source_remove(timeoutId);
                reject(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Cancelled'));
            });
        }
    });
}

async function _httpGetJson(url, cancellable = null, isOpenF1 = false) {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (isOpenF1) {
            const now = Date.now();
            const wait = _lastOpenF1CallMs + 420 - now;
            if (wait > 0) await _sleep(wait, cancellable);
            _lastOpenF1CallMs = Date.now();
        }

        const msg = Soup.Message.new('GET', url);
        try {
            const bytes = await new Promise((resolve, reject) => {
                _getSession().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable, (sess, res) => {
                    try {
                        resolve(sess.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const status = msg.get_status();
            if (isOpenF1 && status === 404) return [];
            if (isOpenF1 && status === 429 && attempt === 0) {
                await _sleep(1500, cancellable);
                continue;
            }
            if (status < 200 || status >= 300) {
                throw new Error(`HTTP ${status}`);
            }

            const text = new TextDecoder('utf-8').decode(bytes.get_data());
            return JSON.parse(text);
        } catch (e) {
            if (attempt === 1 || e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                throw e;
            }
        }
    }
    return null;
}

function _parseUtcDate(dateStr, timeStr) {
    const t = timeStr || '00:00:00Z';
    return new Date(`${dateStr}T${t}`);
}

function _makeSession(name, shortName, obj) {
    const start = _parseUtcDate(obj.date, obj.time);
    const isShort = name.startsWith('Sprint Q') || name === 'Sprint Shootout';
    const minutes = name === 'Race' ? 120 : isShort ? 45 : 60;
    const end = new Date(start.getTime() + minutes * 60000);
    return { name, short: shortName, start, end };
}

export function parseNextWeekend(data) {
    const races = data?.MRData?.RaceTable?.Races;
    if (!Array.isArray(races) || races.length === 0) return null;

    const r = races[0];
    const sessions = [];
    for (const [key, name, shortName] of SESSION_KEYS) {
        if (r[key]) {
            sessions.push(_makeSession(name, shortName, r[key]));
        }
    }
    sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
    sessions.push(_makeSession('Race', 'Race', r));

    return {
        round: parseInt(r.round, 10) || 0,
        name: r.raceName || '',
        place: r.Circuit?.Location?.locality || r.Circuit?.circuitName || '',
        sessions,
        race: sessions[sessions.length - 1],
    };
}

export function parseStandings(data) {
    const lists = data?.MRData?.StandingsTable?.StandingsLists;
    if (!Array.isArray(lists) || lists.length === 0) {
        return { afterRound: 0, drivers: [] };
    }

    const afterRound = parseInt(lists[0].round, 10) || 0;
    const rawDrivers = lists[0].DriverStandings || [];
    const drivers = rawDrivers.map(d => {
        const driver = d.Driver || {};
        const constructors = d.Constructors || [];
        const family = driver.familyName || '';
        const code = driver.code || family.slice(0, 3).toUpperCase();
        const team = constructors.length > 0 ? constructors[constructors.length - 1].constructorId : '';
        return {
            position: parseInt(d.position, 10) || 0,
            points: parseFloat(d.points) || 0,
            code,
            family,
            team,
        };
    });

    return { afterRound, drivers };
}

function _getCacheDir() {
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'grid-desktop', 'f1']);
    GLib.mkdir_with_parents(dir, 0o755);
    return dir;
}

function _readJsonFile(path) {
    try {
        const file = Gio.File.new_for_path(path);
        if (!file.query_exists(null)) return null;
        const [ok, contents] = file.load_contents(null);
        if (!ok) return null;
        return JSON.parse(new TextDecoder('utf-8').decode(contents));
    } catch (_) {
        return null;
    }
}

function _writeJsonFile(path, obj) {
    try {
        const file = Gio.File.new_for_path(path);
        const bytes = new TextEncoder().encode(JSON.stringify(obj));
        file.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (_) {}
}

function _normalizeTrack(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const step = Math.max(1, Math.floor(pts.length / 160));
    const out = [];
    for (let i = 0; i < pts.length; i += step) {
        out.push({
            x: Number(((pts[i].x - minX) / span).toFixed(4)),
            y: Number(((maxY - pts[i].y) / span).toFixed(4)),
        });
    }
    return out;
}

async function _fetchTrackOutline(weekend, cancellable) {
    if (!weekend?.race) return null;
    const year = weekend.race.start.getUTCFullYear();
    const meetings = await _httpGetJson(`${OPENF1_BASE}meetings?year=${year}`, cancellable, true);
    if (!Array.isArray(meetings)) return null;

    let circuitKey = -1;
    const raceMs = weekend.race.start.getTime();
    for (const m of meetings) {
        const startMs = new Date(m.date_start).getTime();
        if (raceMs >= startMs - 86400000 && raceMs <= startMs + 5 * 86400000) {
            circuitKey = m.circuit_key;
            break;
        }
    }
    if (!circuitKey || circuitKey < 0) return null;

    const cacheDir = _getCacheDir();
    const trackCachePath = GLib.build_filenamev([cacheDir, `track-${circuitKey}.json`]);
    const cachedTrack = _readJsonFile(trackCachePath);
    if (Array.isArray(cachedTrack) && cachedTrack.length > 10) {
        return cachedTrack;
    }

    const cutoffMs = Date.now() - 3600000;
    const sessions = await _httpGetJson(`${OPENF1_BASE}sessions?circuit_key=${circuitKey}`, cancellable, true);
    if (!Array.isArray(sessions)) return null;

    const validSessions = sessions
        .filter(s => new Date(s.date_end).getTime() < cutoffMs && !(s.session_name || '').startsWith('Day'))
        .sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime())
        .slice(0, 3);

    for (const s of validSessions) {
        const key = s.session_key;
        const laps = await _httpGetJson(`${OPENF1_BASE}laps?session_key=${key}&lap_number=4`, cancellable, true);
        if (!Array.isArray(laps)) continue;

        const cleanLap = laps
            .filter(l => typeof l.lap_duration === 'number' && !l.is_pit_out_lap)
            .sort((a, b) => a.lap_duration - b.lap_duration)[0];

        if (!cleanLap) continue;

        const startIso = cleanLap.date_start;
        const endIso = new Date(new Date(startIso).getTime() + cleanLap.lap_duration * 1000).toISOString();
        const locs = await _httpGetJson(
            `${OPENF1_BASE}location?session_key=${key}&driver_number=${cleanLap.driver_number}&date%3E=${startIso}&date%3C=${endIso}`,
            cancellable,
            true
        );

        if (!Array.isArray(locs) || locs.length < 50) continue;

        const pts = locs.map(p => ({ x: Number(p.x), y: Number(p.y) }));
        const normalized = _normalizeTrack(pts);
        _writeJsonFile(trackCachePath, normalized);
        return normalized;
    }

    return null;
}

export function loadHubCache() {
    const path = GLib.build_filenamev([_getCacheDir(), 'hub-cache.json']);
    const raw = _readJsonFile(path);
    if (!raw?.nextRaw || !raw?.standingsRaw) return null;

    try {
        return {
            weekend: parseNextWeekend(raw.nextRaw),
            standings: parseStandings(raw.standingsRaw),
            track: raw.track || null,
            trackFor: raw.trackFor || null,
        };
    } catch (_) {
        return null;
    }
}

export async function fetchF1HubData(cancellable, existingTrack = null, existingTrackFor = null) {
    const [nextRaw, standingsRaw] = await Promise.all([
        _httpGetJson(`${JOLPICA_BASE}current/next.json`, cancellable, false),
        _httpGetJson(`${JOLPICA_BASE}current/driverStandings.json?limit=5`, cancellable, false),
    ]);

    const weekend = parseNextWeekend(nextRaw);
    const standings = parseStandings(standingsRaw);

    let track = existingTrack;
    let trackFor = existingTrackFor;

    if (weekend && weekend.name !== existingTrackFor) {
        try {
            track = await _fetchTrackOutline(weekend, cancellable);
            trackFor = weekend.name;
        } catch (_) {
            // Ha az OpenF1 épp nem elérhető, a többi adat még megjelenik
        }
    }

    const path = GLib.build_filenamev([_getCacheDir(), 'hub-cache.json']);
    _writeJsonFile(path, { nextRaw, standingsRaw, track, trackFor });

    return { weekend, standings, track, trackFor };
}

export function clearF1Session() {
    if (_session) {
        _session.abort();
        _session = null;
    }
}