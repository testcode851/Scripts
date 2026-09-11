/** Bind window resize and focus-loss behavior. */
export function bindFeatureWindowEvents({ windowRoot, listen, actions }) {
  listen(windowRoot, "resize", () => {
    actions.resizeCanvasToImage();
    actions.closeCanvasContextMenu();
    if (actions.isCanvasLabelEditorOpen()) {
      actions.positionCanvasLabelEditor(actions.getActiveLabelAnchor());
    }
    actions.redraw();
  });
  listen(windowRoot, "blur", () => {
    actions.closeCanvasContextMenu();
    actions.endPointerInteraction();
  });
}
