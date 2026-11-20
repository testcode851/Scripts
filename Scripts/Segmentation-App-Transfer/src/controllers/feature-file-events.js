/** Bind source image loading and JSON annotation import controls. */
export function bindFeatureFileEvents({
  elements,
  listen,
  FileReaderType,
  alertFn,
  actions,
}) {
  let fileRequest = 0;
  listen(elements.imageInput, "change", (event) => {
    const [file] = event.target.files;
    if (!file) return;
    fileRequest += 1;
    actions.cancelAnnotationImport?.();
    if (!actions.loadImage(file)) {
      event.target.value = "";
    }
  });

  listen(elements.jsonInput, "change", (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const request = ++fileRequest;
    const importGeneration = actions.getImportGeneration?.();
    const isCurrent = () => request === fileRequest && importGeneration === actions.getImportGeneration?.();
    actions.cancelAnnotationImport?.();
    const reader = new FileReaderType();
    reader.onload = async () => {
      if (!isCurrent()) return;
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        alertFn(`Could not parse JSON: ${message}`);
        return;
      }

      try {
        await actions.loadAnnotationData(data);
      } catch (error) {
        if (!isCurrent()) return;
        const message = error instanceof Error ? error.message : String(error);
        alertFn(`Could not import annotations: ${message}`);
      }
    };
    reader.onerror = () => {
      if (isCurrent()) alertFn("Could not read the JSON file.");
    };
    reader.readAsText(file);
  });
}
