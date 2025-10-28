(function () {
  'use strict';

  if (window.__autofillTestHarness) {
    return;
  }

  const HARNESS_VERSION = '2025.10.28';
  const EVENT_TYPES = ['focus', 'blur', 'input', 'change'];
  const GROUPABLE_SELECTORS =
    'input, textarea, select, [contenteditable][data-autofill-key], [data-autofill-key][contenteditable]';

  const scriptUrl = (() => {
    const current = document.currentScript;
    if (current && current.src) {
      return new URL(current.src, window.location.href);
    }
    return new URL('./lib/harness.js', window.location.href);
  })();

  const TESTBED_ROOT = new URL('../', scriptUrl).href;
  const SAMPLE_RESUME_URL = new URL('fixtures/sample-resume.json', TESTBED_ROOT).href;

  const urlParams = new URLSearchParams(window.location.search);
  const seedParam = urlParams.get('seed');
  const initialSeed = Number.isFinite(Number(seedParam)) ? Number(seedParam) : Math.floor(Math.random() * 1e6);

  const state = {
    seed: initialSeed,
    rng: mulberry32(initialSeed),
    fields: [],
    groups: new Map(),
    forms: new Set(),
    sampleData: null,
    samplePromise: null,
    noiseEnabled: false,
    renameEnabled: false,
    shadowEnabled: false,
    loggingEnabled: false,
    noiseWrappers: new Map(),
    originalPositions: [],
    originalGroupOrder: new Map(),
    attrSnapshots: new Map(),
    logListeners: [],
    logEntries: [],
    panel: null,
    statusEl: null,
    logEl: null,
    diffEl: null,
    samplePreEl: null,
  };

  function init() {
    state.fields = collectFields();
    buildGroups();
    buildPanel();
    state.forms = new Set(state.fields.map((field) => field.element.form).filter(Boolean));
    exposeApi();
    setStatus(`Harness ready · seed=${state.seed} · fields=${state.fields.length}`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function collectFields() {
    const nodes = Array.from(document.querySelectorAll(GROUPABLE_SELECTORS));
    const fields = [];
    nodes.forEach((node, index) => {
      const key = node.dataset.autofillKey;
      if (!key) return;
      const identifier = computeIdentifier(node, index);
      fields.push({
        element: node,
        key,
        identifier,
        label: findLabel(node),
        type: detectFieldType(node),
      });
      if (!node.dataset.harnessIndex) {
        node.dataset.harnessIndex = String(index);
      }
    });
    return fields;
  }

  function buildGroups() {
    state.groups.clear();
    state.fields.forEach((field) => {
      if (!state.groups.has(field.key)) {
        state.groups.set(field.key, []);
      }
      state.groups.get(field.key).push(field);
    });
  }

  function buildPanel() {
    const panel = document.createElement('aside');
    panel.className = 'testbed-panel';
    panel.innerHTML = `
      <div>
        <h2>Test Harness</h2>
        <p class="testbed-panel__status"></p>
      </div>
      <div class="testbed-panel__row">
        <button type="button" data-action="fill">Fill sample</button>
        <button type="button" data-action="diff">Diff vs expected</button>
      </div>
      <div class="testbed-panel__row">
        <button type="button" data-action="noise" aria-pressed="false">DOM noise</button>
        <button type="button" data-action="rename" aria-pressed="false">Rename attributes</button>
      </div>
      <div class="testbed-panel__row">
        <button type="button" data-action="shadow" aria-pressed="false"${hasShadowTargets() ? '' : ' disabled'}>
          Shadowize
        </button>
        <button type="button" data-action="log" aria-pressed="false">Log events</button>
      </div>
      <div class="testbed-panel__row">
        <button type="button" data-action="reset">Reset page</button>
      </div>
      <details data-action="sample">
        <summary>Sample resume</summary>
        <pre class="testbed-panel__sample">Loading sample…</pre>
      </details>
      <div class="testbed-panel__log" aria-live="polite"></div>
      <div class="testbed-diff" hidden></div>
    `;

    panel.addEventListener('click', onPanelClick);
    document.body.append(panel);

    state.panel = panel;
    state.statusEl = panel.querySelector('.testbed-panel__status');
    state.logEl = panel.querySelector('.testbed-panel__log');
    state.diffEl = panel.querySelector('.testbed-diff');
    state.samplePreEl = panel.querySelector('.testbed-panel__sample');

    preloadSample();
  }

  function onPanelClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset.action;
    if (!action) return;

    switch (action) {
      case 'fill':
        fillFromSample();
        break;
      case 'diff':
        runDiff();
        break;
      case 'noise':
        toggleDomNoise(target);
        break;
      case 'rename':
        toggleRename(target);
        break;
      case 'shadow':
        toggleShadow(target);
        break;
      case 'log':
        toggleLogging(target);
        break;
      case 'reset':
        window.location.reload();
        break;
      default:
        break;
    }
  }

  function preloadSample() {
    loadSampleData()
      .then((data) => {
        if (state.samplePreEl) {
          state.samplePreEl.textContent = JSON.stringify(data, null, 2);
        }
      })
      .catch((error) => {
        console.error('[Harness] Failed to load sample resume', error);
        if (state.samplePreEl) {
          state.samplePreEl.textContent = `Failed to load sample resume: ${error.message}`;
        }
      });
  }

  function loadSampleData() {
    if (state.samplePromise) {
      return state.samplePromise;
    }
    state.samplePromise = fetch(SAMPLE_RESUME_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return response.json();
      })
      .then((data) => {
        state.sampleData = data;
        return data;
      });
    return state.samplePromise;
  }

  function fillFromSample() {
    loadSampleData()
      .then((data) => {
        const expected = computeExpectedValueMap(data);
        setValues(expected);
        setStatus('Filled sample data');
      })
      .catch((error) => {
        setStatus(`Sample fill failed: ${error.message}`);
      });
  }

  function runDiff() {
    loadSampleData()
      .then((data) => {
        const expected = computeExpectedValueMap(data);
        const actual = getValues();
        const rows = [];
        const keys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)])).sort();

        keys.forEach((key) => {
          const expectedValue = normalizeValue(expected[key]);
          const actualValue = normalizeValue(actual[key]);
          const pass = expectedValue === actualValue;
          rows.push({
            key,
            expected: expectedValue,
            actual: actualValue,
            pass,
          });
        });

        renderDiff(rows);
        setStatus(`Diff complete · ${rows.filter((row) => row.pass).length}/${rows.length} fields match`);
      })
      .catch((error) => {
        setStatus(`Diff failed: ${error.message}`);
      });
  }

  function toggleDomNoise(button) {
    const nextState = !state.noiseEnabled;
    if (nextState) {
      enableDomNoise();
    } else {
      disableDomNoise();
    }
    state.noiseEnabled = nextState;
    button.setAttribute('aria-pressed', String(nextState));
    setStatus(nextState ? 'DOM noise enabled' : 'DOM noise disabled');
  }

  function enableDomNoise() {
    state.originalPositions = state.fields.map((field) => ({
      element: field.element,
      parent: field.element.parentNode,
      nextSibling: field.element.nextSibling,
    }));

    state.fields.forEach((field) => {
      const wrapper = document.createElement('div');
      wrapper.dataset.harnessNoise = 'true';
      wrapper.className = `testbed-noise-wrapper ${randomToken('noise')}`;
      if (!field.element.parentNode) return;
      field.element.parentNode.insertBefore(wrapper, field.element);
      wrapper.append(field.element);
      state.noiseWrappers.set(field.element, wrapper);
    });

    const fieldsets = Array.from(
      new Set(
        state.fields
          .map((field) => field.element.closest('fieldset'))
          .filter((node) => node && node.parentElement),
      ),
    );

    fieldsets.forEach((fieldset) => {
      const children = Array.from(fieldset.children);
      state.originalGroupOrder.set(fieldset, children);
      const shuffled = shuffleArray(children.slice(), state.rng);
      shuffled.forEach((child) => fieldset.appendChild(child));
    });
  }

  function disableDomNoise() {
    state.originalPositions
      .slice()
      .reverse()
      .forEach((snapshot) => {
        const { element, parent, nextSibling } = snapshot;
        if (!parent || !element) return;
        parent.insertBefore(element, nextSibling || null);
      });

    state.noiseWrappers.forEach((wrapper) => {
      if (wrapper.isConnected) {
        wrapper.remove();
      }
    });

    state.originalGroupOrder.forEach((children, fieldset) => {
      children.forEach((child) => fieldset.appendChild(child));
    });

    state.noiseWrappers.clear();
    state.originalPositions = [];
    state.originalGroupOrder.clear();
  }

  function toggleRename(button) {
    const nextState = !state.renameEnabled;
    if (nextState) {
      enableRename();
    } else {
      disableRename();
    }
    state.renameEnabled = nextState;
    button.setAttribute('aria-pressed', String(nextState));
    setStatus(nextState ? 'Attribute renaming enabled' : 'Attribute renaming disabled');
  }

  function enableRename() {
    state.fields.forEach((field) => {
      const el = field.element;
      const snapshot = {
        id: el.getAttribute('id'),
        name: el.getAttribute('name'),
        className: el.className,
        autocomplete: el.getAttribute('autocomplete'),
      };
      state.attrSnapshots.set(el, snapshot);

      el.id = randomToken('id');
      el.name = randomToken('name');
      el.className = `input-${randomToken('cls')}`;
      if (el.hasAttribute('autocomplete')) {
        el.setAttribute('autocomplete', 'off');
      }
    });
  }

  function disableRename() {
    state.attrSnapshots.forEach((snapshot, element) => {
      if (snapshot.id == null) {
        element.removeAttribute('id');
      } else {
        element.id = snapshot.id;
      }
      if (snapshot.name == null) {
        element.removeAttribute('name');
      } else {
        element.name = snapshot.name;
      }
      element.className = snapshot.className || '';
      if (snapshot.autocomplete == null) {
        element.removeAttribute('autocomplete');
      } else {
        element.setAttribute('autocomplete', snapshot.autocomplete);
      }
    });

    state.attrSnapshots.clear();
  }

  function toggleShadow(button) {
    if (state.shadowEnabled) {
      window.location.reload();
      return;
    }
    if (!enableShadow()) {
      setStatus('No shadow targets found');
      return;
    }
    state.shadowEnabled = true;
    button.setAttribute('aria-pressed', 'true');
    button.textContent = 'Shadowize (reload to reset)';
    setStatus('Shadow DOM applied');
  }

  function hasShadowTargets() {
    return document.querySelector('[data-harness-shadow]');
  }

  function enableShadow() {
    const targets = Array.from(document.querySelectorAll('[data-harness-shadow]'));
    if (!targets.length) return false;

    targets.forEach((target) => {
      const mode = target.dataset.harnessShadow === 'closed' ? 'closed' : 'open';
      const children = Array.from(target.childNodes);
      const shadowRoot = target.attachShadow({ mode });
      children.forEach((child) => shadowRoot.appendChild(child));
      target.dataset.harnessShadowAttached = mode;
    });

    return true;
  }

  function toggleLogging(button) {
    const nextState = !state.loggingEnabled;
    if (nextState) {
      enableLogging();
    } else {
      disableLogging();
    }
    state.loggingEnabled = nextState;
    button.setAttribute('aria-pressed', String(nextState));
    if (!nextState) {
      setStatus('Event logging disabled');
    }
  }

  function enableLogging() {
    const log = (message) => appendLog(message);
    state.logEntries = [];
    if (state.logEl) {
      state.logEl.textContent = '';
    }

    state.fields.forEach((field) => {
      EVENT_TYPES.forEach((type) => {
        const handler = (event) => {
          const value = readFieldValue(field.element);
          log(`${type.toUpperCase()} · ${field.key} → ${truncate(value)}`);
        };
        field.element.addEventListener(type, handler);
        state.logListeners.push({ element: field.element, type, handler });
      });
    });

    state.forms.forEach((form) => {
      const handler = (event) => {
        event.preventDefault();
        log(`SUBMIT · blocked for safety (${form.id || 'form'})`);
      };
      form.addEventListener('submit', handler);
      state.logListeners.push({ element: form, type: 'submit', handler });
    });

    setStatus('Event logging enabled');
  }

  function disableLogging() {
    state.logListeners.forEach(({ element, type, handler }) => {
      element.removeEventListener(type, handler);
    });
    state.logListeners = [];
  }

  function appendLog(message) {
    const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
    const entry = `${timestamp} ${message}`;
    state.logEntries.push(entry);
    if (state.logEntries.length > 80) {
      state.logEntries.shift();
    }
    if (state.logEl) {
      state.logEl.textContent = state.logEntries.join('\n');
    }
  }

  function renderDiff(rows) {
    if (!state.diffEl) return;
    state.diffEl.hidden = false;
    if (!rows.length) {
      state.diffEl.textContent = 'No fields to compare.';
      return;
    }
    state.diffEl.innerHTML = `
      <div class="testbed-diff__content">
        ${rows
          .map((row) => {
            const statusClass = row.pass ? 'testbed-diff__status--pass' : 'testbed-diff__status--fail';
            const expectedDisplay = row.expected ? row.expected : '[empty]';
            const actualDisplay = row.actual ? row.actual : '[empty]';
            return `
              <div class="testbed-diff__row">
                <span class="testbed-diff__key">${escapeHtml(row.key)}</span>
                <span class="testbed-diff__value testbed-diff__value--expected">exp: ${escapeHtml(expectedDisplay)}</span>
                <span class="testbed-diff__value testbed-diff__value--actual">act: ${escapeHtml(actualDisplay)}</span>
                <span class="testbed-diff__status ${statusClass}">${row.pass ? 'PASS' : 'FAIL'}</span>
              </div>`;
          })
          .join('')}
      </div>
    `;
  }

  function computeExpectedValueMap(sampleData) {
    const result = {};
    state.groups.forEach((fields, key) => {
      const resolved = resolvePath(sampleData, key);
      if (resolved === undefined || resolved === null) return;
      result[key] = serializeResolvedValue(resolved);
    });
    return result;
  }

  function getValues() {
    const result = {};
    state.groups.forEach((fields, key) => {
      const value = readGroupValue(fields);
      if (value !== undefined) {
        result[key] = value;
      }
    });
    return result;
  }

  function setValues(map) {
    Object.entries(map).forEach(([key, value]) => {
      const fields = state.groups.get(key);
      if (!fields) return;
      writeGroupValue(fields, value);
    });
  }

  function readGroupValue(fields) {
    if (!fields.length) return '';

    const element = fields[0].element;
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const checked = fields.find((field) => field.element.checked);
      if (!checked) return '';
      return checked.element.value;
    }

    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      const selected = fields.filter((field) => field.element.checked).map((field) => field.element.value);
      return selected;
    }

    if (element instanceof HTMLSelectElement && element.multiple) {
      return Array.from(element.selectedOptions).map((option) => option.value);
    }

    if (fields.length === 1) {
      return readFieldValue(element);
    }

    return fields.map((field) => readFieldValue(field.element));
  }

  function writeGroupValue(fields, value) {
    if (!fields.length) return;

    const element = fields[0].element;
    const values = Array.isArray(value) ? value.map(String) : [String(value)];

    if (element instanceof HTMLInputElement && element.type === 'radio') {
      fields.forEach((field) => {
        field.element.checked = values.includes(field.element.value);
        if (field.element.checked) {
          field.element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      return;
    }

    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      fields.forEach((field) => {
        field.element.checked = values.includes(field.element.value);
        field.element.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return;
    }

    if (element instanceof HTMLSelectElement && element.multiple) {
      Array.from(element.options).forEach((option) => {
        option.selected = values.includes(option.value);
      });
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (fields.length === 1) {
      writeFieldValue(element, values[0]);
      return;
    }

    fields.forEach((field, index) => {
      writeFieldValue(field.element, values[index] ?? '');
    });
  }

  function readFieldValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.type === 'file') {
        return element.files && element.files.length ? Array.from(element.files).map((file) => file.name) : '';
      }
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      return element.value;
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      return element.textContent || '';
    }
    return '';
  }

  function writeFieldValue(element, value) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function computeIdentifier(element, index) {
    if (element.getAttribute('name')) return element.getAttribute('name');
    if (element.id) return element.id;
    if (element.dataset?.autofillKey) return `key:${element.dataset.autofillKey}`;
    return `field-${index}`;
  }

  function findLabel(element) {
    if (element instanceof HTMLElement) {
      const label = element.closest('label');
      if (label) {
        return label.textContent?.trim() || '';
      }
    }
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label) {
        return label.textContent?.trim() || '';
      }
    }
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/);
      const text = ids
        .map((id) => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    return '';
  }

  function detectFieldType(element) {
    if (element instanceof HTMLInputElement) {
      return element.type || 'text';
    }
    if (element instanceof HTMLSelectElement) {
      return element.multiple ? 'select-multiple' : 'select-one';
    }
    if (element instanceof HTMLTextAreaElement) return 'textarea';
    if (element instanceof HTMLElement && element.isContentEditable) return 'contenteditable';
    return 'unknown';
  }

  function resolvePath(source, path) {
    if (!path) return undefined;
    const normalized = path.replace(/\[(\d+)\]/g, '.$1');
    const parts = normalized.split('.').filter(Boolean);
    let current = source;
    for (const part of parts) {
      if (current == null) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }

  function serializeResolvedValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => serializeResolvedValue(item)).join('; ');
    }
    if (typeof value === 'object') {
      if ('text' in value && typeof value.text === 'string') {
        return value.text;
      }
      return JSON.stringify(value);
    }
    return '';
  }

  function normalizeValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) {
      return value.join('; ');
    }
    return String(value);
  }

  function randomToken(prefix) {
    const randomValue = Math.floor(state.rng() * 1e8)
      .toString(36)
      .slice(-6);
    return `${prefix}-${randomValue}`;
  }

  function shuffleArray(array, rng) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function mulberry32(seed) {
    let t = seed;
    return function () {
      t |= 0;
      t = (t + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function truncate(value, max = 40) {
    const str = Array.isArray(value) ? value.join('; ') : String(value ?? '');
    if (str.length <= max) return str;
    return `${str.slice(0, max - 1)}…`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setStatus(message) {
    if (state.statusEl) {
      state.statusEl.textContent = message;
    }
    if (state.loggingEnabled) {
      appendLog(`STATUS · ${message}`);
    }
  }

  function exposeApi() {
    window.__autofillTestHarness = {
      version: HARNESS_VERSION,
      getSchemaMap() {
        const map = {};
        state.fields.forEach((field) => {
          map[field.identifier] = field.key;
        });
        return map;
      },
      getValues,
      setValues,
      reset() {
        window.location.reload();
      },
    };
  }
})();
