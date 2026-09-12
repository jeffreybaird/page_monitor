import './style.css';
import { textDiff } from './diff';
import { htmlPreview } from './html-preview';
import {
  readEditorDraft,
  saveEditorDraft,
  type EditorDraft,
} from './editor-draft';
import {
  inputValid,
  originPattern,
  webUrl,
  type Draft,
  type Monitor,
  type MonitorInput,
  type Reply,
  type Request,
  type View,
} from '../shared/model';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function button(
  text: string,
  action: () => void,
  className = '',
): HTMLButtonElement {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function field(
  labelText: string,
  input: HTMLInputElement | HTMLSelectElement,
): HTMLLabelElement {
  const label = el('label');
  if (!input.hasAttribute('aria-label'))
    input.setAttribute('aria-label', labelText);
  if (input instanceof HTMLInputElement && input.type === 'checkbox')
    label.append(input, el('span', labelText));
  else label.append(el('span', labelText), input);
  return label;
}
function input(type: string, value = ''): HTMLInputElement {
  const node = el('input');
  node.type = type;
  node.value = value;
  return node;
}
function select(options: [string, string][]): HTMLSelectElement {
  const node = el('select');
  for (const [value, label] of options) {
    const option = el('option', label);
    option.value = value;
    node.append(option);
  }
  return node;
}
const app = document.querySelector('#app');
if (!app) throw new Error('Missing side panel root.');
const header = el('header');
header.append(el('h1', 'Page Monitor'));
const local = el('p', 'Local monitoring · Chrome must be running', 'local');
const status = el('p', '', 'status');
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
const form = el('form', '', 'surface');
const formTitle = el('h2', 'New monitor');
const name = input('text');
name.required = true;
name.maxLength = 100;
name.placeholder = 'e.g. Project status';
const url = input('url');
url.required = true;
url.maxLength = 2048;
url.placeholder = 'https://example.com';
const selector = input('text');
selector.required = true;
selector.maxLength = 2000;
selector.placeholder = 'Pick a region, or enter a CSS selector';
const renderJavaScript = input('checkbox');
const interval = input('number', '5');
interval.required = true;
interval.min = '1';
interval.max = '1440';
interval.step = '1';
const units = select([
  ['60', 'Minutes'],
  ['1', 'Seconds'],
  ['3600', 'Hours'],
]);
units.setAttribute('aria-label', 'Check interval unit');
const durationMode = select([
  ['forever', 'Until stopped'],
  ['duration', 'Set duration'],
]);
const duration = input('number', '60');
duration.min = '1';
duration.max = '525600';
duration.step = '1';
const durationField = field('Run for (minutes)', duration);
durationField.hidden = true;
durationMode.addEventListener('change', () => {
  durationField.hidden = durationMode.value !== 'duration';
  duration.required = !durationField.hidden;
});
units.addEventListener('change', () => {
  interval.min = units.value === '1' ? '30' : '1';
  interval.max = String(86400 / Number(units.value));
  if (Number(interval.value) < Number(interval.min))
    interval.value = interval.min;
});
const sample = el('p', 'Select a region to preview its text.', 'preview');
sample.setAttribute('aria-label', 'Selected text preview');
let previewGeneration = 0;
const selectorStatus = el(
  'p',
  'Preview the selected text before saving.',
  'hint',
);
selectorStatus.setAttribute('role', 'status');
const testSelectorButton = button('Test selector', () => {
  void testSelector();
});
function invalidatePreview(): void {
  previewGeneration++;
  selectorStatus.textContent = 'Selector not tested for these settings.';
  selectorStatus.classList.remove('error');
  sample.textContent =
    'Select a region or test its selector to preview the text.';
}
url.addEventListener('input', invalidatePreview);
selector.addEventListener('input', invalidatePreview);
renderJavaScript.addEventListener('change', invalidatePreview);
let editingId: string | null = null;
let draftKey = '';
let monitors: Monitor[] = [];
let busy = false;
let editorTouched = false;
let editorRestoring = true;
let editorVersion = 0;
const editorWindow = chrome.windows.getCurrent().then((window) => {
  if (window.id === undefined)
    throw new Error('Cannot restore the draft without a browser window.');
  return window.id;
});
const editorStatus = el('p', '', 'hint');
editorStatus.setAttribute('aria-label', 'Editor draft status');
function editorValue(): EditorDraft {
  return {
    editingId,
    name: name.value,
    url: url.value,
    selector: selector.value,
    interval: interval.value,
    units: units.value,
    durationMode: durationMode.value,
    duration: duration.value,
    renderJavaScript: renderJavaScript.checked,
  };
}
async function storeEditor(value: EditorDraft | null): Promise<boolean> {
  const version = ++editorVersion;
  try {
    await saveEditorDraft(await editorWindow, value);
    if (version === editorVersion) {
      editorStatus.textContent = value
        ? 'Draft saved until Chrome closes.'
        : '';
      editorStatus.classList.remove('error');
    }
    return true;
  } catch (error) {
    if (version === editorVersion) {
      editorStatus.textContent = `Draft not saved: ${error instanceof Error ? error.message : 'Storage is unavailable.'}`;
      editorStatus.classList.add('error');
    }
    return false;
  }
}
function rememberEditor(): void {
  if (busy) return;
  editorTouched = true;
  void storeEditor(editorValue());
}

let checkingId: string | null = null;
let viewVersion = 0;
const pendingActions = new Map<string, string>();
const picker = button(
  'Select region in current tab',
  () => {
    void pick();
  },
  'pick',
);
const intervalRow = el('div', '', 'interval-row');
intervalRow.append(field('Check every', interval), field('Unit', units));
const submit = el('button', 'Start monitoring', 'primary');
submit.type = 'submit';
const cancel = button(
  'Cancel edit',
  () => {
    if (busy) return;
    resetForm();
    void request({ type: 'clear-draft' }).catch(fail);
    form.hidden = monitors.length > 0;
    if (form.hidden) newMonitor.focus();
  },
  'quiet',
);
cancel.hidden = true;
const editWarning = el(
  'p',
  'Changing the URL, selector, or JavaScript setting clears saved history and starts a new baseline.',
  'hint',
);
editWarning.hidden = true;
const actions = el('div', '', 'actions');
actions.append(submit, cancel);
form.append(
  formTitle,
  picker,
  field('Monitor name', name),
  field('Page URL', url),
  field('CSS selector', selector),
  field('Render JavaScript for closed-tab checks', renderJavaScript),
  el(
    'p',
    'Enable if the page shows placeholder text before loading. Missing content triggers this automatically. You’ll be notified before the first temporary tab opens.',
    'hint',
  ),
  testSelectorButton,
  selectorStatus,
  sample,
  intervalRow,
  el(
    'p',
    'Minimum 30 seconds. Checks may be delayed while Chrome sleeps.',
    'hint',
  ),
  field('Monitor for', durationMode),
  durationField,
  editWarning,
  editorStatus,
  actions,
);
let initialized = false;
const newMonitor = button(
  'New monitor',
  () => {
    if (busy) return;
    if (!form.hidden) {
      picker.focus();
      return;
    }
    resetForm();
    void request({ type: 'clear-draft' }).catch(fail);
    form.hidden = false;
    cancel.hidden = monitors.length === 0;
    picker.focus();
    form.scrollIntoView({ block: 'start', behavior: 'instant' });
  },
  'primary',
);
const toolbar = el('div', '', 'dashboard-toolbar');
const overview = el('p', '', 'overview');
overview.setAttribute('aria-label', 'Monitor overview');
toolbar.append(overview, newMonitor);
const search = input('search');
search.setAttribute('aria-label', 'Search monitors');
search.placeholder = 'Search name or website';
const filter = select([
  ['all', 'All monitors'],
  ['unread', 'Unread changes'],
  ['attention', 'Needs attention'],
  ['watching', 'Active'],
  ['paused', 'Paused or finished'],
]);
filter.setAttribute('aria-label', 'Filter monitors');
const filters = el('div', '', 'monitor-filters');
filters.append(search, filter);
search.addEventListener('input', renderMonitors);
filter.addEventListener('change', renderMonitors);
const section = el('section');
const listHeading = el('h2', 'Monitors');
listHeading.tabIndex = -1;
const count = el('span', '0', 'count');
listHeading.append(count);
const list = el('div', '', 'monitor-list');
section.append(listHeading, filters, list);
const help = el('details', '', 'help');
help.append(
  el('summary', 'How monitoring works'),
  el(
    'p',
    'Open tabs are read as they are, never reloaded. Closed tabs are checked with background requests using available browser cookies. Your browser must stay running.',
  ),
  el(
    'p',
    'You must remain logged in for private pages. When background HTML cannot provide the region, a temporary inactive tab runs the site’s JavaScript using your session, then closes. Selecting that tab keeps it open. Some sites still require an open, active tab.',
  ),
  el(
    'p',
    'Text changes trigger desktop notifications and a badge. Snapshots and the latest 10 changes stay on this device. Site access is requested only when you add a monitor or select a region.',
  ),
);
app.append(header, local, status, toolbar, form, section, help);

function message(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}
async function request(value: Request): Promise<View> {
  const reply: Reply = await chrome.runtime.sendMessage(value);
  if (!reply || !reply.ok)
    throw new Error(
      reply?.error || 'The extension did not respond. Reopen the side panel.',
    );
  return reply.value;
}
function fail(error: unknown): void {
  message(
    error instanceof Error
      ? error.message
      : 'Something went wrong. Please try again.',
    true,
  );
}
function resetForm(): void {
  editorTouched = true;
  void storeEditor(null);
  invalidatePreview();
  form.reset();
  interval.value = '5';
  duration.value = '60';
  editingId = null;
  editWarning.hidden = true;
  formTitle.textContent = 'New monitor';
  submit.textContent = 'Start monitoring';
  cancel.hidden = true;
  durationField.hidden = true;
  duration.required = false;
  interval.min = '1';
  interval.max = '1440';
  sample.textContent = 'Select a region to preview its text.';
  name.focus();
}
function applyDraft(draft: Draft | null): void {
  if (!draft) {
    draftKey = '';
    return;
  }
  if (JSON.stringify(draft) === draftKey) return;
  form.hidden = false;
  cancel.hidden = monitors.length === 0;
  draftKey = JSON.stringify(draft);
  invalidatePreview();
  url.value = draft.url;
  selector.value = draft.selector;
  if (!name.value) name.value = draft.title.slice(0, 100);
  sample.textContent = draft.sample;
  message('Region selected.');
  editorTouched = true;
  void storeEditor(editorValue())
    .then((saved) => {
      if (saved)
        return request({
          type: 'clear-draft',
          expected: JSON.stringify(draft),
        });
    })
    .catch(fail);
}
function applyView(view: View): void {
  viewVersion++;
  monitors = view.monitors;
  checkingId = view.checkingId ?? null;
  if (!initialized) {
    form.hidden = monitors.length > 0 && !view.draft;
    initialized = true;
  }
  renderMonitors();
  applyDraft(view.draft);
}
let refreshing = false;
let refreshAgain = false;
async function refresh(): Promise<void> {
  refreshAgain = true;
  if (refreshing || editorRestoring) return;
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      const version = viewVersion;
      try {
        const view = await request({ type: 'list' });
        if (version === viewVersion) applyView(view);
      } catch (error) {
        fail(error);
      }
    } while (refreshAgain);
  } finally {
    refreshing = false;
  }
}
async function testSelector(): Promise<void> {
  let generation = previewGeneration;
  try {
    const targetUrl = webUrl(url.value);
    const targetSelector = selector.value.trim();
    if (!targetSelector || targetSelector.length > 2000)
      throw new Error('Enter a CSS selector or select a region first.');
    try {
      if (!targetSelector.startsWith('@page-monitor:'))
        document.querySelector(targetSelector);
    } catch {
      throw new Error(
        'Invalid CSS selector. Correct its syntax and try again.',
      );
    }
    generation = ++previewGeneration;
    const permission = chrome.permissions.request({
      origins: [originPattern(targetUrl)],
    });
    testSelectorButton.disabled = true;
    submit.disabled = true;
    selectorStatus.textContent = 'Testing selector…';
    selectorStatus.classList.remove('error');
    sample.textContent = '';
    if (!(await permission))
      throw new Error(
        'Site access was denied. Allow access to test this selector.',
      );
    const result = await request({
      type: 'test-selector',
      url: targetUrl,
      selector: targetSelector,
      renderJavaScript: renderJavaScript.checked,
    });
    if (generation !== previewGeneration) return;
    if (!result.preview) throw new Error('No selector preview was returned.');
    sample.textContent = result.preview.text;
    selectorStatus.textContent = `Valid selector · One region found in ${result.preview.source === 'tab' ? 'the open tab' : result.preview.source === 'rendered' ? 'a temporary tab (JavaScript rendering was required)' : 'background HTML'}. Nothing has been saved.`;
  } catch (error) {
    if (generation === previewGeneration) {
      selectorStatus.textContent =
        error instanceof Error
          ? error.message
          : 'Could not test this selector.';
      selectorStatus.classList.add('error');
      sample.textContent = '';
    }
  } finally {
    testSelectorButton.disabled = false;
    submit.disabled = busy;
  }
}
async function pick(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url || tab.id === undefined)
      throw new Error(
        'Open a website and click the Page Monitor toolbar icon first.',
      );
    const tabUrl = webUrl(tab.url);
    const granted = await chrome.permissions.request({
      origins: [originPattern(tabUrl)],
    });
    if (!granted)
      throw new Error(
        'Site access was denied. Allow access to select and monitor this page.',
      );
    applyView(await request({ type: 'pick', tabId: tab.id, url: tabUrl }));
    message('Click a region on the page. Press Escape to cancel.');
  } catch (error) {
    fail(error);
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;
  const value: MonitorInput = {
    name: name.value.trim(),
    url: url.value,
    selector: selector.value.trim(),
    renderJavaScript: renderJavaScript.checked,
    intervalSeconds: Number(interval.value) * Number(units.value),
    durationMinutes:
      durationMode.value === 'duration' ? Number(duration.value) : null,
  };
  try {
    value.url = webUrl(value.url);
    if (!inputValid(value))
      throw new Error(
        'Enter a name, region, interval of 30 seconds to 24 hours, and a valid duration.',
      );
  } catch (error) {
    fail(error);
    return;
  }
  // Invoke the permission request directly from the submit gesture.
  const targetId = editingId;
  const permission = chrome.permissions.request({
    origins: [originPattern(value.url)],
  });
  busy = true;
  form.setAttribute('aria-busy', 'true');
  const locked = Array.from(
    form.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >('input,select,button'),
  ).map((node) => ({ node, disabled: node.disabled }));
  locked.forEach(({ node }) => {
    node.disabled = true;
  });
  newMonitor.disabled = true;
  submit.disabled = true;
  void (async () => {
    try {
      if (!(await permission))
        throw new Error(
          'Site access was denied. Your monitor has not been saved.',
        );
      const view = await request(
        targetId
          ? { type: 'update', id: targetId, input: value }
          : { type: 'create', input: value },
      );
      resetForm();
      applyView(view);
      form.hidden = true;
      newMonitor.focus();
      message('Monitor saved.');
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
      form.setAttribute('aria-busy', 'false');
      locked.forEach(({ node, disabled }) => {
        node.disabled = disabled;
      });
      newMonitor.disabled = false;
      submit.disabled = false;
      if (form.hidden) newMonitor.focus();
    }
  })();
});
function date(value: number | null): string {
  return value === null ? 'Not checked yet' : new Date(value).toLocaleString();
}
function edit(m: Monitor): void {
  if (busy) return;
  invalidatePreview();
  editingId = m.id;
  editWarning.hidden = false;
  form.hidden = false;
  formTitle.textContent = 'Edit monitor';
  name.value = m.name;
  url.value = m.url;
  selector.value = m.selector;
  renderJavaScript.checked = !!m.renderJavaScript;
  units.value = m.intervalSeconds % 60 === 0 ? '60' : '1';
  interval.value = String(m.intervalSeconds / Number(units.value));
  interval.min = units.value === '1' ? '30' : '1';
  interval.max = String(86400 / Number(units.value));
  durationMode.value = m.durationMinutes === null ? 'forever' : 'duration';
  duration.value = String(m.durationMinutes ?? 60);
  durationField.hidden = m.durationMinutes === null;
  duration.required = !durationField.hidden;
  sample.textContent = m.snapshot ?? 'No snapshot yet.';
  submit.textContent = 'Save changes';
  cancel.hidden = false;
  name.focus();
  form.scrollIntoView({ block: 'start', behavior: 'instant' });
  rememberEditor();
}
async function mutate(requestValue: Request, success: string): Promise<void> {
  if (!('id' in requestValue) || pendingActions.has(requestValue.id)) return;
  const id = requestValue.id;
  const before = monitors.find((m) => m.id === id);
  pendingActions.set(id, requestValue.type);
  viewVersion++;
  renderMonitors();
  if (requestValue.type === 'check')
    message('Checking page… JavaScript pages can take up to 20 seconds.');
  try {
    const view = await request(requestValue);
    applyView(view);
    const updated = view.monitors.find((m) => m.id === id);
    if (
      requestValue.type === 'check' &&
      updated &&
      !updated.enabled &&
      updated.endsAt !== null &&
      updated.endsAt <= Date.now()
    )
      message(
        'Monitoring duration has ended. Resume to start a new monitoring period.',
      );
    else if (requestValue.type === 'check' && updated?.error)
      message(`Check failed: ${updated.error}`, true);
    else if (requestValue.type === 'check')
      message(
        before?.snapshot === null
          ? 'Baseline saved. Future changes will notify you.'
          : before?.snapshot !== updated?.snapshot
            ? 'Change detected. Your history has been updated.'
            : 'Checked just now. No change detected.',
      );
    else message(success);
  } catch (error) {
    fail(error);
  } finally {
    pendingActions.delete(id);
    renderMonitors();
  }
}
const cards = new Map<string, { node: HTMLElement; value: string }>();
function renderMonitors(): void {
  const unread = monitors.reduce((total, monitor) => total + monitor.unread, 0);
  const attention = monitors.filter((monitor) => monitor.error).length;
  const active = monitors.filter(
    (monitor) =>
      monitor.enabled &&
      !(monitor.endsAt !== null && monitor.endsAt <= Date.now()),
  ).length;
  overview.textContent = `${active} active · ${unread} unread${attention ? ` · ${attention} need attention` : ''}`;
  filters.hidden = monitors.length === 0;
  toolbar.hidden = monitors.length === 0;
  list.querySelector('.empty')?.remove();
  const query = search.value.trim().toLocaleLowerCase();
  const visible = (m: Monitor) => {
    const matchesQuery = `${m.name} ${m.url}`
      .toLocaleLowerCase()
      .includes(query);
    const finished =
      !m.enabled || (m.endsAt !== null && m.endsAt <= Date.now());
    return (
      matchesQuery &&
      (filter.value === 'all' ||
        (filter.value === 'unread' && m.unread > 0) ||
        (filter.value === 'attention' && !!m.error) ||
        (filter.value === 'watching' && !finished) ||
        (filter.value === 'paused' && finished))
    );
  };
  const shown = monitors.filter(visible).length;
  count.textContent =
    shown === monitors.length
      ? String(shown)
      : `${shown} of ${monitors.length}`;
  for (const [id, card] of cards)
    if (!monitors.some((m) => m.id === id)) {
      const focused = card.node.contains(document.activeElement);
      card.node.remove();
      cards.delete(id);
      if (focused) listHeading.focus();
    }
  if (!monitors.length) {
    const empty = el('div', '', 'empty');
    empty.append(
      el('h3', 'No monitors'),
      el(
        'p',
        'Add a monitor to receive notifications when selected text changes.',
      ),
    );
    list.append(empty);
    return;
  }
  for (const m of monitors) {
    const previous = cards.get(m.id);
    const inProgress = pendingActions.has(m.id) || checkingId === m.id;
    const serialized = JSON.stringify([
      m,
      pendingActions.get(m.id),
      checkingId === m.id,
    ]);
    if (previous) previous.node.hidden = !visible(m);
    if (previous?.value === serialized) continue;
    const focused = previous?.node.contains(document.activeElement)
      ? ((document.activeElement as HTMLElement).dataset.action ??
        previous?.node.dataset.focusAction)
      : undefined;
    const openDetails = new Set(
      Array.from(
        previous?.node.querySelectorAll<HTMLDetailsElement>('details[open]') ??
          [],
      ).map((node) => node.dataset.detailKey),
    );
    const scrollPositions = new Map(
      Array.from(
        previous?.node.querySelectorAll<HTMLElement>('[data-scroll-key]') ?? [],
      ).map((node) => [node.dataset.scrollKey, node.scrollTop]),
    );
    const disclosure = (label: string, key: string, className: string) => {
      const details = el('details', '', className);
      details.dataset.detailKey = key;
      details.setAttribute('aria-label', label);
      details.open = openDetails.has(key);
      const summary = el('summary', label);
      summary.dataset.action = `detail:${key}`;
      details.append(summary);
      return details;
    };
    const snapshot = (text: string, key: string) => {
      const pre = el('pre', text);
      pre.dataset.scrollKey = key;
      return pre;
    };
    const card = el('article', '', 'monitor');
    card.setAttribute('aria-label', m.name);
    card.tabIndex = -1;
    if (focused) card.dataset.focusAction = focused;
    card.hidden = !visible(m);
    card.setAttribute('aria-busy', String(inProgress));
    card.dataset.state = inProgress
      ? 'checking'
      : !m.enabled
        ? 'paused'
        : m.error
          ? 'error'
          : 'active';
    const top = el('div', '', 'card-top');
    top.append(
      el('h3', m.name),
      el(
        'span',
        checkingId === m.id || pendingActions.get(m.id) === 'check'
          ? 'Checking…'
          : !m.enabled
            ? m.endsAt !== null && m.endsAt <= Date.now()
              ? 'Finished'
              : 'Paused'
            : m.error
              ? 'Needs attention'
              : m.snapshot === null
                ? 'First check pending'
                : 'Active',
        'pill',
      ),
    );
    const link = el('a', m.url, 'url');
    link.dataset.action = 'open';
    link.href = webUrl(m.url);
    link.title = m.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    card.append(
      top,
      link,
      el(
        'p',
        `Every ${m.intervalSeconds >= 60 && m.intervalSeconds % 60 === 0 ? `${m.intervalSeconds / 60} min` : `${m.intervalSeconds} sec`} · ${m.endsAt ? `Until ${date(m.endsAt)}` : 'Until stopped'}`,
        'meta',
      ),
      el(
        'p',
        `Last check: ${date(m.lastCheckAt)}${m.source ? ` · ${m.source === 'tab' ? 'Open tab' : m.source === 'rendered' ? 'Temporary tab · JavaScript' : 'Background request'}` : ''}`,
        'meta',
      ),
    );
    if (m.renderingRequired)
      card.append(
        el(
          'p',
          'Requires JavaScript. Checks without an open tab use a temporary background tab.',
          'hint',
        ),
      );
    if (m.error) card.append(el('p', m.error, 'check-error'));
    if (m.unread)
      card.append(
        el(
          'p',
          `${m.unread} unread ${m.unread === 1 ? 'change' : 'changes'}`,
          'unread',
        ),
      );
    const controls = el('div', '', 'actions');
    const action = (
      label: string,
      key: string,
      handler: () => void,
    ): HTMLButtonElement => {
      const b = button(label, handler, 'small');
      b.dataset.action = key;
      b.disabled = inProgress;
      controls.append(b);
      return b;
    };
    const check = action(
      checkingId === m.id || pendingActions.get(m.id) === 'check'
        ? 'Checking…'
        : 'Check now',
      'check',
      () => {
        void mutate({ type: 'check', id: m.id }, 'Check completed.');
      },
    );
    check.disabled = inProgress || !m.enabled;
    if (!m.enabled) check.title = 'Resume this monitor before checking.';
    action(m.enabled ? 'Pause' : 'Resume', 'toggle', () => {
      void mutate(
        { type: 'toggle', id: m.id, enabled: !m.enabled },
        m.enabled ? 'Monitor paused.' : 'Monitor resumed.',
      );
    });
    action('Edit', 'edit', () => edit(m));
    const remove = action('Delete', 'delete', () => {
      confirm.hidden = false;
      confirmButton.focus();
    });
    const confirm = el('div', '', 'confirm');
    confirm.hidden =
      previous?.node.querySelector<HTMLElement>('.confirm')?.hidden ?? true;
    confirm.append(el('p', 'Delete this monitor and its saved history?'));
    const confirmButton = button(
      'Delete monitor',
      () => {
        void mutate({ type: 'delete', id: m.id }, 'Monitor deleted.');
      },
      'danger',
    );
    confirmButton.dataset.action = 'confirm-delete';
    confirmButton.disabled = inProgress;
    const keep = button('Keep monitor', () => {
      confirm.hidden = true;
      remove.focus();
    });
    keep.dataset.action = 'keep';
    confirm.append(confirmButton, keep);
    const history = el('details', '', 'history');
    history.dataset.detailKey = 'history';
    history.open = openDetails.has('history');
    const summary = el('summary', `Change history (${m.history.length})`);
    summary.dataset.action = 'history';
    history.append(summary);
    if (!m.history.length)
      history.append(
        el(
          'p',
          m.snapshot === null
            ? 'The first successful check sets your baseline.'
            : 'Baseline saved. No text changes detected yet.',
          'hint',
        ),
      );
    if (m.unread) {
      const read = button(
        'Mark changes read',
        () => {
          void mutate({ type: 'read', id: m.id }, 'Changes marked as read.');
        },
        'small',
      );
      read.dataset.action = 'read';
      read.disabled = inProgress;
      history.append(read);
    }
    let historyLoaded = false;
    const loadHistory = () => {
      if (historyLoaded) return;
      historyLoaded = true;
      if (m.history.length)
        history.append(
          el(
            'p',
            'Underlined text was added. Struck-through text was removed.',
            'hint',
          ),
        );
      for (const change of m.history) {
        const entry = el('div', '', 'change');
        const highlighted = el('div', '', 'text-diff');
        highlighted.setAttribute('aria-label', 'Highlighted text changes');
        highlighted.dataset.scrollKey = `diff:${change.id}`;
        for (const part of textDiff(change.before, change.after)) {
          const node = el(
            part.kind === 'added'
              ? 'ins'
              : part.kind === 'removed'
                ? 'del'
                : 'span',
            part.text,
          );
          if (part.kind !== 'same')
            node.title = part.kind === 'added' ? 'Added text' : 'Removed text';
          highlighted.append(node);
        }
        const raw = disclosure(
          'Full before and after',
          `change:${change.id}`,
          'raw-change',
        );
        raw.append(
          el('h4', 'Before'),
          snapshot(change.before, `before:${change.id}`),
          el('h4', 'After'),
          snapshot(change.after, `after:${change.id}`),
        );
        entry.append(el('p', date(change.at), 'meta'), highlighted, raw);
        history.append(entry);
      }
    };
    history.addEventListener('toggle', () => {
      if (history.open) loadHistory();
    });
    if (history.open) loadHistory();
    card.append(controls, confirm);
    if (m.snapshot !== null) {
      const currentText = disclosure('Current text', 'snapshot', 'snapshot');
      const preview = htmlPreview(m.snapshotHtml, m.snapshot);
      preview.dataset.scrollKey = 'snapshot';
      currentText.append(preview);
      card.append(currentText);
    }
    card.append(history);
    if (previous) previous.node.replaceWith(card);
    else list.append(card);
    cards.set(m.id, { node: card, value: serialized });
    for (const node of card.querySelectorAll<HTMLElement>('[data-scroll-key]'))
      node.scrollTop = scrollPositions.get(node.dataset.scrollKey) ?? 0;
    if (focused) {
      const target = Array.from(
        card.querySelectorAll<HTMLElement>('[data-action]'),
      ).find((node) => node.dataset.action === focused);
      if (target instanceof HTMLButtonElement && target.disabled)
        card.focus({ preventScroll: true });
      else
        (target ?? history.querySelector('summary') ?? card).focus({
          preventScroll: true,
        });
    }
  }
  if (!shown && monitors.length) {
    const empty = el('div', '', 'empty');
    empty.append(
      el('h3', 'No matching monitors'),
      el('p', 'Try a different search or show all monitors.'),
      button(
        'Clear filters',
        () => {
          search.value = '';
          filter.value = 'all';
          renderMonitors();
          search.focus();
        },
        'small',
      ),
    );
    list.append(empty);
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    (area === 'local' && changes.pageMonitor) ||
    (area === 'session' && (changes.draft || changes.checkingMonitor))
  )
    void refresh();
});
form.addEventListener('input', rememberEditor);
form.addEventListener('change', rememberEditor);
async function restoreEditor(): Promise<void> {
  const version = viewVersion;
  try {
    const [saved, view] = await Promise.all([
      editorWindow.then(readEditorDraft),
      request({ type: 'list' }),
    ]);
    if (saved && !editorTouched) {
      if (
        saved.editingId &&
        !view.monitors.some((monitor) => monitor.id === saved.editingId)
      ) {
        await storeEditor(null);
        message(
          'The monitor you were editing was removed. Start a new monitor when ready.',
        );
      } else {
        editingId = saved.editingId;
        name.value = saved.name;
        url.value = saved.url;
        selector.value = saved.selector;
        interval.value = saved.interval;
        units.value = saved.units;
        interval.min = units.value === '1' ? '30' : '1';
        interval.max = String(86400 / Number(units.value));
        durationMode.value = saved.durationMode;
        duration.value = saved.duration;
        durationField.hidden = saved.durationMode !== 'duration';
        duration.required = !durationField.hidden;
        renderJavaScript.checked = saved.renderJavaScript;
        editWarning.hidden = !editingId;
        formTitle.textContent = editingId ? 'Edit monitor' : 'New monitor';
        submit.textContent = editingId ? 'Save changes' : 'Start monitoring';
        cancel.hidden = false;
        initialized = true;
        form.hidden = false;
        editorStatus.textContent = 'Draft restored.';
        invalidatePreview();
      }
    }
    if (editorTouched) initialized = true;
    if (version === viewVersion) applyView(view);
  } catch (error) {
    if (version === viewVersion) fail(error);
    refreshAgain = true;
  } finally {
    editorRestoring = false;
    if (refreshAgain) void refresh();
  }
}
void restoreEditor();
