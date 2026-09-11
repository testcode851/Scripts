import { round } from "../geometry/math.js";

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

/** Own annotation timing state transitions, interval lifetime, and timer controls. */
export function createAnnotationTimer({
  elements,
  imageState,
  annotationState,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  const {
    annotationTimerValue,
    annotationTimerStart,
    annotationTimerStop,
    annotationTimerReset,
  } = elements;
  let intervalId = null;

  function getElapsedMs(at = now()) {
    const baseElapsed = Math.max(0, annotationState.annotationElapsedMs || 0);
    if (
      !annotationState.annotationTimerRunning ||
      !Number.isFinite(annotationState.annotationLastStartedMs)
    ) {
      return baseElapsed;
    }
    return baseElapsed + Math.max(0, at - annotationState.annotationLastStartedMs);
  }

  function render() {
    const hasImage = Boolean(imageState.image && imageState.imageSize);
    const elapsedMs = getElapsedMs();
    if (annotationTimerValue) annotationTimerValue.textContent = formatDuration(elapsedMs);
    if (annotationTimerStart) {
      annotationTimerStart.disabled = !hasImage || annotationState.annotationTimerRunning;
    }
    if (annotationTimerStop) {
      annotationTimerStop.disabled = !hasImage || !annotationState.annotationTimerRunning;
    }
    if (annotationTimerReset) {
      annotationTimerReset.disabled =
        !hasImage || (!annotationState.annotationStartedAt && elapsedMs === 0);
    }
  }

  function stopInterval() {
    if (intervalId != null) {
      clearIntervalFn(intervalId);
      intervalId = null;
    }
  }

  function start() {
    if (!imageState.image || !imageState.imageSize || annotationState.annotationTimerRunning) {
      render();
      return;
    }
    const startedAt = now();
    annotationState.annotationTimerRunning = true;
    annotationState.annotationEndedAt = null;
    annotationState.annotationLastStartedMs = startedAt;
    if (!annotationState.annotationStartedAt) {
      annotationState.annotationStartedAt = new Date(startedAt).toISOString();
    }
    stopInterval();
    intervalId = setIntervalFn(render, 1000);
    render();
  }

  function stop(options = {}) {
    if (!annotationState.annotationStartedAt) {
      render();
      return;
    }
    const stoppedAt = now();
    if (annotationState.annotationTimerRunning) {
      annotationState.annotationElapsedMs = getElapsedMs(stoppedAt);
    }
    annotationState.annotationTimerRunning = false;
    annotationState.annotationLastStartedMs = null;
    stopInterval();
    if (options.markEnded) {
      annotationState.annotationEndedAt = new Date(stoppedAt).toISOString();
    }
    render();
  }

  function reset() {
    stopInterval();
    annotationState.annotationTimerRunning = false;
    annotationState.annotationStartedAt = null;
    annotationState.annotationEndedAt = null;
    annotationState.annotationElapsedMs = 0;
    annotationState.annotationLastStartedMs = null;
    render();
  }

  function getMetadata() {
    const durationMs = Math.round(getElapsedMs());
    return {
      startedAt: annotationState.annotationStartedAt,
      endedAt: annotationState.annotationEndedAt,
      durationMs,
      durationSeconds: round(durationMs / 1000),
      durationDisplay: formatDuration(durationMs),
      running: annotationState.annotationTimerRunning,
    };
  }

  return Object.freeze({
    render,
    start,
    stop,
    reset,
    getElapsedMs,
    getMetadata,
    dispose: stopInterval,
  });
}
