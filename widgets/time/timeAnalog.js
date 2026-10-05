import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import { resolveWidgetForegroundColor, cssColorToRgba } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, startMinuteAlignedTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CLOCK_SIZE = 160;
const BORDER_ALPHA = 0.14;
const DEFAULT_SKIN = 'basic';

function getSkinFileUri(skinName, fileName) {
    const currentDir = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
    const filePath = `${currentDir}/skins/${skinName}/${fileName}`;
    const file = Gio.File.new_for_path(filePath);
    
    let mtime = Date.now();
    try {
        const info = file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        mtime = info.get_attribute_uint64('time::modified');
    } catch (e) {}

    return `file://${filePath}?v=${mtime}`;
}

function skinFilesExist(skinName, fileNames) {
    const currentDir = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
    for (const fileName of fileNames) {
        const filePath = `${currentDir}/skins/${skinName}/${fileName}`;
        const file = Gio.File.new_for_path(filePath);
        if (!file.query_exists(null)) {
            log(`[Gridgets Clock] Hiányzó kötelező skin fájl: ${filePath}`);
            return false;
        }
    }
    return true;
}

function loadSkinConfigAsync(skinName) {
    return new Promise((resolve) => {
        try {
            const currentDir = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
            const configPath = `${currentDir}/skins/${skinName}/skin.json`;
            const configFile = Gio.File.new_for_path(configPath);

            configFile.load_contents_async(null, (file, res) => {
                try {
                    const [ok, contents] = file.load_contents_finish(res);
                    if (ok) {
                        resolve(JSON.parse(new TextDecoder().decode(contents)));
                        return;
                    }
                } catch (e) {
                    // Ha nincs fájl vagy hibás a JSON
                }
                resolve(null);
            });
        } catch (e) {
            resolve(null);
        }
    });
}

function createHandIcon(skinName, fileName, size, isRotatable = false) {
    const fileUri = getSkinFileUri(skinName, fileName);
    const gfile = Gio.File.new_for_uri(fileUri);
    const icon = new St.Icon({
        gicon: new Gio.FileIcon({ file: gfile }),
        icon_size: size,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    if (isRotatable) {
        icon.set_pivot_point(0.5, 0.5);
    }
    return icon;
}

function updateHands(hands, showSecondHand, dateLabel = null) {
    const now = GLib.DateTime.new_now_local();
    const sec = showSecondHand ? now.get_second() : 0;
    const min = now.get_minute();
    const hour = now.get_hour() % 12;

    const minAngle = min * 6 + (sec * 0.1);
    const hourAngle = hour * 30 + (min * 0.5);

    hands.hour.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, hourAngle);
    hands.minute.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, minAngle);

    if (showSecondHand && hands.second) {
        const secAngle = sec * 6;
        hands.second.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, secAngle);
    }

    if (dateLabel) {
        dateLabel.set_text(now.get_day_of_month().toString());
    }
}

