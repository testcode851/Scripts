/** Encode original file bytes in bounded chunks, with padding only at the end. */
export function rawBase64(bytes) {
  const parts = [];
  for (let start = 0; start < bytes.length; start += 24576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 24576))));
  }
  return parts.join("");
}
