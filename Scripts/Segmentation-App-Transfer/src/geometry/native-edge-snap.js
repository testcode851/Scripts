// Measure opposing strips along each candidate normal. The long tangent averages
// noise along a supported edge; the short normal keeps neighboring edges distinct.
const normalDepth = 4;
const tangentRadius = 6;
const halo = normalDepth + tangentRadius;
const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

// Estimate the background on small overlapping neighborhoods. Keeping this
// local matters when a single search crosses into a noisier part of an image.
const tileSize = 8;
function localNoise(analysis, centerX, centerY) {
  const { width, height, gray } = analysis;
  const left = Math.max(0, centerX - tileSize);
  const right = Math.min(width - 2, centerX + tileSize);
  const top = Math.max(0, centerY - tileSize);
  const bottom = Math.min(height - 2, centerY + tileSize);
  const step = right - left < 5 || bottom - top < 5 ? 1 : 2;
  const count = (Math.floor((right - left) / step) + 1) * (Math.floor((bottom - top) / step) + 1);
  const values = new Uint16Array(count);
  const differences = new Uint16Array(2 * count);
  let i = 0;
  for (let y = top; y <= bottom; y += step) {
    for (let x = left; x <= right; x += step) {
      const pos = y * width + x;
      const value = gray[pos];
      values[i] = value;
      differences[2 * i] = Math.abs(gray[pos + 1] - value);
      differences[2 * i + 1] = Math.abs(gray[pos + width] - value);
      i++;
    }
  }
  values.sort();
  differences.sort();
  // For independent Gaussian samples, median |neighbor difference| = 0.954 sigma.
  // The median and central intensity span tolerate isolated detector defects.
  const sigma = differences[count - 1] / 0.95387;
  const span = values[Math.floor(0.9 * (count - 1))] - values[Math.floor(0.1 * (count - 1))];
  return { sigma, span };
}

function buildNoiseTiles(analysis, { minX, minY, maxX, maxY }) {
  const tiles = [];
  for (let y = minY; y <= maxY; y += tileSize) {
    const row = [];
    const middleY = Math.floor((y + Math.min(y + tileSize - 1, maxY)) / 2);
    for (let x = minX; x <= maxX; x += tileSize) {
      const middleX = Math.floor((x + Math.min(x + tileSize - 1, maxX)) / 2);
      row.push(localNoise(analysis, middleX, middleY));
    }
    tiles.push(row);
  }
  return tiles;
}

function impulseClippedPatch({ width, height, gray }, { minX, minY, maxX, maxY }) {
  const left = Math.max(0, minX - halo);
  const top = Math.max(0, minY - halo);
  const right = Math.min(width - 1, maxX + halo);
  const bottom = Math.min(height - 1, maxY + halo);
  const stride = right - left + 1;
  const pixels = new Uint16Array(stride * (bottom - top + 1));
  let dst = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++, dst++) {
      const center = y * width + x;
      let low = 65535, high = 0;
      // Constrain only an isolated maximum or minimum to its neighbors' range.
      // An edge, or a thin line continuing to a diagonal neighbor, has support.
      for (let row = Math.max(0, y - 1); row <= Math.min(height - 1, y + 1); row++) {
        const end = row * width + Math.min(width - 1, x + 1);
        for (let i = row * width + Math.max(0, x - 1); i <= end; i++) {
          if (i === center) continue;
          low = Math.min(low, gray[i]);
          high = Math.max(high, gray[i]);
        }
      }
      pixels[dst] = Math.max(low, Math.min(high, gray[center]));
    }
  }
  return { left, top, stride, pixels };
}

