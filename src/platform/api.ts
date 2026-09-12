// Resolve lazily so callers always use the current execution context's API.
// Firefox's browser namespace provides promises; its chrome alias does not.
export function api(): typeof chrome {
  return typeof browser === 'undefined' ? chrome : browser;
}
