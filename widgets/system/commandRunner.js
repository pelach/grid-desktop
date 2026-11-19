import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
    isDarkBackgroundColor,
    resolveWidgetBackgroundColor,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { Spinner } from 'resource:///org/gnome/shell/ui/animation.js';

const BASE_WIDTH = 400;
const BASE_HEIGHT = 200;

const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

const DEFAULT_TILE_COLORS = [
    '#3584e4',
    '#2ec27e',
    '#e66100',
    '#9141ac',
    '#e01b24',
    '#2190a4',
];

function findTerminalEmulator() {
    const terminals = ['gnome-terminal', 'ptyxis', 'kgx', 'x-terminal-emulator'];
    for (const term of terminals) {
        if (GLib.find_program_in_path(term)) {
            return term;
        }
    }
    return null;
}

export function createCommandRunnerNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_WIDTH, height / BASE_HEIGHT));
    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const isTileMode = config.layoutMode === 'tiles';

    let isDisposed = false;
    const cancellable = new Gio.Cancellable();
    const resetTimers = new Set();

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── 1. Egységes Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });
    const headerIcon = new St.Icon({
        icon_name: 'utilities-terminal-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: config.customTitle || 'Command Runner',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-weight: bold; opacity: 0.9;`,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    mainLayout.add_child(headerBox);

    // ── 2. Görgethető Box ──
    const scrollView = new St.ScrollView({
        x_expand: true,
        y_expand: true,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
    });
    mainLayout.add_child(scrollView);

    const listContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    scrollView.add_child(listContainer);

    const commandList = Array.isArray(config.commands) && config.commands.length > 0
        ? config.commands
        : [
            { id: '1', label: 'Drop Caches', command: 'sync && echo 3 | sudo tee /proc/sys/vm/drop_caches', inTerminal: false, color: '#3584e4' },
            { id: '2', label: 'Disk Health', command: 'df -h /', inTerminal: false, color: '#2ec27e' },
        ];

    const rowActors = [];
    const tileActors = [];
    const tileRowBoxes = [];

    const setOutputStatus = (label, text, color = textColor, opacity = 0.7) => {
        if (!label) return;
        const outFontSize = Math.max(10, Math.round(11 * scale));
        const marginLeft = Math.round(10 * scale);
        label.set_text(text);
        label.style = `font-family: monospace; color: ${color}; font-size: ${outFontSize}px; opacity: ${opacity}; margin-left: ${marginLeft}px;`;
    };

    const executeCommand = (cmdItem, { runBtn, btnIcon, spinner, outputLabel, defaultIconName, iconColor, onFinishReset }) => {
        if (!cmdItem.command || !cmdItem.command.trim()) return;

        // KONZOL MÓD
        if (cmdItem.inTerminal) {
            const term = findTerminalEmulator();
            if (!term) {
                setOutputStatus(outputLabel, 'Error: No terminal found', '#e01b24', 0.9);
                return;
            }

            try {
                const termProc = new Gio.Subprocess({
                    argv: [term, '--', 'bash', '-c', `${cmdItem.command}; exec bash`],
                    flags: Gio.SubprocessFlags.NONE,
                });
                termProc.init(null);
            } catch (e) {
                setOutputStatus(outputLabel, `Launch error: ${e.message}`, '#e01b24', 0.9);
            }
            return;
        }

        // HÁTTÉR MÓD
        runBtn.set_reactive(false);
        btnIcon.hide();
        spinner.show();
        spinner.start();
        setOutputStatus(outputLabel, 'Running...', textColor, 0.7);

        const scheduleIconReset = () => {
            const tid = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                resetTimers.delete(tid);
                if (!isDisposed && btnIcon) {
                    btnIcon.set_icon_name(defaultIconName);
                    btnIcon.style = `color: ${iconColor}; margin-right: 6px;`;
                    if (onFinishReset) onFinishReset();
                }
                return GLib.SOURCE_REMOVE;
            });
            resetTimers.add(tid);
        };

        try {
            const proc = new Gio.Subprocess({
                argv: ['bash', '-c', cmdItem.command],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(cancellable);

            proc.communicate_utf8_async(null, cancellable, (p, res) => {
                if (isDisposed) return;

                spinner.stop();
                spinner.hide();
                btnIcon.show();
                runBtn.set_reactive(true);

                try {
                    const [, stdout, stderr] = p.communicate_utf8_finish(res);
                    if (p.get_successful()) {
                        btnIcon.set_icon_name('emblem-ok-symbolic');
                        btnIcon.style = `color: ${isTileMode ? '#ffffff' : '#33d17a'}; margin-right: 6px;`;

                        const lines = (stdout || '').trim().split('\n').filter(Boolean);
                        const lastLine = lines.length > 0 ? lines[lines.length - 1] : '[OK] Done (no output)';
                        setOutputStatus(outputLabel, lastLine, textColor, 0.85);
                    } else {
                        btnIcon.set_icon_name('dialog-warning-symbolic');
                        btnIcon.style = `color: ${isTileMode ? '#ffffff' : '#e01b24'}; margin-right: 6px;`;

                        const lines = (stderr || stdout || '').trim().split('\n').filter(Boolean);
                        const lastLine = lines.length > 0 ? lines[lines.length - 1] : '[Error] Exit code != 0';
                        setOutputStatus(outputLabel, lastLine, '#e01b24', 0.9);
                    }
                    scheduleIconReset();
                } catch (err) {
                    btnIcon.set_icon_name('dialog-warning-symbolic');
                    btnIcon.style = `color: ${isTileMode ? '#ffffff' : '#e01b24'}; margin-right: 6px;`;
                    setOutputStatus(outputLabel, `Error: ${err.message}`, '#e01b24', 0.9);
                    scheduleIconReset();
                }
            });
        } catch (err) {
            spinner.stop();
            spinner.hide();
            btnIcon.show();
            runBtn.set_reactive(true);
            setOutputStatus(outputLabel, `Spawn error: ${err.message}`, '#e01b24', 0.9);
        }
    };

    // ── 3A. CSEMPE MÓD (2 oszlopos színes gombok) ──
    if (isTileMode) {
        for (let i = 0; i < commandList.length; i += 2) {
            const rowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
            });
            rowBox.layout_manager.homogeneous = true;
            tileRowBoxes.push(rowBox);

            const pair = commandList.slice(i, i + 2);
            pair.forEach((cmdItem, pairIdx) => {
                const globalIdx = i + pairIdx;
                const rawColor = cmdItem.color || DEFAULT_TILE_COLORS[globalIdx % DEFAULT_TILE_COLORS.length];
                const tileFg = isDarkBackgroundColor(rawColor) ? '#ffffff' : '#111111';

                const tileBtn = new St.Button({
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                    x_expand: true,
                    y_expand: true,
                });

                const btnContent = new St.BoxLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                });

                const defaultIconName = cmdItem.inTerminal ? 'utilities-terminal-symbolic' : 'system-run-symbolic';
                const btnIcon = new St.Icon({
                    icon_name: defaultIconName,
                    style: `color: ${tileFg}; margin-right: 6px;`,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const btnLabel = new St.Label({
                    text: cmdItem.label || 'Run',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                btnLabel.clutter_text.set_line_wrap(false);
                btnLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

                const spinner = new Spinner(16);
                spinner.y_align = Clutter.ActorAlign.CENTER;
                spinner.hide();

                btnContent.add_child(btnIcon);
                btnContent.add_child(spinner);
                btnContent.add_child(btnLabel);
                tileBtn.set_child(btnContent);

                tileBtn.connect('clicked', () => {
                    executeCommand(cmdItem, {
                        runBtn: tileBtn,
                        btnIcon,
                        spinner,
                        outputLabel: null,
                        defaultIconName,
                        iconColor: tileFg,
                    });
                });

                tileActors.push({
                    tileBtn,
                    btnIcon,
                    btnLabel,
                    rawColor,
                    tileFg,
                });

                rowBox.add_child(tileBtn);
            });

            listContainer.add_child(rowBox);
        }
    } else {
        // ── 3B. LISTA MÓD (Eredeti elrendezés) ──
        commandList.forEach((cmdItem) => {
            const cardBg = cmdItem.color
                ? cssColorToRgba(cmdItem.color, isDarkSurface ? 0.16 : 0.12)
                : cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
            const cardBorderColor = cmdItem.color
                ? cssColorToRgba(cmdItem.color, isDarkSurface ? 0.32 : 0.25)
                : cssColorToRgba(textColor, isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA);

            const rowCard = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `background-color: ${cardBg}; border: 1px solid ${cardBorderColor}; border-radius: 8px;`,
            });

            const runBtn = new St.Button({
                style_class: 'button',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'padding: 4px 8px;',
            });

            const btnBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const defaultIconName = cmdItem.inTerminal ? 'utilities-terminal-symbolic' : 'system-run-symbolic';
            const btnIcon = new St.Icon({
                icon_name: defaultIconName,
                style: `color: ${textColor}; margin-right: 6px;`,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const btnLabel = new St.Label({
                text: cmdItem.label || 'Run',
                y_align: Clutter.ActorAlign.CENTER,
            });
            btnLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

            const spinner = new Spinner(16);
            spinner.y_align = Clutter.ActorAlign.CENTER;
            spinner.hide();

            btnBox.add_child(btnIcon);
            btnBox.add_child(spinner);
            btnBox.add_child(btnLabel);
            runBtn.set_child(btnBox);
            rowCard.add_child(runBtn);

            const initialText = cmdItem.inTerminal
                ? (cmdItem.command ? `$ ${cmdItem.command}` : '[Terminal]')
                : 'Ready';

            const outputLabel = new St.Label({
                text: initialText,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `font-family: monospace; color: ${textColor}; opacity: 0.55; margin-left: 12px;`,
            });
            outputLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            rowCard.add_child(outputLabel);

            runBtn.connect('clicked', () => {
                executeCommand(cmdItem, {
                    runBtn,
                    btnIcon,
                    spinner,
                    outputLabel,
                    defaultIconName,
                    iconColor: textColor,
                });
            });

            rowActors.push({
                card: rowCard,
                runBtn,
                btnIcon,
                btnLabel,
                outputLabel,
                cardBg,
                cardBorderColor,
            });

            listContainer.add_child(rowCard);
        });
    }

    function applyScale(newScale) {
        scale = newScale;
        const iconSize = Math.round(16 * scale);
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const btnFontSize = Math.max(10, Math.round(12 * scale));
        const outFontSize = Math.max(10, Math.round(11 * scale));
        const cardRadius = Math.max(6, Math.round(8 * scale));
        const gap = Math.round(6 * scale);

        mainLayout.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;
        headerBox.style = `margin-bottom: ${Math.round(8 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        listContainer.style = `spacing: ${gap}px;`;

        if (isTileMode) {
            const tileRadius = Math.max(8, Math.round(12 * scale));
            const tilePadV = Math.max(8, Math.round(10 * scale));
            const tilePadH = Math.max(8, Math.round(10 * scale));

            tileRowBoxes.forEach((rowBox) => {
                rowBox.style = `spacing: ${gap}px;`;
            });

            tileActors.forEach(({ tileBtn, btnIcon, btnLabel, rawColor, tileFg }) => {
                const bgRgba = cssColorToRgba(rawColor, 0.88);
                const borderRgba = cssColorToRgba(tileFg, 0.14);
                tileBtn.style = `background-color: ${bgRgba}; border: 1px solid ${borderRgba}; border-radius: ${tileRadius}px; padding: ${tilePadV}px ${tilePadH}px;`;
                btnIcon.icon_size = Math.round(16 * scale);
                btnIcon.style = `color: ${tileFg}; margin-right: 6px;`;
                btnLabel.style = `${fontCss}color: ${tileFg}; font-size: ${btnFontSize}px; font-weight: bold;`;
            });
        } else {
            const maxBtnWidth = Math.round(150 * scale);

            rowActors.forEach(({ card, runBtn, btnIcon, btnLabel, outputLabel, cardBg, cardBorderColor }) => {
                runBtn.style = `max-width: ${maxBtnWidth}px; padding: 4px 8px;`;
                card.style = `background-color: ${cardBg}; border: 1px solid ${cardBorderColor}; border-radius: ${cardRadius}px; padding: ${Math.round(4 * scale)}px ${Math.round(6 * scale)}px;`;
                btnIcon.icon_size = Math.round(14 * scale);
                btnLabel.style = `${fontCss}color: ${textColor}; font-size: ${btnFontSize}px; font-weight: bold;`;
                outputLabel.style = `font-family: monospace; color: ${textColor}; font-size: ${outFontSize}px; opacity: 0.7; margin-left: ${Math.round(10 * scale)}px;`;
            });
        }
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_WIDTH, BASE_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w / BASE_WIDTH, h / BASE_HEIGHT)));
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        cancellable.cancel();
        for (const tid of resetTimers) {
            GLib.Source.remove(tid);
        }
        resetTimers.clear();
    });

    return container;
}