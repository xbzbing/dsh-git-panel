import { createHash } from "node:crypto";
function snapshotFingerprint(snapshot) {
  const { checkedAt: _checkedAt, stateFingerprint: _stateFingerprint, ...state } = snapshot;
  const encoded = JSON.stringify(state, (_key, value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  return createHash("sha256").update(encoded).digest("hex");
}
export {
  snapshotFingerprint
};
