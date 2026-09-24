// Viseur personnalisable : réglages -> variables CSS de l'élément .xh (le vrai viseur et l'aperçu des réglages).
export const XH_STYLES = [
  ['cross', 'Croix'], ['crossdot', 'Croix + point'], ['t', 'En T'], ['dot', 'Point'], ['circle', 'Cercle'],
];
export const XH_COLORS = ['#ffffff', '#4dff6a', '#ffe14d', '#4fd1e0', '#ff4df0', '#ff5a5a'];
export const XH_DEFAULT = { style: 'cross', size: 8, gap: 6, thick: 2, color: '#ffffff', outline: true };

// Réglage lu depuis le stockage : on repart des valeurs par défaut pour tout ce qui manque ou est invalide
export function cleanXh(xh) {
  const d = XH_DEFAULT, x = xh && typeof xh === 'object' ? xh : {};
  const num = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : def);
  return {
    style: XH_STYLES.some(([id]) => id === x.style) ? x.style : d.style,
    size: num(x.size, 2, 20, d.size),
    gap: num(x.gap, 0, 16, d.gap),
    thick: num(x.thick, 1, 6, d.thick),
    color: /^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : d.color,
    outline: x.outline === undefined ? d.outline : !!x.outline,
  };
}

export function applyCrosshair(el, xh) {
  const x = cleanXh(xh);
  el.style.setProperty('--xl', `${x.size}px`);
  el.style.setProperty('--xg', `${x.gap}px`);
  el.style.setProperty('--xt', `${x.thick}px`);
  el.style.setProperty('--xc', x.color);
  for (const [id] of XH_STYLES) el.classList.toggle(`s-${id}`, x.style === id);
  el.classList.toggle('no-outline', !x.outline);
}
