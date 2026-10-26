"""Read one Analytics JSON request; return pixel measurements as JSON.

The unchanged benchmark evaluation's Global PCA method performs all measurements.
Physical calibration is applied by the app after converting the benchmark's
nominal micrometer results back to pixels.
"""

import base64
import binascii
import hashlib
import io
import inspect
import json
import math
from pathlib import Path
import platform
import sys
import time
import warnings

MAX_REQUEST_BYTES = 20 * 1024 * 1024
MAX_RENDER_REQUEST_BYTES = 160 * 1024 * 1024
MAX_PNG_BYTES = 12 * 1024 * 1024
MAX_RAW_PNG_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 25_000_000
MAX_DIMENSION = 12_000


class RequestError(ValueError):
    """An invalid analysis request."""


def read_mask(payload):
    """Decode an opaque binary PNG at its original dimensions."""
    import numpy as np
    from PIL import Image, UnidentifiedImageError

    if not isinstance(payload, dict):
        raise RequestError("The analysis request must be a JSON object.")
    width, height = payload.get("width"), payload.get("height")
    if (
        type(width) is not int or type(height) is not int
        or not 1 <= width <= MAX_DIMENSION or not 1 <= height <= MAX_DIMENSION
        or width * height > MAX_PIXELS
    ):
        raise RequestError("Mask dimensions must be positive and at most 25 million pixels.")
    image_id = payload.get("image_id")
    if not isinstance(image_id, str) or not image_id or len(image_id) > 1024:
        raise RequestError("An image_id of 1-1024 characters is required.")
    encoded = payload.get("mask_png")
    prefix = "data:image/png;base64,"
    if not isinstance(encoded, str) or not encoded.startswith(prefix):
        raise RequestError("mask_png must be a base64 PNG data URL.")
    try:
        raw = base64.b64decode(encoded[len(prefix):], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise RequestError("The mask contains invalid base64 data.") from exc
    if len(raw) > MAX_PNG_BYTES:
        raise RequestError("The PNG mask must be at most 12 MiB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != "PNG" or image.size != (width, height):
                    raise RequestError("PNG dimensions must match the analysis request.")
                rgba = np.asarray(image.convert("RGBA"))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise RequestError("The mask could not be decoded as a PNG.") from exc
    gray = rgba[:, :, 0]
    if (
        not np.all(rgba[:, :, 3] == 255)
        or not np.array_equal(gray, rgba[:, :, 1])
        or not np.array_equal(gray, rgba[:, :, 2])
        or not np.all((gray == 0) | (gray == 255))
    ):
        raise RequestError("The mask must contain opaque black background and white strands.")
    return (gray > 0).astype(np.uint8)


def finite_json(value):
    """Represent missing numeric results with JSON null, never NaN."""
    if isinstance(value, dict):
        return {key: finite_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_json(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def read_raw_image(payload):
    """Decode the original raster for the benchmark renderer's grayscale input."""
    import numpy as np
    from PIL import Image, UnidentifiedImageError

    encoded = payload.get("raw_png")
    prefix = "data:image/png;base64,"
    if not isinstance(encoded, str) or not encoded.startswith(prefix):
        raise RequestError("raw_png must be a base64 PNG data URL.")
    try:
        raw = base64.b64decode(encoded[len(prefix):], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise RequestError("The original image contains invalid base64 data.") from exc
    if len(raw) > MAX_RAW_PNG_BYTES:
        raise RequestError("The original image PNG must be at most 100 MiB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != "PNG" or image.size != (payload["width"], payload["height"]):
                    raise RequestError("Original image dimensions must match the analysis request.")
                if getattr(image, "n_frames", 1) != 1:
                    raise RequestError("The original image must be a single-frame PNG.")
                rgba = image.convert("RGBA")
                opaque = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
                opaque.alpha_composite(rgba)
                gray = np.asarray(opaque.convert("L"), dtype=np.float64) / 255.0
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise RequestError("The original image could not be decoded as a PNG.") from exc
    return gray, hashlib.sha256(raw).hexdigest()


def render_analysis(payload):
    """Render saved pixel measurements with the package's unchanged figure code.

    This is intentionally a separate operation: changing the app's calibration
    renders the existing measurements again without running measurement code.
    """
    import numpy as np
    import matplotlib

    benchmark = Path(__file__).resolve().parents[1] / "diw_width_extraction_benchmark"
    sys.path.insert(0, str(benchmark))
    from pdtools.image_analysis.diameter_figures import transect_panel

    mask = read_mask(payload)
    raw_gray01, raw_sha256 = read_raw_image(payload)
    resolution = payload.get("resolution_um_per_px")
    try:
        valid_resolution = type(resolution) in (int, float) and math.isfinite(resolution) and resolution > 0
    except OverflowError:
        valid_resolution = False
    if not valid_resolution:
        raise RequestError("A positive, finite resolution_um_per_px is required for the benchmark figure.")
    result = payload.get("result")
    if (
        not isinstance(result, dict) or type(result.get("schema_version")) is not int
        or result.get("schema_version") != 1
        or result.get("unit") != "px" or result.get("image_id") != payload["image_id"]
        or result.get("width") != payload["width"] or result.get("height") != payload["height"]
        or not isinstance(result.get("summary"), dict)
        or not isinstance(result.get("per_strand"), list)
    ):
        raise RequestError("The saved measurements must match this image and use pixel units.")
    rows = result["per_strand"]
    if (
        len(rows) > MAX_PIXELS // 200
        or type(result["summary"].get("n_strands")) is not int
        or result["summary"]["n_strands"] != len(rows)
    ):
        raise RequestError("The saved measurement strand count is invalid.")
    title = payload.get("image_name", payload["image_id"])
    if not isinstance(title, str) or not title or len(title) > 1024:
        raise RequestError("The figure image name must contain 1-1024 characters.")

    def number(value, field, minimum=0, maximum=2 * MAX_DIMENSION):
        if (
            type(value) not in (int, float) or not minimum <= value <= maximum
            or not math.isfinite(value)
        ):
            raise RequestError(f"The saved measurement {field} is invalid.")
        return float(value)

    per_strand, measurement_count = {}, 0
    for row in rows:
        if not isinstance(row, dict):
            raise RequestError("Each saved strand must be an object.")
        strand_id = row.get("strand_id")
        widths = row.get("measurements_px")
        segments = row.get("segments")
        if (
            type(strand_id) is not int or not 1 <= strand_id <= MAX_PIXELS
            or strand_id in per_strand or not isinstance(widths, list) or not widths
            or type(row.get("n_measurements")) is not int
            or row["n_measurements"] != len(widths)
            or not isinstance(segments, list) or len(segments) != len(widths)
        ):
            raise RequestError("The saved strand identity or measurement count is invalid.")
        measurement_count += len(widths)
        if measurement_count > MAX_PIXELS:
            raise RequestError("The saved measurements contain too many transects.")
        values = np.asarray([number(value, "width", minimum=1) for value in widths])
        with np.errstate(over="ignore", invalid="ignore"):
            physical_values = values * resolution
        if not np.isfinite(physical_values).all():
            raise RequestError("The calibration produces nonfinite measured widths.")
        checked_segments = []
        for segment in segments:
            if (
                not isinstance(segment, list) or len(segment) != 2
                or any(not isinstance(point, list) or len(point) != 2 for point in segment)
            ):
                raise RequestError("A saved transect must have two coordinate pairs.")
            checked_segments.append([
                [number(point[0], "transect x", minimum=-MAX_DIMENSION),
                 number(point[1], "transect y", minimum=-MAX_DIMENSION)]
                for point in segment
            ])
        median = number(row.get("median_px"), "median", minimum=1) * resolution
        mean = number(row.get("mean_px"), "mean", minimum=1) * resolution
        if not math.isfinite(median) or not math.isfinite(mean):
            raise RequestError("The calibration produces nonfinite strand measurements.")
        per_strand[strand_id] = {
            "measurements_um": physical_values,
            "median_um": median,
            "mean_um": mean,
            "centroid_x_px": number(row.get("centroid_x_px"), "centroid x",
                                    maximum=payload["width"]),
            "centroid_y_px": number(row.get("centroid_y_px"), "centroid y",
                                    maximum=payload["height"]),
            "solidity": number(row.get("solidity"), "solidity", maximum=1),
            "segments": checked_segments,
        }
    if (
        type(result["summary"].get("n_measurements_total")) is not int
        or result["summary"]["n_measurements_total"] != measurement_count
    ):
        raise RequestError("The saved total transect count is invalid.")
    mask_bytes = base64.b64decode(payload["mask_png"].split(",", 1)[1])
    rendering_provenance = {
        "renderer": f"{transect_panel.__name__}.render_3panel",
        "aggregation": "mean_of_medians",
        "label_mode": "full",
        "summary_label": "mean",
        "title_name": title,
        "renderer_source_sha256": hashlib.sha256(Path(transect_panel.__file__).read_bytes()).hexdigest(),
        "matplotlib_version": matplotlib.__version__,
        "raw_png_sha256": raw_sha256,
        "mask_png_sha256": hashlib.sha256(mask_bytes).hexdigest(),
        "raw_conversion": "Pillow RGBA alpha-composited on black, then L / 255",
        "raw_display_processing": "unchanged render_3panel CLAHE",
        "resolution_um_per_px": float(resolution),
        "measurement_processing": "none; existing pixel measurements scaled to micrometers",
    }
    response = {
        "schema_version": 1,
        "figure_png": None,
        "resolution_um_per_px": float(resolution),
        "summary_um": None,
        "renderer": f"{transect_panel.__name__}.render_3panel",
        "aggregation": "mean_of_medians",
        "label_mode": "full",
        "rendering_provenance": rendering_provenance,
    }
    if not per_strand:
        response["reason"] = "no_measurements"
        return response
    with np.errstate(over="ignore", invalid="ignore"):
        summary = transect_panel.mean_of_medians(per_strand)
    if not math.isfinite(summary):
        raise RequestError("The calibration produces a nonfinite image measurement.")
    output = io.BytesIO()
    summary = transect_panel.render_3panel(
        raw_gray01, mask, per_strand, title, output, float(resolution),
        aggregate=transect_panel.mean_of_medians,
    )
    response["summary_um"] = summary
    response["figure_png"] = "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")
    return response


def display_segments(mask, coordinates, sampled_indices, measurements, evaluation, engine):
    """Associate display endpoints without changing benchmark measurements.

    The evaluator does not expose endpoints. Its package's existing PCA/walk
    helpers supply the reaches for rendering only; reported widths always come
    from method_global. Refuse to draw if those reaches cannot be matched to the
    evaluator's accepted widths in order (including its optional value trim).
    """
    import numpy as np

    _, perpendicular = engine.strand_pca(coordinates)
    limit = inspect.signature(evaluation._walk).parameters["max_half"].default
    candidates = []
    for y, x in coordinates[sampled_indices]:
        width, edge, plus, minus = engine.perpendicular_walk(
            int(y), int(x), perpendicular, mask, limit)
        candidates.append((y, x, width, edge, plus, minus))
    complete = [candidate for candidate in candidates if not candidate[3]]
    candidates = complete or candidates
    candidate_values = np.asarray([candidate[2] for candidate in candidates]) * evaluation.RES
    if not np.array_equal(evaluation._trim(candidate_values), measurements):
        raise RuntimeError("The display endpoints disagree with the benchmark measurements.")
    segments = []
    for y, x, width, _, plus, minus in candidates:
        if len(segments) == len(measurements):
            break
        if width * evaluation.RES != measurements[len(segments)]:
            continue
        segments.append([
            [float(x + plus * perpendicular[1]), float(y + plus * perpendicular[0])],
            [float(x - minus * perpendicular[1]), float(y - minus * perpendicular[0])],
        ])
    if len(segments) != len(measurements):
        raise RuntimeError("The benchmark measurements could not be matched to display endpoints.")
    return segments


def measurement_provenance(evaluation, engine):
    """Record the code and settings used by this run without changing them."""
    import numpy as np
    import PIL
    import scipy
    import skimage

    # This bundle has no declared package version. Identify its actual source
    # files instead; never substitute the unrelated production-pipeline config.
    benchmark = Path(engine.__file__).resolve().parents[2]
    sources = [
        {
            "path": path.relative_to(benchmark).as_posix(),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for path in sorted((benchmark / "pdtools").rglob("*.py"))
    ]
    source_manifest = json.dumps(sources, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "schema_version": 1,
        "method": {
            "name": "Global PCA",
            "callable": f"{evaluation.method_global.__module__}.{evaluation.method_global.__qualname__}",
            "runner": f"{evaluation.per_strand_medians.__module__}.{evaluation.per_strand_medians.__qualname__}",
        },
        "settings": {
            "sampling_stride": inspect.signature(evaluation.per_strand_medians).parameters["stride"].default,
            "maximum_half_walk_px": inspect.signature(evaluation._walk).parameters["max_half"].default,
            "benchmark_resolution_um_per_px": evaluation.RES,
            "benchmark_result_to_px_divisor": evaluation.RES,
            "outlier_tolerance_fraction": evaluation.OUTLIER_TOL_FRAC,
            "input_mask_processing": "none",
            "reported_measurement_unit": "px",
            "low_transect_count_threshold": engine.Config().low_transect_threshold,
            "low_transect_count_action": "flag_only",
        },
        "benchmark": {
            "name": "diw_width_extraction_benchmark",
            "version": None,
            "version_basis": "source_sha256",
            "sha256": hashlib.sha256(source_manifest).hexdigest(),
            "sources": sources,
            # The runner embeds its area/sample gates and skeleton seed, and
            # the method embeds edge rejection/fallback. Preserve those actual
            # policies rather than maintaining a second set of their constants.
            "runner_policy_source": inspect.getsource(evaluation.per_strand_medians),
            "method_policy_source": inspect.getsource(evaluation.method_global),
        },
        "adapter": {
            "path": "scripts/analytics_adapter.py",
            "sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        },
        "environment": {
            "python": platform.python_version(),
            "python_implementation": platform.python_implementation(),
            "system": platform.system(),
            "machine": platform.machine(),
            "dependencies": {
                "numpy": np.__version__,
                "scipy": scipy.__version__,
                "scikit-image": skimage.__version__,
                "Pillow": PIL.__version__,
            },
        },
    }


def analyze(payload):
    """Adapt the benchmark's Global PCA results to the existing app response."""
    import numpy as np
    from PIL import Image

    benchmark = Path(__file__).resolve().parents[1] / "diw_width_extraction_benchmark"
    sys.path.insert(0, str(benchmark))
    from pdtools.image_analysis import strand_diameter as engine
    from pdtools.image_analysis.diameter_figures import width_extraction_eval as evaluation

    mask = read_mask(payload)
    started = time.perf_counter()
    # These labels provide display IDs/area/solidity only. The benchmark runner
    # owns component selection, skeleton generation, sampling and measurement.
    labels = evaluation.label(mask)
    regions = {region.label: region for region in evaluation.regionprops(labels)}
    low_count_threshold = engine.Config().low_transect_threshold
    strands = []

    def collect_global(component, coordinates, distances, sampled_indices):
        measured = evaluation.method_global(component, coordinates, distances, sampled_indices)
        if len(measured):
            widths = measured / evaluation.RES
            strand_id = int(labels[tuple(coordinates[0])])
            region = regions[strand_id]
            strands.append({
                "strand_id": strand_id,
                "n_measurements": int(len(widths)),
                "mean_px": float(np.mean(widths)),
                "std_px": float(np.std(widths)),
                "min_px": float(np.min(widths)),
                "max_px": float(np.max(widths)),
                "strand_area_px": int(region.area),
                "skeleton_interior_px": int(len(coordinates)),
                "measurements_px": widths.tolist(),
                "segments": display_segments(component, coordinates, sampled_indices,
                                             measured, evaluation, engine),
                "solidity": float(region.solidity),
                # Existing UI warning only; it never excludes benchmark results.
                "low_transect_count": bool(len(widths) < low_count_threshold),
            })
        return measured

    # Use the package's defaults unchanged: raw mask, seeded skeleton, stride,
    # component/sample gates, search range, rejection/fallback and optional trim.
    medians, centroids = evaluation.per_strand_medians(mask, collect_global)
    if len(strands) != len(medians):
        raise RuntimeError("The benchmark returned inconsistent component results.")
    for strand, median, (y, x) in zip(strands, medians, centroids):
        strand.update(median_px=float(median / evaluation.RES),
                      centroid_y_px=float(y), centroid_x_px=float(x))

    median_pixels = np.asarray([strand["median_px"] for strand in strands])
    all_widths = np.asarray([width for strand in strands for width in strand["measurements_px"]])
    mean = float(np.mean(median_pixels)) if len(strands) else float("nan")
    std = float(np.std(median_pixels)) if len(strands) else float("nan")
    summary = {
        "image_mean_px": mean,
        "image_std_px": std,
        "image_cv_pct": 100 * std / mean if mean > 0 else float("nan"),
        "pooled_mean_px": float(np.mean(all_widths)) if len(strands) else float("nan"),
        "pooled_std_px": float(np.std(all_widths)) if len(strands) else float("nan"),
        "n_strands": len(strands),
        "n_low_transect": sum(strand["low_transect_count"] for strand in strands),
        "n_measurements_total": int(len(all_widths)),
        "runtime_s": time.perf_counter() - started,
    }
    output = io.BytesIO()
    # Preserve the protocol key, but show exactly the raw mask the evaluator used.
    Image.fromarray(mask * 255).save(output, format="PNG")
    return finite_json({
        "schema_version": 1,
        "image_id": payload["image_id"],
        "width": payload["width"],
        "height": payload["height"],
        "unit": "px",
        "summary": summary,
        "per_strand": strands,
        "provenance": measurement_provenance(evaluation, engine),
        "processed_mask_png": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii"),
    })


def main():
    """Reserve stdout for the protocol; put diagnostics on stderr."""
    try:
        raw = sys.stdin.buffer.read(MAX_RENDER_REQUEST_BYTES + 1)
        if len(raw) > MAX_RENDER_REQUEST_BYTES:
            raise RequestError("The analysis request is too large.")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError) as exc:
            raise RequestError("The analysis request contains invalid JSON.") from exc
        rendering = isinstance(payload, dict) and payload.get("operation") == "render"
        if not rendering and len(raw) > MAX_REQUEST_BYTES:
            raise RequestError("The analysis request is too large.")
        response = render_analysis(payload) if rendering else analyze(payload)
        exit_code = 0
    except RequestError as exc:
        response = {"error": {"code": "INVALID_MASK", "message": str(exc)}}
        exit_code = 2
    except ImportError as exc:
        print(str(exc), file=sys.stderr)
        response = {"error": {
            "code": "PYTHON_DEPENDENCIES",
            "message": "The Analytics Python environment is missing dependencies. Install the benchmark requirements.",
        }}
        exit_code = 3
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        response = {"error": {"code": "ANALYSIS_FAILED", "message": "The measurement engine could not analyze this mask."}}
        exit_code = 1
    print(json.dumps(response, allow_nan=False, separators=(",", ":")))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
