/** Paint the active marquee selection rectangle. */
export function createCanvasSelectionLayer({ context, interactionState }) {
  function drawSelectionBox() {
    const selectionBox = interactionState.selectionBox;
    if (!selectionBox) return;
    const minX = Math.min(selectionBox.start.x, selectionBox.end.x);
    const maxX = Math.max(selectionBox.start.x, selectionBox.end.x);
    const minY = Math.min(selectionBox.start.y, selectionBox.end.y);
    const maxY = Math.max(selectionBox.start.y, selectionBox.end.y);
    context.save();
    context.setLineDash([6, 4]);
    context.lineWidth = 1;
    context.strokeStyle = "rgba(14, 116, 144, 0.9)";
    context.fillStyle = "rgba(14, 116, 144, 0.12)";
    context.fillRect(minX, minY, maxX - minX, maxY - minY);
    context.strokeRect(minX, minY, maxX - minX, maxY - minY);
    context.restore();
  }

  return Object.freeze({ drawSelectionBox });
}
