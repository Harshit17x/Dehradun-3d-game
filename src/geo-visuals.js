export const VISUAL_MODES = Object.freeze({ DAY: 'day', NIGHT: 'night' });

const THEMES = Object.freeze({
  day: Object.freeze({
    label: 'Daylight', background: '#b8ced0', fog: '#c8d8d7', ground: '#aebb9f', road: '#424a4a',
    marking: '#f5f1df', boundary: '#d7b65c', boundaryEmissive: '#786128', skyLight: '#e4f1ff',
    groundLight: '#68745f', skyIntensity: 2.2, sun: '#fff0d4', sunIntensity: 3, fogNear: 100, fogFar: 610,
  }),
  night: Object.freeze({
    label: 'Night drive', background: '#08141d', fog: '#0d1c26', ground: '#182925', road: '#252d30',
    marking: '#a6c2bd', boundary: '#43c8b0', boundaryEmissive: '#087c70', skyLight: '#29415a',
    groundLight: '#07110f', skyIntensity: .72, sun: '#6e86b1', sunIntensity: .18, fogNear: 55, fogFar: 330,
  }),
});

export function normalizeVisualMode(value) {
  return String(value).toLowerCase() === VISUAL_MODES.NIGHT ? VISUAL_MODES.NIGHT : VISUAL_MODES.DAY;
}

export function getVisualTheme(value = VISUAL_MODES.DAY) {
  return THEMES[normalizeVisualMode(value)];
}
