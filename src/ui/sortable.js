// ============ Riordino via drag-drop (nativo, zero dipendenze) ============
// MacBook-only → basta il drag col mouse/trackpad (niente gesti touch).
// Rende ordinabili gli elementi [data-sortid] dentro `list`; a fine trascinamento chiama
// onReorder(idsInNuovoOrdine). I pulsanti azione interni restano cliccabili se marcati
// draggable="false" (impostato nella vista).
export function makeSortable(list, onReorder) {
  if (!list || list.__sortable) return;
  list.__sortable = true;
  let dragEl = null;

  list.querySelectorAll('[data-sortid]').forEach(item => {
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', e => {
      dragEl = item; item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', item.getAttribute('data-sortid')); } catch (_) {}
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging'); dragEl = null;
      list.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
      const ids = [...list.querySelectorAll('[data-sortid]')].map(x => x.getAttribute('data-sortid'));
      onReorder(ids);
    });
  });

  list.addEventListener('dragover', e => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const after = afterElement(list, e.clientY);
    if (after == null) { if (list.lastElementChild !== dragEl) list.appendChild(dragEl); }
    else if (after !== dragEl) list.insertBefore(dragEl, after);
  });
}

function afterElement(list, y) {
  const items = [...list.querySelectorAll('[data-sortid]:not(.dragging)')];
  let closest = null, closestOffset = -Infinity;
  for (const child of items) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = child; }
  }
  return closest;
}
