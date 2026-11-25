// DOM opbouwen zonder innerHTML. De CSP dwingt trusted types af, dus
// innerHTML en vergelijkbare constructies zijn geblokkeerd; tekst komt altijd
// als tekst in de pagina, nooit als HTML.

// el('p', {class: 'x', onclick: fn}, 'tekst', kindElement)
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'hidden') node.hidden = true;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key.startsWith('on') || key === 'style') {
      throw new Error('Niet toegestaan attribuut: ' + key);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

// Vervangt de inhoud van een element.
export function replace(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}