/** Search original-resolution 16-bit samples; auxiliary storage is bounded by the snap radius. */
export function findNativeEdge(point, analysis, bounds, threshold) {
  const { minX, minY, maxX, maxY, anchorX, anchorY } = bounds;
  if (maxX < minX || maxY < minY) return point;
  const { width, height } = analysis;
  const patch = impulseClippedPatch(analysis, bounds);
  const { pixels, stride } = patch;
  const tiles = buildNoiseTiles(analysis, bounds);
  // At radius 8 and threshold 40, require five standard errors of separation.
  // A wider search tests more positions. Increase the cutoff by the log of
  // the extra area to limit the chance of choosing a random noise peak.
  const searchArea = (maxX - minX + 1) * (maxY - minY + 1);
  const relativeArea = Math.max(1, searchArea / (17 * 17));
  const significance = Math.sqrt((25 + 2 * Math.log(relativeArea)) * threshold / 40);
  let best = 0, bestNear = 0, bestDistance = Infinity;
  let bestX = anchorX, bestY = anchorY;
  for (let y = minY; y <= maxY; y++) {
    const roomY = Math.min(y, height - 1 - y);
    const tileRow = tiles[Math.floor((y - minY) / tileSize)];
    for (let x = minX; x <= maxX; x++) {
      const { sigma, span } = tileRow[Math.floor((x - minX) / tileSize)];
      const minimumContrast = span * threshold / 255;
      const roomX = Math.min(x, width - 1 - x);
      const center = (y - patch.top) * stride + x - patch.left;
      const distance = (x - anchorX) ** 2 + (y - anchorY) ** 2;
      for (const [nx, ny] of directions) {
        let depth, tangent;
        if (nx && ny) {
          // A diagonal strip consumes room on both axes. Shorten it symmetrically
          // near a border, avoiding wraparound or counting a boundary sample twice.
          const room = Math.min(roomX, roomY);
          depth = Math.min(normalDepth, Math.ceil(room * normalDepth / halo));
          tangent = Math.min(tangentRadius, room - depth);
        } else {
          depth = Math.min(normalDepth, nx ? roomX : roomY);
          tangent = Math.min(tangentRadius, nx ? roomY : roomX);
        }
        const normalStep = nx + stride * ny;
        const tangentStep = -ny + stride * nx;
        const stripWidth = 2 * tangent + 1;
        const count = depth * stripWidth;
        let sum = 0, squares = 0, near = 0;
        for (let n = 1; n <= depth; n++) {
          let plus = center + n * normalStep - tangent * tangentStep;
          let minus = center - n * normalStep - tangent * tangentStep;
          let rowSum = 0;
          for (let t = 0; t < stripWidth; t++, plus += tangentStep, minus += tangentStep) {
            const diff = pixels[plus] - pixels[minus];
            rowSum += diff;
            squares += diff * diff;
          }
          sum += rowSum;
          if (n === 1) near = Math.abs(rowSum) / stripWidth;
        }
        const contrast = Math.abs(sum) / count;
        if (!contrast || contrast < minimumContrast) continue;
        // A one-count noise fluctuation can be common even when more than half
        // of neighboring pairs are identical. Preserve exact steps on tiny images.
        const quantizationFloor = count >= 10 ? 0.7 : 0;
        const pixelError = Math.max(sigma, quantizationFloor) * Math.sqrt(2 / count);
        // A strip can cross into noisier pixels than the candidate's neighbors.
        // Check the standard error of its actual paired differences as well.
        const pairError = count > 1 ? Math.sqrt(Math.max(0, squares - sum * sum / count) / (count * (count - 1))) : 0;
        if (contrast < significance * Math.max(pixelError, pairError)) continue;
        // Among significant boundaries favor the transition at the cursor pixel.
        // A short central strip sharpens localization on narrow oblique strands;
        // decrease its weight as noise rises.
        let central = pixels[center + normalStep] - pixels[center - normalStep];
        if (tangent > 0) {
          central += pixels[center + normalStep - tangentStep] - pixels[center - normalStep - tangentStep] +
            pixels[center + normalStep + tangentStep] - pixels[center - normalStep + tangentStep];
          central /= 3;
        }
        const aligned = Math.max(0, Math.min(2 * contrast, Math.sign(sum) * central));
        const weight = 0.22 * contrast / (contrast + 2 * sigma);
        const score = contrast + weight * (aligned - contrast);
        if (score > best || (score === best && (near > bestNear ||
            (near === bestNear && distance < bestDistance)))) {
          best = score;
          bestNear = near;
          bestDistance = distance;
          bestX = x;
          bestY = y;
        }
      }
    }
  }
  return best > 0 ? { x: bestX, y: bestY } : point;
}
