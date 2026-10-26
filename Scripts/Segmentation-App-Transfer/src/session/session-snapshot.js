import { normalizeCalibration } from "../analytics/analytics-data.js";
import { getValidCurveSampling, parseCurveSampling } from "../geometry/curve-sampling.js";
import { cloneCocoIdentity, validateCocoIdentityCollection } from "../model/coco-identity.js";
import { normalizeEditorMetadata } from "../model/annotation-review.js";

const fail = (message) => { throw new Error(`Invalid saved session: ${message}`); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function text(value, name, { nonempty = false } = {}) {
  if (typeof value !== "string" || (nonempty && !value.trim())) fail(`${name} must be text.`);
  return value;
}

function number(value, name, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) fail(`${name} must be a finite number.`);
  return value;
}

function color(value, name) {
  if (typeof value !== "string" || (value !== "" && !/^#?[0-9a-f]{6}$/i.test(value))) {
    fail(`${name} must be a hexadecimal color.`);
  }
  return value;
}

function point(value) {
  if (!isObject(value)) fail("a point is missing.");
  return { x: number(value.x, "Point x"), y: number(value.y, "Point y") };
}

function draftClassChoice(value) {
  if (!isObject(value) || !Number.isSafeInteger(value.id) || value.id < 0) {
    fail("the polygon draft class ID is invalid.");
  }
  return { id: value.id, name: text(value.name, "Polygon draft class name", { nonempty: true }).trim() };
}

function polygonPoint(value) {
  const result = point(value);
  if (Object.hasOwn(value, "curveFrom")) result.curveFrom = point(value.curveFrom);
  return result;
}

function points(value, minimum) {
  if (!Array.isArray(value) || value.length < minimum) fail("polygon points are incomplete.");
  return Array.from(value, polygonPoint);
}

function imageSize(value) {
  if (!isObject(value) || !Number.isFinite(value.width) || !Number.isFinite(value.height)
    || value.width <= 0 || value.height <= 0) fail("image dimensions are invalid.");
  return { width: value.width, height: value.height };
}

function annotation(value) {
  if (!isObject(value) || !isObject(value.geometry)) fail("an annotation is missing its geometry.");
  const result = {
    id: text(value.id, "Annotation ID", { nonempty: true }),
    type: value.type,
    label: text(value.label, "Annotation label"),
    color: color(value.color, "Annotation color"),
  };
  if (value.type === "polygon") {
    if (Object.hasOwn(value, "coco")) result.coco = cloneCocoIdentity(value.coco);
    result.geometry = { points: points(value.geometry.points, 3) };
    if (Object.hasOwn(value.geometry, "curveSampling")) {
      result.geometry.curveSampling = parseCurveSampling(value.geometry.curveSampling, result.geometry.points);
    }
  } else if (value.type === "ellipse") {
    if (Object.hasOwn(value, "coco")) fail("an ellipse cannot carry polygon COCO identity.");
    const geometry = value.geometry;
    result.geometry = {
      cx: number(geometry.cx, "Ellipse center x"),
      cy: number(geometry.cy, "Ellipse center y"),
      // Existing vertex editing can collapse a saved ellipse to a line or point.
      rx: number(geometry.rx, "Ellipse horizontal radius", 0),
      ry: number(geometry.ry, "Ellipse vertical radius", 0),
      rotation: number(geometry.rotation, "Ellipse rotation"),
    };
  } else fail("an annotation type is unsupported.");
  if (Object.hasOwn(value, "editor")) {
    try {
      const editor = normalizeEditorMetadata(value.editor);
      if (editor) result.editor = editor;
    } catch (error) { fail(error.message); }
  }
  return result;
}

function palette(value) {
  if (!Array.isArray(value)) fail("label colors are missing.");
  const labels = new Set();
  return Array.from(value, (entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !isObject(entry[1])) fail("a label color is invalid.");
    const label = text(entry[0], "Palette label", { nonempty: true });
    if (labels.has(label)) fail("palette labels must be unique.");
    labels.add(label);
    const rgb = {};
    for (const channel of ["r", "g", "b"]) {
      rgb[channel] = number(entry[1][channel], "Color channel", 0);
      if (rgb[channel] > 255) fail("color channels cannot exceed 255.");
    }
    return [label, rgb];
  });
}

function date(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("timer dates are invalid.");
  return value;
}

