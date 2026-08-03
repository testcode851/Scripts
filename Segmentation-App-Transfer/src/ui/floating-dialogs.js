/** Own floating-dialog visibility, trigger binding, and mouse dragging. */
export function createFloatingDialogs({ documentRoot, entries }) {
  const dialogs = entries.map(({ dialog }) => dialog).filter(Boolean);
  let bound = false;

  function close(dialog) {
    if (!dialog) return;
    dialog.setAttribute("hidden", "");
    dialog.setAttribute("aria-hidden", "true");
  }

  function closeAll() {
    dialogs.forEach(close);
  }

  function toggle(dialog) {
    if (!dialog) return;
    if (dialog.hasAttribute("hidden")) {
      dialogs.forEach((candidate) => {
        if (candidate !== dialog) close(candidate);
      });
      dialog.style.left = "";
      dialog.style.top = "";
      dialog.style.transform = "";
      delete dialog.dataset.dragged;
      dialog.removeAttribute("hidden");
      dialog.setAttribute("aria-hidden", "false");
    } else {
      close(dialog);
    }
  }

  function makeDraggable(dialog) {
    const header = dialog.querySelector(".floating-dialog-header");
    if (!header) return;
    header.style.cursor = "grab";
    let startX;
    let startY;
    let startLeft;
    let startTop;

    function onMouseMove(event) {
      dialog.style.left = `${startLeft + event.clientX - startX}px`;
      dialog.style.top = `${startTop + event.clientY - startY}px`;
    }

    function onMouseUp() {
      header.style.cursor = "grab";
      documentRoot.removeEventListener("mousemove", onMouseMove);
      documentRoot.removeEventListener("mouseup", onMouseUp);
    }

    function onMouseDown(event) {
      if (event.target.closest("button")) return;
      event.preventDefault();
      if (!dialog.dataset.dragged) {
        const rect = dialog.getBoundingClientRect();
        dialog.style.left = `${rect.left}px`;
        dialog.style.top = `${rect.top}px`;
        dialog.style.transform = "none";
        dialog.dataset.dragged = "true";
      }
      startX = event.clientX;
      startY = event.clientY;
      startLeft = parseInt(dialog.style.left, 10);
      startTop = parseInt(dialog.style.top, 10);
      header.style.cursor = "grabbing";
      documentRoot.addEventListener("mousemove", onMouseMove);
      documentRoot.addEventListener("mouseup", onMouseUp);
    }

    header.addEventListener("mousedown", onMouseDown);
  }

  function bind() {
    if (bound) return;
    bound = true;
    entries.forEach(({ dialog, openButton, closeButton }) => {
      if (!dialog) return;
      makeDraggable(dialog);
      openButton?.addEventListener("click", () => toggle(dialog));
      closeButton?.addEventListener("click", () => close(dialog));
    });
  }

  return Object.freeze({ bind, close, closeAll, toggle });
}
