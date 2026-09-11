/** Bind PNG loading and JSON annotation import controls. */
export function bindFeatureFileEvents({
  elements,
  listen,
  FileReaderType,
  alertFn,
  actions,
}) {
  listen(elements.imageInput, "change", (event) => {
    const [file] = event.target.files;
    if (!file) return;
    if (file.type !== "image/png") {
      alertFn("Please upload a PNG image.");
      event.target.value = "";
      return;
    }
    if (!actions.loadImage(file)) {
      event.target.value = "";
    }
  });

  listen(elements.jsonInput, "change", (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const reader = new FileReaderType();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        alertFn(`Could not parse JSON: ${message}`);
        return;
      }

      try {
        actions.loadAnnotationData(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        alertFn(`Could not import annotations: ${message}`);
      }
    };
    reader.readAsText(file);
  });
}
