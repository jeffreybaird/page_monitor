# Store privacy and permission fields

Publisher review required before certifying these answers in either dashboard.
Chrome's disclosure applies even to information used only locally. Do not check
“no user data” because monitoring has no server.

## Single purpose

Monitor text regions the user selects on webpages and notify the user when that
text changes, with local snapshots and history for reviewing the changes.

## Chrome data categories

| Dashboard category                                       | Proposed disclosure     | Actual use                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website content                                          | Yes                     | Selected text, bounded HTML previews and recent before/after snapshots are processed and stored locally.                                                                                                                      |
| Web history                                              | Yes                     | Saved monitor URLs and tab URLs are used to select/match the user's pages; no browsing-history database or history permission.                                                                                                |
| Authentication information                               | Yes                     | A local licensing credential is sent to ExtensionPay for optional license checks. Browser session cookies are used by monitored-site requests; passwords/cookies are not copied into extension storage.                       |
| Personally identifiable information                      | Yes                     | Optional ExtensionPay purchase/restoration uses email; provider responses may cache email locally.                                                                                                                            |
| Financial and payment information                        | Yes                     | Optional licensing records plan/payment status; card entry happens on provider pages, not in the extension.                                                                                                                   |
| Health, personal communications, location, user activity | No dedicated collection | No category-specific feature, analytics, keystroke logging, location API or communication service. Users can select sensitive page text; disclose that under website content. Review dashboard definitions before certifying. |

Data is not sold or used for advertising, creditworthiness or lending. Transfers
are limited to the selected sites' normal requests and the optional payment
provider's licensing function. No monitored content is sent to a developer server
or payment provider. Confirm that the published privacy policy and actual provider
settings match before accepting the dashboard's Limited Use declarations.

## Permission justifications

| Permission                           | Dashboard wording                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `alarms`                             | Schedules monitor checks and recovers pending notifications, temporary-tab cleanup and license verification across background restarts.                                                    |
| `storage`                            | Saves local monitor settings, snapshots/history and licensing status; session storage keeps unfinished forms, picker state and temporary-tab ownership. No monitor or licensing sync.      |
| `notifications`                      | Shows text-change alerts and a notice before a page first requires temporary JavaScript rendering.                                                                                         |
| `offscreen` (Chrome)                 | Parses fetched HTML in an inert DOM context because a Chrome service worker has no DOM. It does not execute scripts from fetched pages.                                                    |
| `scripting`                          | Injects the user-triggered region picker and reads a saved region on sites for which access has been granted.                                                                              |
| `sidePanel` (Chrome)                 | Provides the monitor management interface in Chrome's native side panel.                                                                                                                   |
| `tabs`                               | Identifies the active page for selection, matches full saved URLs to existing tabs, and manages temporary rendering tabs without reloading user tabs.                                      |
| Optional `http://*/*`, `https://*/*` | Users may choose arbitrary HTTP(S) pages. Access is requested for the selected site's origin when selecting or saving a monitor; the extension does not request all sites at installation. |
| `https://extensionpay.com/*`         | Enables license verification and optional purchase/restoration through ExtensionPay, including Firefox's cross-origin licensing calls. No page content is uploaded there.                  |

Remote code: No. Executable extension code and dependencies are bundled. External
HTML is parsed inertly. A temporary browser tab can run the selected site's normal
JavaScript as webpage code; this is not code downloaded into the extension runtime.

## Firefox

The manifest declares no required data collection and three optional payment
categories: authenticationInfo, personallyIdentifyingInfo, financialAndPaymentInfo.
Supported Firefox versions request these when the user buys/restores, and the
worker checks current grants before provider contact. Earlier Firefox uses the
visible disclosure and explicit action. The extension does not transmit monitored
content to the developer; the monitored sites receive ordinary browser requests.

Mark the add-on as requiring payment for some functionality. Include the free
limits and one-time price. Supply working paid-feature review access through AMO's
private reviewer fields before submitting. Do not put secrets in the source ZIP.

Sources checked September 12, 2026:
[Chrome privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
[Chrome data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
[Firefox data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/),
[Mozilla add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/).