/** Validate the complete saved document before installing any recovered state. */
export function validateSessionSnapshot(snapshot, imageMeta) {
  if (!isObject(snapshot) || snapshot.version !== 1) fail("the saved format is unsupported.");
  const size = snapshot.imageSize === null ? null : imageSize(snapshot.imageSize);
  if (imageMeta != null) {
    const originalSize = imageSize(imageMeta);
    if (size?.width !== originalSize.width || size?.height !== originalSize.height) {
      fail("annotations do not match the saved image dimensions.");
    }
  }
  if (!Array.isArray(snapshot.annotations)) fail("annotations are missing.");
  const annotations = Array.from(snapshot.annotations, annotation);
  validateCocoIdentityCollection(annotations);
  const ids = new Set(annotations.map((item) => item.id));
  if (ids.size !== annotations.length) fail("annotation IDs must be unique.");
  let calibration = null;
  if (snapshot.calibration !== null) {
    calibration = normalizeCalibration(snapshot.calibration, size);
    if (!calibration) fail("calibration does not match the image.");
  }
  const draft = snapshot.polygonDraft;
  if (!isObject(draft) || ![null, "polygon"].includes(draft.tool)
    || typeof draft.curveSegmentMode !== "boolean") fail("the polygon draft is invalid.");
  const currentPolygon = points(draft.currentPolygon, 0);
  const classChoice = Object.hasOwn(draft, "classChoice") ? draftClassChoice(draft.classChoice) : null;
  const currentCurveControl = draft.currentCurveControl === null ? null : point(draft.currentCurveControl);
  if ((currentPolygon.length > 0 && draft.tool !== "polygon")
    || (!currentPolygon.length && (currentCurveControl || draft.curveSegmentMode || classChoice))) {
    fail("the polygon draft is inconsistent.");
  }
  if (!isObject(snapshot.timer)) fail("the annotation timer is missing.");
  return {
    version: 1,
    imageName: text(snapshot.imageName, "Image name"),
    imageSize: size,
    calibration,
    annotations,
    lastPolygonLabel: text(snapshot.lastPolygonLabel, "Last polygon label"),
    lastEllipseLabel: text(snapshot.lastEllipseLabel, "Last ellipse label"),
    lastShapeColor: color(snapshot.lastShapeColor, "Last shape color"),
    labelColorAssignments: palette(snapshot.labelColorAssignments),
    polygonDraft: {
      tool: draft.tool, currentPolygon, currentCurveControl, curveSegmentMode: draft.curveSegmentMode,
      ...(classChoice ? { classChoice } : {}),
    },
    timer: {
      startedAt: date(snapshot.timer.startedAt),
      endedAt: date(snapshot.timer.endedAt),
      elapsedMs: number(snapshot.timer.elapsedMs, "Elapsed annotation time", 0),
    },
  };
}

/** Capture committed geometry and fixed polygon vertices without retaining live state. */
export function captureSessionSnapshot({ imageState, annotationState, interactionState, labelColorAssignments, now = Date.now() }) {
  const currentPolygon = interactionState.currentPolygon || [];
  const hasDraft = currentPolygon.length > 0;
  const elapsed = Math.max(0, annotationState.annotationElapsedMs || 0);
  const runningElapsed = annotationState.annotationTimerRunning && Number.isFinite(annotationState.annotationLastStartedMs)
    ? Math.max(0, now - annotationState.annotationLastStartedMs) : 0;
  const annotations = annotationState.annotations.map((item) => {
    if (item.type !== "polygon") return item;
    const records = getValidCurveSampling(item.geometry);
    return { ...item, geometry: { points: item.geometry.points, ...(records.length ? { curveSampling: records } : {}) } };
  });
  return validateSessionSnapshot({
    version: 1,
    imageName: imageState.imageName,
    imageSize: imageState.imageSize,
    calibration: imageState.calibration || null,
    annotations,
    lastPolygonLabel: annotationState.lastPolygonLabel,
    lastEllipseLabel: annotationState.lastEllipseLabel,
    lastShapeColor: annotationState.lastShapeColor,
    labelColorAssignments: [...labelColorAssignments],
    polygonDraft: {
      tool: hasDraft ? "polygon" : null,
      currentPolygon,
      currentCurveControl: hasDraft ? interactionState.currentCurveControl || null : null,
      curveSegmentMode: hasDraft && Boolean(interactionState.curveSegmentMode),
      ...(hasDraft && interactionState.currentPolygonClass
        ? { classChoice: interactionState.currentPolygonClass } : {}),
    },
    timer: {
      startedAt: annotationState.annotationStartedAt || null,
      endedAt: annotationState.annotationEndedAt || null,
      elapsedMs: elapsed + runningElapsed,
    },
  }, imageState.image ? { width: imageState.image.width, height: imageState.image.height } : undefined);
}

/** Restore document data with a paused timer and no active pointer interaction. */
export function applySessionSnapshot(snapshot, { imageState, annotationState, interactionState, labelColorAssignments }) {
  const saved = validateSessionSnapshot(snapshot, imageState.image
    ? { width: imageState.image.width, height: imageState.image.height } : undefined);
  Object.assign(imageState, { imageName: saved.imageName, imageSize: saved.imageSize, calibration: saved.calibration });
  Object.assign(annotationState, {
    annotations: saved.annotations,
    lastPolygonLabel: saved.lastPolygonLabel,
    lastEllipseLabel: saved.lastEllipseLabel,
    lastShapeColor: saved.lastShapeColor,
    annotationTimerRunning: false,
    annotationStartedAt: saved.timer.startedAt,
    annotationEndedAt: saved.timer.endedAt,
    annotationElapsedMs: saved.timer.elapsedMs,
    annotationLastStartedMs: null,
  });
  labelColorAssignments.clear();
  for (const [label, rgb] of saved.labelColorAssignments) labelColorAssignments.set(label, rgb);
  Object.assign(interactionState, {
    tool: saved.polygonDraft.tool || "polygon",
    currentPolygon: saved.polygonDraft.currentPolygon,
    currentPolygonClass: saved.polygonDraft.classChoice || null,
    currentCurveControl: saved.polygonDraft.currentCurveControl,
    curveSegmentMode: saved.polygonDraft.curveSegmentMode,
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
  });
  return saved;
}
