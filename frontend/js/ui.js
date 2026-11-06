/** Shared UI helpers (DOM building + labels). */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const SLOT_LABEL = {
  body: 'Cuerpo',
  head: 'Cabeza',
  hand: 'Manos',
  foot: 'Pies',
  horse: 'Montura',
  shield: 'Escudo',
  goods: 'Mercancía',
};

export const CATEGORY_LABEL = {
  armor: 'Armadura',
  clothing: 'Ropa',
  cape: 'Capa',
  other: 'Otro',
};

/** Warband stores spaces as `_`; show readable names without touching ids. */
export function displayName(name) {
  return String(name).replace(/_/g, ' ');
}

export function badge(text, tone = '') {
  return el('span', { class: `badge ${tone}`.trim(), text });
}

export function stat(label, value, accent = false) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: `value${accent ? ' accent' : ''}`, text: String(value) }),
  ]);
}

export function shortPath(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  return parts.slice(-2).join('/');
}

export function emptyState(title, message, icon = '◈') {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'empty-icon', text: icon }),
    el('h2', { text: title }),
    el('p', { text: message }),
  ]);
}
