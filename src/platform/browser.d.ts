// Shared calls use Chrome's types. Firefox-only API differences live in adapters.
declare const browser: typeof chrome & {
  sidebarAction: { open(): Promise<void> };
};
