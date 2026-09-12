# Interface design

Page Monitor is a browser utility. Its interface should prioritize monitor status,
check frequency, recent changes, and direct actions over branding or promotional copy.

## Reference review — September 12, 2026

- [Distill's Watchlist](https://distill.io/docs/web-monitor/what-is-watchlist/)
  organizes monitors and their management actions in a central list.
- [Visualping's Chrome extension](https://visualping.io/blog/chrome-extension-update)
  emphasizes selecting page content and setting a check frequency within the browser.

These workflows inform the interface; their branding, cloud services, and subscription
features are outside this project's scope.

## Conventions

- Use system sans-serif type, white surfaces, neutral borders, and blue primary actions.
- Keep headings compact. Avoid slogans, decorative badges, serif display type, and shadows.
- Use direct labels: Monitors, Active, Paused, Check now, Edit, and Delete.
- Keep status readable as text; color provides an additional cue.
- Use compact controls with visible keyboard focus and targets of at least 32 pixels
  for monitor actions. Preserve a usable layout at 320 pixels wide.
- State errors, data deletion consequences, and temporary-tab behavior explicitly.
- Keep permissions, authentication behavior, and the monitoring engine independent of
  presentation changes.