export function createAnalogTimeNode(widgetData, width, height, xPosition, yPosition) {
    const skinName = widgetData?.skin || DEFAULT_SKIN;

    const requiredFiles = [
        'background.svg',
        'hour_hand.svg',
        'minute_hand.svg',
        'second_hand.svg'
    ];

    if (!skinFilesExist(skinName, requiredFiles)) {
        return null;
    }

    const textColor = resolveWidgetForegroundColor(widgetData);
    const showSecondHand = widgetData.showSecondHand !== false;
    const showBackground = widgetData.showBackground !== false;
    const showDate = widgetData.showDate !== false;

    let skinConfig = null;

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    if (!showBackground) {
        widgetNode.style += ' background-color: transparent; border: none; box-shadow: none;';
    } else {
        widgetNode.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;
    }

    // Felesleges StBin eltávolítva: a widgetNode (BinLayout) közvetlenül kezeli a konténert
    const clockContainer = new St.Widget({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    widgetNode.add_child(clockContainer);

    let hands = null;
    let dateLabel = null;

    const buildClockElements = (size) => {
        clockContainer.destroy_all_children();
        clockContainer.set_size(size, size);

        dateLabel = null;
        if (showDate && skinConfig?.dateWindow) {
            const dw = skinConfig.dateWindow;
            const w = Math.round(size * (dw.width || 0.12));
            const h = Math.round(size * (dw.height || 0.08));
            const x = Math.round(size * dw.x - w / 2);
            const y = Math.round(size * dw.y - h / 2);
            const fontPx = Math.max(8, Math.round(size * (dw.fontSize || 0.06)));

            const dateBox = new St.Widget({
                width: w,
                height: h,
                x: x,
                y: y,
                layout_manager: new Clutter.BinLayout(),
                style: `background-color: ${dw.bgColor || 'transparent'}; border-radius: 2px;`,
            });

            const fontFamily = dw.fontFamily ? `font-family: "${dw.fontFamily}";` : '';

            dateLabel = new St.Label({
                text: '',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: `color: ${dw.color || textColor}; font-size: ${fontPx}px; font-weight: bold; ${fontFamily}`,
            });

            dateBox.add_child(dateLabel);
            clockContainer.add_child(dateBox);
        }

        const background = createHandIcon(skinName, 'background.svg', size, false);
        clockContainer.add_child(background);

        const hourHand = createHandIcon(skinName, 'hour_hand.svg', size, true);
        const minuteHand = createHandIcon(skinName, 'minute_hand.svg', size, true);

        clockContainer.add_child(hourHand);
        clockContainer.add_child(minuteHand);

        let secondHand = null;
        if (showSecondHand) {
            secondHand = createHandIcon(skinName, 'second_hand.svg', size, true);
            clockContainer.add_child(secondHand);
        }

        const capFileUri = getSkinFileUri(skinName, 'cap.svg');
        const capFile = Gio.File.new_for_uri(capFileUri);
        if (capFile.query_exists(null)) {
            const capIcon = createHandIcon(skinName, 'cap.svg', size, false);
            clockContainer.add_child(capIcon);
        }
        
        hands = {
            hour: hourHand,
            minute: minuteHand,
            second: secondHand,
        };

        // Késleltetjük a mutatók első elforgatását egy ciklussal, hogy a méretezés előbb lefusson
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!isActorDestroyed(widgetNode) && hands) {
                updateHands(hands, showSecondHand, dateLabel);
            }
            return GLib.SOURCE_REMOVE;
        });
    };

    let isBuilding = false;
    const applyScale = (curW = widgetNode.width || width, curH = widgetNode.height || height) => {
        if (isActorDestroyed(widgetNode) || isBuilding) return;
        if (!curW || !curH || curW <= 0 || curH <= 0) return;

        isBuilding = true;
        const availableSpace = Math.min(curW, curH) * 0.88;
        const scaledSize = Math.max(32, Math.round(availableSpace));
        buildClockElements(scaledSize);
        isBuilding = false;
    };

    const state = {
        timerId: null,
    };

    const updateDisplay = () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        if (hands) updateHands(hands, showSecondHand, dateLabel);
        return GLib.SOURCE_CONTINUE;
    };

    // Bőr konfiguráció aszinkron betöltése
    loadSkinConfigAsync(skinName).then((cfg) => {
        if (isActorDestroyed(widgetNode)) return;
        skinConfig = cfg;
       
    });

    if (showSecondHand) {
        state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, updateDisplay);
    } else {
        startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    }

    connectTimerCleanup(widgetNode, state);
    
    attachResponsiveScaler(widgetNode, BASE_CLOCK_SIZE, BASE_CLOCK_SIZE, (_scale, curW, curH) => {
        if (isActorDestroyed(widgetNode)) return;
        applyScale(curW, curH);
    });

    return widgetNode;
}