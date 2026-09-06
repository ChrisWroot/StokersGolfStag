// Tiny pub/sub so a successful write in api.js can tell useAppData.js to
// refetch immediately, instead of waiting on the realtime round trip.
const listeners = new Set();

export function onDataChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitDataChange() {
  listeners.forEach((fn) => fn());
}
