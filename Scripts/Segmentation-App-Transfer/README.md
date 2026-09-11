# Segmentation Annotator

This folder contains the ES-module version of the segmentation application.
The application runs in a web browser, while Node.js provides the local web
server used to open it correctly.

## Requirements

- Node.js approved for the computer running the application
- A current Chromium-based browser such as Google Chrome or Microsoft Edge

The application currently has no third-party npm dependencies, so `npm
install` is not required. If dependencies are added later, configure the
organization-approved `.npmrc` and Artifactory registry before installing
them.

## Required Runtime Files

Keep this structure intact when running or transferring the application:

- `index.html`
- `package.json`
- `scripts/dev-server.js`
- `src/` and everything inside it
- `styles/` and everything inside it

`README.md` provides documentation and is not loaded by the application.
A development copy may also contain tests and additional documentation, but
those files are not required for normal application use.

## Run from Git Bash

Open Git Bash in this folder and run:

```bash
npm run dev
```

Then open <http://127.0.0.1:4173> in a browser. Press `Ctrl+C` in Git Bash to
stop the server.

If port 4173 is already being used:

```bash
PORT=4174 npm run dev
```

Then open <http://127.0.0.1:4174>.

## Run from PowerShell

```powershell
npm run dev
```

For a different port in PowerShell:

```powershell
$env:PORT=4174
npm run dev
```

## Application Files and Data

- Start the app with `npm run dev`; do not open `index.html` directly.
- PNG images and annotation JSON files are selected through the application UI.
- Selected files are processed locally in the browser.
- The included Node.js server serves application files only. It does not
  upload or store selected images.
- Keep the terminal open while using the application.
- Press `Ctrl+C` in the terminal when finished.

## Main Runtime Structure

- `index.html` defines the application page and UI structure.
- `styles/` contains the component and layout stylesheets.
- `src/app.js` assembles the browser application.
- `src/bootstrap/` controls application startup order.
- `src/commands/` routes application actions such as undo, delete, and export.
- `src/controllers/` handles user input and UI events.
- `src/model/` and `src/state/` manage annotations and application state.
- `src/render/` draws the canvas, shapes, grid, and masks.
- `src/workflows/` coordinates annotation and document operations.
- `scripts/dev-server.js` runs the local Node.js web server.
