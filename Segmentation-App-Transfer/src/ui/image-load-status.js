import { clamp } from "../geometry/math.js";

/** Own image-load status rendering and success-message timeout lifetime. */
export function createImageLoadStatus({
  elements,
  imageState,
  renderInvalidation,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  const {
    imageLoadStatus,
    imageLoadStatusText,
    imageLoadPercent,
    imageLoadProgress,
    imageLoadProgressFill,
  } = elements;
  let timerId = null;

  function render() {
    if (
      !imageLoadStatus ||
      !imageLoadStatusText ||
      !imageLoadPercent ||
      !imageLoadProgress ||
      !imageLoadProgressFill
    ) {
      return;
    }
    const status = imageState.imageLoadStatus;
    const progress = clamp(Math.round(imageState.imageLoadProgress || 0), 0, 100);
    const message =
      imageState.imageLoadMessage ||
      (status === "error"
        ? "Image load failed."
        : status === "success"
          ? "Image ready."
          : "Loading image...");
    const visible = status === "loading" || status === "success" || status === "error";
    const nextKey = `${visible}|${status}|${progress}|${message}`;
    if (!renderInvalidation.hasChanged("image-load-status", nextKey)) {
      return;
    }
    imageLoadStatus.hidden = !visible;
    if (!visible) {
      imageLoadStatus.removeAttribute("data-state");
      return;
    }
    imageLoadStatus.dataset.state = status;
    imageLoadStatusText.textContent = message;
    imageLoadPercent.textContent = `${progress}%`;
    imageLoadProgress.setAttribute("aria-valuenow", String(progress));
    imageLoadProgressFill.style.width = `${progress}%`;
  }

  function clearTimer() {
    if (timerId != null) {
      clearTimeoutFn(timerId);
      timerId = null;
    }
  }

  function setState(status, progress, message, options = {}) {
    const { autoHideSuccess = true } = options;
    imageState.imageLoadStatus = status;
    imageState.imageLoadProgress = clamp(Math.round(progress || 0), 0, 100);
    imageState.imageLoadMessage = message || "";
    clearTimer();
    render();
    if (status === "success" && autoHideSuccess) {
      timerId = setTimeoutFn(() => {
        if (imageState.imageLoadStatus !== "success") {
          return;
        }
        imageState.imageLoadStatus = "idle";
        imageState.imageLoadProgress = 0;
        imageState.imageLoadMessage = "";
        render();
      }, 1400);
    }
  }

  return Object.freeze({ render, setState, dispose: clearTimer });
}
