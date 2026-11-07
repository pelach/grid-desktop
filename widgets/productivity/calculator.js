import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import {
    resolveExplicitFontFamily,
    resolveWidgetForegroundColor,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';

import {
    createWidgetContainer,
    attachResponsiveScaler,
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 400;

const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;
const LABEL_OPACITY = 0.65;

export function createCalculatorNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBgAlpha = isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA;
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    // Fő konténer
    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // ── 1. Egységes Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const headerIcon = new St.Icon({
        icon_name: 'accessories-calculator-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Calculator',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // ── 2. Kijelző (Nem kattintható doboz, mint a batteryStatus kártya) ──
    const displayBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.FILL,
    });
    contentBox.add_child(displayBox);

    const historyLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    historyLabel.clutter_text.set_ellipsize(1);

    const mainDisplayLabel = new St.Label({
        text: '0',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    mainDisplayLabel.clutter_text.set_ellipsize(1);

    displayBox.add_child(historyLabel);
    displayBox.add_child(mainDisplayLabel);

    // ── 3. Gombsor Konténer ──
    const keypadBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    contentBox.add_child(keypadBox);

    // Gombok konfigurációja: 5 sor × 4 oszlop
    const BUTTON_LAYOUT = [
        [
            { label: 'C',  type: 'action', key: 'clear' },
            { label: '±',  type: 'action', key: 'negate' },
            { label: '%',  type: 'action', key: 'percent' },
            { label: '÷',  type: 'op',     key: '/' }
        ],
        [
            { label: '7',  type: 'num',    key: '7' },
            { label: '8',  type: 'num',    key: '8' },
            { label: '9',  type: 'num',    key: '9' },
            { label: '×',  type: 'op',     key: '*' }
        ],
        [
            { label: '4',  type: 'num',    key: '4' },
            { label: '5',  type: 'num',    key: '5' },
            { label: '6',  type: 'num',    key: '6' },
            { label: '−',  type: 'op',     key: '-' }
        ],
        [
            { label: '1',  type: 'num',    key: '1' },
            { label: '2',  type: 'num',    key: '2' },
            { label: '3',  type: 'num',    key: '3' },
            { label: '+',  type: 'op',     key: '+' }
        ],
        [
            { label: '0',  type: 'num',    key: '0', flex: 2 },
            { label: '.',  type: 'num',    key: '.' },
            { label: '=',  type: 'equal',  key: '=' }
        ]
    ];

    // Számológép belső állapotgép
    let currentValue = '0';
    let previousValue = null;
    let pendingOperator = null;
    let resetInputOnNextDigit = false;

    function updateDisplay() {
        mainDisplayLabel.text = currentValue;
        if (pendingOperator && previousValue !== null) {
            const opSymbol = pendingOperator === '*' ? '×' : (pendingOperator === '/' ? '÷' : (pendingOperator === '-' ? '−' : '+'));
            historyLabel.text = `${previousValue} ${opSymbol}`;
        } else {
            historyLabel.text = '';
        }
    }

    function calculateResult(a, b, op) {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (isNaN(numA) || isNaN(numB)) return '0';

        let res = 0;
        switch (op) {
            case '+': res = numA + numB; break;
            case '-': res = numA - numB; break;
            case '*': res = numA * numB; break;
            case '/': 
                if (numB === 0) return 'Error';
                res = numA / numB; 
                break;
            default: return b;
        }

        // Lebegőpontos kerekítés (pl. 0.1 + 0.2 pontatlanság kiküszöbölése)
        return String(Math.round(res * 100000000) / 100000000);
    }

    function handleKeyPress(btnDef) {
        const { key, type } = btnDef;

        if (type === 'num') {
            if (key === '.') {
                if (resetInputOnNextDigit) {
                    currentValue = '0.';
                    resetInputOnNextDigit = false;
                } else if (!currentValue.includes('.')) {
                    currentValue += '.';
                }
            } else {
                if (currentValue === '0' || resetInputOnNextDigit) {
                    currentValue = key;
                    resetInputOnNextDigit = false;
                } else {
                    if (currentValue.length < 12) {
                        currentValue += key;
                    }
                }
            }
        } else if (type === 'action') {
            if (key === 'clear') {
                currentValue = '0';
                previousValue = null;
                pendingOperator = null;
                resetInputOnNextDigit = false;
            } else if (key === 'negate') {
                if (currentValue !== '0' && currentValue !== 'Error') {
                    currentValue = currentValue.startsWith('-') ? currentValue.slice(1) : '-' + currentValue;
                }
            } else if (key === 'percent') {
                const val = parseFloat(currentValue);
                if (!isNaN(val)) {
                    currentValue = String(val / 100);
                }
            }
        } else if (type === 'op') {
            if (pendingOperator && !resetInputOnNextDigit) {
                currentValue = calculateResult(previousValue, currentValue, pendingOperator);
            }
            previousValue = currentValue;
            pendingOperator = key;
            resetInputOnNextDigit = true;
        } else if (type === 'equal') {
            if (pendingOperator && previousValue !== null) {
                currentValue = calculateResult(previousValue, currentValue, pendingOperator);
                previousValue = null;
                pendingOperator = null;
                resetInputOnNextDigit = true;
            }
        }

        updateDisplay();
    }

    // ── Gombok felépítése és dinamikus stílusozása ──
    const buttonActors = [];

    BUTTON_LAYOUT.forEach(rowDef => {
        const rowBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_expand: true,
        });

        rowDef.forEach(btnDef => {
            const btn = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: false,
                y_expand: true,
            });


            const label = new St.Label({
                text: btnDef.label,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });

            btn.set_child(label);
            btn.connect('clicked', () => handleKeyPress(btnDef));

            buttonActors.push({ btn, label, btnDef });
            rowBox.add_child(btn);
        });

        keypadBox.add_child(rowBox);
    });

    function applyScale(newScale) {
        scale = newScale;

        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const historyFontSize = Math.max(10, Math.round(11 * scale));
        const mainDisplayFontSize = Math.max(18, Math.round(22 * scale));
        const keypadFontSize = Math.max(12, Math.round(14 * scale));

        const cardRadius = Math.max(6, Math.round(10 * scale));
        const padding = Math.max(6, Math.round(8 * scale));
        const gap = Math.max(3, Math.round(4 * scale));

        // Fejléc
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;
        contentBox.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;

        // Kijelző (batteryStatus nem-kattintható felület mintájára)
        const dispBg = cssColorToRgba(textColor, cardBgAlpha);
        const dispBorder = cssColorToRgba(textColor, cardBorderAlpha);
        displayBox.style = `background-color: ${dispBg}; `
            + `border: 1px solid ${dispBorder}; `
            + `border-radius: ${cardRadius}px; `
            + `padding: ${padding}px; `
            + `margin-bottom: ${Math.round(8 * scale)}px;`;

        historyLabel.style = `${fontCss}color: ${textColor}; font-size: ${historyFontSize}px; opacity: ${LABEL_OPACITY};`;
        mainDisplayLabel.style = `${fontCss}color: ${textColor}; font-size: ${mainDisplayFontSize}px; font-weight: bold;`;

        // Gombsor térközök és gombok stílusa (audioOutput mintájára)
        keypadBox.style = `spacing: ${gap}px;`;

        const availableWidth = width - (Math.max(8, Math.round(10 * scale)) * 2);
        // 4 oszlop van, köztük 3 darab rés (gap)
        const singleBtnWidth = Math.floor((availableWidth - (3 * gap)) / 4);
        // A dupla gomb: 2 normál gomb + 1 rés
        const doubleBtnWidth = (singleBtnWidth * 2) + gap;

        buttonActors.forEach(({ btn, label, btnDef }) => {
            const isHighlighted = btnDef.type === 'op' || btnDef.type === 'equal' || btnDef.type === 'action';
            const btnWidth = (btnDef.flex === 2) ? doubleBtnWidth : singleBtnWidth;

            btn.width = btnWidth; // St.Widget / Clutter.Actor tulajdonság!

            const bg = isHighlighted 
                ? cssColorToRgba(textColor, 0.15) 
                : cssColorToRgba(textColor, cardBgAlpha);
            const border = isHighlighted 
                ? cssColorToRgba(textColor, 0.25) 
                : cssColorToRgba(textColor, cardBorderAlpha);

            btn.style = `background-color: ${bg}; `
                + `border: 1px solid ${border}; `
                + `border-radius: ${cardRadius}px; `
                + `margin: ${Math.round(gap / 2)}px;`;

            label.style = `${fontCss}color: ${textColor}; font-size: ${keypadFontSize}px; font-weight: ${isHighlighted ? 'bold' : '500'};`;
        });
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}