import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_WIDTH, height / BASE_HEIGHT));
    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));

    let isDisposed = false;
    let activeCommandsCount = 0;

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
    mainLayout.add_child(headerBox);

    const headerIcon = new St.Icon({
        icon_name: 'utilities-terminal-symbolic',
        style: `color: ${accentHex}; margin-right: 8px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerBox.add_child(headerIcon);

    const headerLabel = new St.Label({
        text: config.customTitle || 'Command Runner',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-weight: bold; opacity: 0.9;`,
    });
    headerLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(headerLabel);

   
    // ── 2. Görgethető Box ──
    const scrollView = new St.ScrollView({
        x_expand: true,
        y_expand: true,
        style_class: 'vfade',
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

    // Alapértelmezett parancslista, ha még üres
    const commandList = Array.isArray(config.commands) && config.commands.length > 0
        ? config.commands
        : [
            { id: '1', label: 'Drop Caches', command: 'sync && echo 3 | sudo tee /proc/sys/vm/drop_caches', inTerminal: false },
            { id: '2', label: 'Disk Health', command: 'df -h /', inTerminal: false },
        ];

    const rowActors = [];

    const updateHeaderStatus = () => {
        if (isDisposed) return;
        if (activeCommandsCount > 0) {
            statusLabel.set_text('RUNNING...');
            statusLabel.style = `${fontCss}color: ${accentHex}; font-size: 10px; font-weight: 800; opacity: 1.0; letter-spacing: 1px;`;
        } else {
            statusLabel.set_text('READY');
            statusLabel.style = `${fontCss}color: ${accentHex}; font-size: 10px; font-weight: 800; opacity: 0.7; letter-spacing: 1px;`;
        }
    };

    // ── 3. Parancssorok létrehozása ──
    commandList.forEach((cmdItem) => {
        const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
        const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

        const rowCard = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: 8px;`,
        });

        // Bal oldal: Futtató gomb
        const runBtn = new St.Button({
            style_class: 'button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.START, // <-- Balra zárás
            y_align: Clutter.ActorAlign.CENTER,
            style: 'padding: 4px 8px;',        // <-- Tiszta, kompakt belső térköz
        });

        const btnBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        const btnIcon = new St.Icon({
            icon_name: cmdItem.inTerminal ? 'utilities-terminal-symbolic' : 'system-run-symbolic',
            style: `color: ${accentHex}; margin-right: 6px;`,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const btnLabel = new St.Label({
            text: cmdItem.label || 'Run',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btnLabel.clutter_text.set_x_align(Clutter.ActorAlign.START);
        btnLabel.clutter_text.set_ellipsize(0);


        const spinner = new Spinner(16); // A paraméter az ikon mérete pixelben
        spinner.y_align = Clutter.ActorAlign.CENTER;
        spinner.hide();

        btnBox.add_child(btnIcon);
        btnBox.add_child(spinner);
        btnBox.add_child(btnLabel);
        btnBox.add_child(new St.Widget({ x_expand: true }));
        runBtn.set_child(btnBox);
        rowCard.add_child(runBtn);

        // Jobb oldal: Monospaced kimenet címke
        const initialText = cmdItem.inTerminal 
            ? (cmdItem.command ? `$ ${cmdItem.command}` : '[Terminal]') 
            : 'Ready';

        const outputLabel = new St.Label({
            text: initialText,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `font-family: monospace; color: ${textColor}; opacity: 0.55; margin-left: 12px;`,
        });
        outputLabel.clutter_text.set_ellipsize(3); // Pango.EllipsizeMode.END
        rowCard.add_child(outputLabel);

        // Végrehajtás logikája
        runBtn.connect('clicked', () => {
            if (!cmdItem.command || !cmdItem.command.trim()) return;

            // KONZOL MÓD
            if (cmdItem.inTerminal) {
                const term = findTerminalEmulator();
                if (!term) {
                    outputLabel.set_text('Error: No terminal found');
                    outputLabel.style = `font-family: monospace; color: #e01b24; opacity: 0.9; margin-left: 10px; font-size: ${outFontSize}px;`;
                    return;
                }

                try {
                    const termProc = new Gio.Subprocess({
                        argv: [term, '--', 'bash', '-c', `${cmdItem.command}; exec bash`],
                        flags: Gio.SubprocessFlags.NONE,
                    });
                    termProc.init(null);
                    // NEM nyúlunk az outputLabel-hez, megmarad az eredeti szöveg!
                } catch (e) {
                    outputLabel.set_text(`Launch error: ${e.message}`);
                    outputLabel.style = `font-family: monospace; color: #e01b24; opacity: 0.9; margin-left: 10px; font-size: ${outFontSize}px;`;
                }
                return;
            }

            // HÁTTÉR MÓD (Aszinkron Gio.Subprocess)
            runBtn.set_reactive(false);
            btnIcon.hide();
            spinner.show();
            spinner.start();

            activeCommandsCount++;
            updateHeaderStatus();

            outputLabel.set_text('Running...');
            outputLabel.style = `font-family: monospace; color: ${textColor}; opacity: 0.7; margin-left: 10px;`;

            try {
                const proc = new Gio.Subprocess({
                    argv: ['bash', '-c', cmdItem.command],
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
                });
                proc.init(null);

                proc.communicate_utf8_async(null, null, (p, res) => {
                    if (isDisposed) return;

                    activeCommandsCount = Math.max(0, activeCommandsCount - 1);
                    updateHeaderStatus();

                    spinner.stop();
                    spinner.hide();
                    btnIcon.show();
                    runBtn.set_reactive(true);

                    try {
                        const [, stdout, stderr] = p.communicate_utf8_finish(res);
                        const isSuccess = p.get_successful();

                        if (isSuccess) {
                            btnIcon.set_icon_name('emblem-ok-symbolic');
                            btnIcon.style = 'color: #33d17a; margin-right: 6px;';

                            const lines = (stdout || '').trim().split('\n').filter(Boolean);
                            const lastLine = lines.length > 0 ? lines[lines.length - 1] : '[OK] Done (no output)';
                            outputLabel.set_text(lastLine);
                            outputLabel.style = `font-family: monospace; color: ${textColor}; opacity: 0.85; margin-left: 10px;`;
                        } else {
                            btnIcon.set_icon_name('dialog-warning-symbolic');
                            btnIcon.style = 'color: #e01b24; margin-right: 6px;';

                            const lines = (stderr || stdout || '').trim().split('\n').filter(Boolean);
                            const lastLine = lines.length > 0 ? lines[lines.length - 1] : '[Error] Exit code != 0';
                            outputLabel.set_text(lastLine);
                            outputLabel.style = `font-family: monospace; color: #e01b24; opacity: 0.9; margin-left: 10px;`;
                        }

                        // 3 másodperc múlva visszaáll az eredeti ikon
                        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                            if (!isDisposed && btnIcon) {
                                btnIcon.set_icon_name('system-run-symbolic');
                                btnIcon.style = `color: ${accentHex}; margin-right: 6px;`;
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    } catch (err) {
                        btnIcon.set_icon_name('dialog-warning-symbolic');
                        btnIcon.style = 'color: #e01b24; margin-right: 6px;';
                        outputLabel.set_text(`Error: ${err.message}`);
                        outputLabel.style = `font-family: monospace; color: #e01b24; opacity: 0.9; margin-left: 10px;`;
                    }
                });
            } catch (err) {
                activeCommandsCount = Math.max(0, activeCommandsCount - 1);
                updateHeaderStatus();
                spinner.stop();
                spinner.hide();
                btnIcon.show();
                runBtn.set_reactive(true);

                outputLabel.set_text(`Spawn error: ${err.message}`);
                outputLabel.style = `font-family: monospace; color: #e01b24; opacity: 0.9; margin-left: 10px;`;
            }
        });

        rowActors.push({
            card: rowCard,
            runBtn,
            btnIcon,
            btnLabel,
            outputLabel,
        });

        listContainer.add_child(rowCard);
    });

    // ── Reszponzív skálázás ──
    function applyScale(newScale) {
        scale = newScale;
        const pad = Math.round(10 * scale);
        const iconSize = Math.round(16 * scale);
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const btnFontSize = Math.max(10, Math.round(12 * scale));
        const outFontSize = Math.max(10, Math.round(11 * scale));
        const cardRadius = Math.max(6, Math.round(8 * scale));

        mainLayout.style = `padding: ${pad}px;`;
        headerBox.style = `margin-bottom: ${Math.round(8 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        listContainer.style = `spacing: ${Math.round(6 * scale)}px;`;

        const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
        const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

        const minBtnWidth = Math.round(130 * scale);
        rowActors.forEach(({ card, runBtn, btnIcon, btnLabel, outputLabel }) => {
            runBtn.style = `min-width: ${minBtnWidth}px; padding: 4px 8px;`;
            card.style = `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: ${cardRadius}px; padding: ${Math.round(4 * scale)}px ${Math.round(6 * scale)}px;`;
            btnIcon.icon_size = Math.round(14 * scale);
            btnLabel.style = `${fontCss}color: ${textColor}; font-size: ${btnFontSize}px; font-weight: bold;`;
            outputLabel.style = `font-family: monospace; color: ${textColor}; font-size: ${outFontSize}px; opacity: 0.7; margin-left: ${Math.round(10 * scale)}px;`;
        });
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_WIDTH, BASE_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w / BASE_WIDTH, h / BASE_HEIGHT)));
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
    });

    return container;
}