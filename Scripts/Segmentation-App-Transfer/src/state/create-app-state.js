/** Create the independently owned state slices used by application services. */
export function createAppState(defaultSettings) {
  const slices = {
    image: {
      image: null,
      imageName: "",
      imageSize: null,
      imageFileSizeBytes: null,
      imageFileType: "",
      imageLastModified: null,
      imageLoadStatus: "idle",
      imageLoadProgress: 0,
      imageLoadMessage: "",
      equalizedImage: null,
      imageAnalysisOriginal: null,
      imageAnalysisEqualized: null,
    },
    annotations: {
      annotations: [],
      lastPolygonLabel: "polygon",
      lastEllipseLabel: "ellipse",
      lastShapeColor: "",
      annotationTimerRunning: false,
      annotationStartedAt: null,
      annotationEndedAt: null,
      annotationElapsedMs: 0,
      annotationLastStartedMs: null,
    },
    interaction: {
      tool: "polygon",
      currentPolygon: [],
      currentCurveControl: null,
      curveSegmentMode: false,
      ellipseDraft: null,
      rectangleDraft: null,
      isDrawing: false,
      vertexEditEnabled: false,
      activeVertex: null,
      activeAnnotationDrag: null,
      selectedVertexKeys: new Set(),
      selectionBox: null,
      selectionMode: "replace",
      selectedAnnotationId: null,
      cursorImagePos: null,
      panModeEnabled: false,
      isPanning: false,
      panStartPoint: null,
      panStartOffset: null,
    },
    view: {
      imageScale: 1,
      viewZoom: 1,
      viewOffsetX: 0,
      viewOffsetY: 0,
      fitWindowActive: false,
    },
    settings: {
      ...defaultSettings,
      outputFormat: "llnl",
    },
    ui: {
      activeLabelEdit: null,
    },
  };

  return slices;
}
