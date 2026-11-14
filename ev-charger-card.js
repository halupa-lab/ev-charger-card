/**
 * ev-charger-card — ElectroS EV charger card for Home Assistant, in the style of deye-flow-card.
 * Rebuilt step by step from the POC card 0.3.0. Installed through HACS.
 *
 * view: all (default) | charge | money
 *   charge — charger state, where the car power comes from now, start / stop, charge current, "hold home battery"
 *   money  — kWh by source (solar / home battery / grid night / grid day) and UAH for grid,
 *            for one charging session, a day, a month or a year (switcher at the bottom, like deye-flow-card)
 *
 * Needs the HA packages from halupa-lab/ev-charger-packages and the ElectroS integration fork
 * halupa-lab/electros-ev-local-ha (v1.8.0+: fixed entity IDs switch.electros_charging, sensor.electros_status, ...).
 * The defaults below are those IDs, so the card YAML can be just: type: custom:ev-charger-card
 */
const CARD_VERSION = '0.2.1';
// Same element as the POC card, which this file replaces: the POC file /local/ev-charger-card.js and its
// dashboard resource must be removed, or whichever file loads first wins.
const ELEMENT = 'ev-charger-card';

const COLORS = {
  solar: '#34c46a',
  battery: '#4aa8ff',
  night: '#8f6bff',
  day: '#ff7a59',
  car: '#f5b400',
  warn: '#ff5252',
  idle: 'var(--secondary-text-color)',
};

const DEFAULTS = {
  title: 'Зарядка авто',
  status: 'sensor.electros_status',
  switch: 'switch.electros_charging',
  current: 'number.electros_charging_current',
  measured_current: 'sensor.electros_measured_current',
  set_current: 'sensor.electros_set_current', // the value really stored in the charger
  voltage: 'sensor.electros_voltage',
  power: 'sensor.ev_charger_power',
  solar_power: 'sensor.ev_charger_solar_power',
  battery_power: 'sensor.ev_charger_battery_power',
  grid_power: 'sensor.ev_charger_grid_power',
  hold: 'input_boolean.ev_battery_hold',
  hold_timer: 'timer.ev_battery_hold_limit',
  night: 'input_boolean.ev_night_mode',
  battery_soc: 'sensor.deye_inverter_battery',
  timer: 'sensor.electros_timer',              // the timer stored in the charger (integration fork 1.6+)
  clock_offset: 'sensor.electros_clock_offset', // charger clock minus HA time, s
  charge_now: 'script.ev_charge_now',          // packages v0.4+: one-off charge past the night timer
  charge_now_flag: 'input_boolean.ev_charge_now',
  clock_warn: 60,       // s, show the charger clock offset above this
  min_current: 6,       // A, charger minimum
  max_current: 22,      // A, ceiling for the 5x2.5 line with C25 breaker (see working doc)
  current_step: 2,      // A, the charger accepts steps of 2 A
  charging_power: 50,   // W, above this the car counts as charging
  consumption: 20,      // kWh per 100 km, as the car shows it (energy from the car battery)
  charge_efficiency: 0.9, // share of energy from the wall that reaches the car battery (losses ~10 %)
  battery_warn: 150,    // W, car power from the home battery above this = warning
};

// Total energy counters (integrals) from ev_accounting.yaml; the card reads their change over a range from HA statistics.
const ENERGY = [
  { key: 'solar', base: 'ev_charger_solar_energy', label: 'Сонце', color: COLORS.solar },
  { key: 'battery', base: 'ev_charger_battery_energy', label: 'Батарея будинку', color: COLORS.battery },
  { key: 'night', base: 'ev_charger_grid_night_energy', label: 'Мережа, ніч', color: COLORS.night },
  { key: 'day', base: 'ev_charger_grid_day_energy', label: 'Мережа, день', color: COLORS.day },
];
const ENERGY_TOTAL = 'ev_charger_energy';
const COST_TOTAL = 'ev_charger_grid_cost';
const PERIODS = { session: 'Сеанс', day: 'День', month: 'Міс.', year: 'Рік' };
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
// Charging sessions are found in the 5-minute statistics of the energy counter.
// HA keeps 5-minute statistics for 10 days by default, so older sessions are not listed (use День / Міс. / Рік).
const SESSION_LOOKBACK_DAYS = 10;
const SESSION_GAP_MIN = 60;   // a pause shorter than this does not split a session (for example, the car pauses)
const SESSION_MIN_KWH = 0.01; // per 5 minutes; less is noise, not charging
const NIGHT_START = 23;       // night tariff 23:00-07:00 (same as ev_accounting.yaml and ev_night.yaml)
const NIGHT_END = 7;
const isNightHour = (d = new Date()) => d.getHours() >= NIGHT_START || d.getHours() < NIGHT_END;
const fmtHM = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fmtDM = (d) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
const fmtDur = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} год ${pad2(m % 60)} хв` : `${m} хв`;
};

const pad2 = (n) => String(n).padStart(2, '0');
const fmtW = (w) => (w == null ? '—' : Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`);
const fmtKwh = (v) => (v == null ? '—' : `${v.toFixed(2)} kWh`);
const fmtUah = (v) => (v == null ? '—' : `${v.toFixed(2)} грн`);
const pct = (part, sum) => (sum > 0 ? Math.round((part / sum) * 100) : 0);

const STYLES = `
  ha-card { padding: 16px; }
  .title { font-size: 1.15rem; font-weight: 600; margin-bottom: 12px; color: var(--primary-text-color); }
  .sep { border-top: 1px solid var(--divider-color, #ddd); margin: 16px -16px; }

  /* ---- state ---- */
  .status { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; cursor: pointer; outline: none; }
  .status:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); border-radius: 12px; }
  .sicon { flex: none; width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--c); color: var(--c); }
  .sicon ha-icon { --mdc-icon-size: 30px; }
  .stext { flex: 1 1 auto; min-width: 0; }
  .shead { font-size: 1.15rem; font-weight: 700; color: var(--c); }
  .ssub { font-size: 0.9rem; color: var(--secondary-text-color); margin-top: 2px; }
  .spower { flex: none; font-size: 1.6rem; font-weight: 700; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .spower:empty { display: none; }

  /* ---- where the power comes from ---- */
  .src { margin-bottom: 14px; }
  .src[hidden] { display: none; }
  .ehead { display: flex; justify-content: space-between; color: var(--secondary-text-color); margin-bottom: 6px; font-size: 0.9rem; }
  .ehead b { color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .bar { display: flex; gap: 3px; height: 12px; border-radius: 6px; overflow: hidden; background: var(--divider-color, #eee); }
  .bar span { min-width: 4px; transition: flex-grow 0.6s ease; }
  .legend { display: grid; grid-template-columns: 1fr auto auto; gap: 4px 12px; margin-top: 8px; font-size: 0.85rem; color: var(--secondary-text-color); }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .legend b { color: var(--primary-text-color); font-variant-numeric: tabular-nums; text-align: right; }
  .legend em { font-style: normal; text-align: right; min-width: 3em; font-variant-numeric: tabular-nums; }
  .legend .hot, .legend .hot b { color: ${COLORS.warn}; }
  .warn { margin-top: 10px; padding: 8px 10px; border-radius: 10px; font-size: 0.85rem; color: var(--primary-text-color); background: rgba(255, 82, 82, 0.15); border: 1px solid rgba(255, 82, 82, 0.5); }
  .warn:empty { display: none; }

  /* ---- controls ---- */
  .main { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border-radius: 12px; border: none; font: inherit; font-size: 1rem; font-weight: 600; cursor: pointer; color: var(--text-primary-color, #fff); background: var(--primary-color); }
  .main.stop { background: none; color: var(--primary-text-color); border: 2px solid var(--divider-color, #ddd); }
  .main:disabled { opacity: 0.45; cursor: default; }
  .main:focus-visible, .stepper button:focus-visible, .tog:focus-visible, .seg button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .main ha-icon { --mdc-icon-size: 22px; }
  .hint { font-size: 0.85rem; color: var(--secondary-text-color); margin: 6px 2px 12px; min-height: 1.2em; }
  .crow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--divider-color, #ddd); }
  .clabel { color: var(--primary-text-color); min-width: 0; }
  .clabel small { display: block; font-size: 0.8rem; color: var(--secondary-text-color); margin-top: 2px; }
  .stepper { display: flex; align-items: center; gap: 6px; flex: none; }
  .stepper button { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--divider-color, #ddd); background: none; color: var(--primary-color); font: inherit; font-size: 1.3rem; line-height: 1; cursor: pointer; }
  .stepper button:disabled { opacity: 0.3; cursor: default; }
  .stepper b { min-width: 3.2em; text-align: center; font-size: 1.1rem; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .stepper b.pending { color: var(--primary-color); }
  /* Off track: mid grey at half opacity, visible on light and dark cards (the divider colour was too faint). */
  .tog { flex: none; position: relative; width: 46px; height: 26px; border-radius: 13px; border: none; cursor: pointer; background: rgba(127, 127, 127, 0.5); transition: background 0.2s; }
  .tog::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 0.2s; }
  .tog[aria-checked='true'] { background: ${COLORS.battery}; }
  .tog[aria-checked='true']::after { left: 23px; }
  .tog:disabled { opacity: 0.4; cursor: default; }

  /* ---- money ---- */
  .mhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
  .mhead .title { margin: 0; }
  .seg { display: flex; gap: 3px; flex: none; }
  .navbar .seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .navbar .seg button { padding: 5px 0; font-size: 0.8rem; }
  .seg button { background: none; border: 1px solid var(--divider-color, #ddd); color: var(--secondary-text-color); font: inherit; font-size: 0.75rem; border-radius: 7px; padding: 3px 7px; cursor: pointer; white-space: nowrap; }
  .seg button.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .money { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .mtile { border-radius: 12px; padding: 12px; border: 1px solid var(--divider-color, #ddd); min-width: 0; }
  .mtile .mlabel { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--secondary-text-color); }
  .mtile .mlabel ha-icon { --mdc-icon-size: 18px; color: var(--c); }
  .mtile .mbig { font-size: 1.6rem; font-weight: 700; color: var(--primary-text-color); margin: 6px 0 2px; font-variant-numeric: tabular-nums; }
  .mtile .msub { font-size: 0.85rem; color: var(--secondary-text-color); }
  .mtile .msub b { color: var(--c); }
  .note { font-size: 0.85rem; color: var(--secondary-text-color); margin-top: 10px; }
  /* The note line is always there (empty for day / month / year), so switching ranges does not move the card. */
  .note { min-height: 1.3em; }
  .tog.night[aria-checked='true'] { background: ${COLORS.night}; }
  .crow[hidden] { display: none; }
  .mbody { transition: opacity 0.2s; }
  .mbody.dim { opacity: 0.45; }
  /* Two rows: the range gets the full width (a session "13.11 23:00 → 14.11 06:09" must fit on a phone), the period buttons below. */
  .navbar { display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--divider-color, #ddd); }
  .nav { display: flex; align-items: center; gap: 0; min-width: 0; flex: 1 1 auto; }
  .nav button { background: none; border: none; color: var(--primary-text-color); font: inherit; cursor: pointer; border-radius: 8px; padding: 4px 2px; display: flex; align-items: center; gap: 4px; flex: none; }
  .nav button:hover { background: var(--secondary-background-color, rgba(127, 127, 127, 0.15)); }
  .nav button:disabled { opacity: 0.3; cursor: default; background: none; }
  .nav button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
  .nav .navdate { flex: 1 1 auto; min-width: 0; justify-content: center; font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; }
  .nav .navdate span { overflow: hidden; text-overflow: ellipsis; }
  .nav ha-icon { --mdc-icon-size: 20px; flex: none; }
  .nav .navdate ha-icon { --mdc-icon-size: 17px; }
  @media (prefers-reduced-motion: reduce) { .bar span, .tog, .tog::after { transition: none; } }
`;

class EvChargerCard extends HTMLElement {
  constructor() {
    super();
    this._period = 'session';
    this._offset = 0;            // 0 = newest session / current day; -1 = previous ...
    this._sessions = null;       // [{ start, end, ongoing }], newest first
    this._vals = null;           // kWh / UAH for the shown range
    this._loading = false;
    this._token = 0;             // ignores answers of old requests
    this._statsTimer = null;
    this._wasCharging = null;
    this._pendingCurrent = null; // A, value shown before the charger confirms it
    this._sendTimer = null;
    this._busyUntil = 0;         // ms; main button is locked a short time after a click
    this._tick = null;           // refreshes "auto off at" text
  }

  connectedCallback() {
    if (!this._tick) this._tick = setInterval(() => this._built && this._update(), 30000);
    // New statistics appear every 5 minutes.
    if (!this._statsTimer) this._statsTimer = setInterval(() => this._refreshStats(), 5 * 60 * 1000);
    if (this._hass && this._config) this._refreshStats();
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    clearInterval(this._statsTimer);
    this._tick = null;
    this._statsTimer = null;
  }

  setConfig(config) {
    const view = config.view || 'all';
    if (!['all', 'charge', 'money'].includes(view)) throw new Error(`${ELEMENT}: unknown view "${view}". Use all, charge or money.`);
    this._config = { ...DEFAULTS, ...config, view };
    this._built = false;
    if (this._hass) {
      this._build();
      this._update();
    }
  }

  set hass(hass) {
    // HA calls this on EVERY state change in the house, so updates only touch what changed.
    this._hass = hass;
    if (!this._config) return;
    const first = !this._built;
    if (first) this._build();
    this._update();
    if (first) this._refreshStats();
  }

  getCardSize() {
    return this._config && this._config.view === 'money' ? 5 : this._config && this._config.view === 'charge' ? 6 : 10;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  static getStubConfig() {
    return {};
  }

  // ---------- state helpers ----------

  _st(id) {
    return id && this._hass ? this._hass.states[id] : undefined;
  }

  _num(id) {
    const st = this._st(id);
    if (!st) return null;
    const v = parseFloat(st.state);
    return Number.isFinite(v) ? v : null;
  }

  _watts(id) {
    const v = this._num(id);
    if (v == null) return null;
    return this._st(id).attributes.unit_of_measurement === 'kW' ? v * 1000 : v;
  }

  _call(domain, service, entityId, data = {}) {
    return this._hass.callService(domain, service, { entity_id: entityId, ...data });
  }

  // ---------- DOM helpers ----------

  _el(id) {
    return this.shadowRoot.getElementById(id);
  }

  _setText(id, text) {
    const el = this._el(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  _setAttr(id, name, value) {
    const el = this._el(id);
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  _setStyle(id, prop, value) {
    const el = this._el(id);
    if (el && el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
  }

  // One segment of a stacked bar. flex-grow gets a share of 100 (a sum below 1 would not fill the bar);
  // an empty segment is hidden, so no gap is left for it.
  _setSegment(id, part, sum) {
    const share = sum > 0 ? (part / sum) * 100 : 0;
    this._setStyle(id, 'flex-grow', share.toFixed(2));
    this._setStyle(id, 'display', share > 0 ? 'block' : 'none');
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  // ---------- build ----------

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const c = this._config;
    const charge = c.view !== 'money';
    const money = c.view !== 'charge';
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        ${charge ? this._chargeHtml() : ''}
        ${charge && money ? '<div class="sep"></div>' : ''}
        ${money ? this._moneyHtml() : ''}
      </ha-card>`;
    if (charge) this._bindCharge();
    if (money) this._bindMoney();
    this._built = true;
  }

  _chargeHtml() {
    const c = this._config;
    const legend = [
      ['solar', 'Сонце', COLORS.solar],
      ['battery', 'Батарея будинку', COLORS.battery],
      ['grid', 'Мережа', COLORS.night],
    ];
    return `
      ${c.title ? `<div class="title">${c.title}</div>` : ''}
      <div class="status" id="st" tabindex="0" role="button" data-entity="${c.status}">
        <div class="sicon"><ha-icon id="sticon" icon="mdi:ev-station"></ha-icon></div>
        <div class="stext"><div class="shead" id="sthead"></div><div class="ssub" id="stsub"></div></div>
        <div class="spower" id="stpower"></div>
      </div>
      <div class="src" id="src" hidden>
        <div class="ehead"><span>Звідки енергія зараз</span></div>
        <div class="bar">${legend.map(([k, , col]) => `<span id="sb-${k}" style="background:${col};flex-grow:0;display:none"></span>`).join('')}</div>
        <div class="legend">${legend
          .map(([k, label, col]) => `<span id="sl-${k}"><i style="background:${col}"></i>${label}</span><b id="sv-${k}"></b><em id="sp-${k}"></em>`)
          .join('')}</div>
        <div class="warn" id="srcwarn"></div>
      </div>
      <button class="main" id="mainbtn"><ha-icon id="mainicon" icon="mdi:play"></ha-icon><span id="maintext"></span></button>
      <div class="hint" id="mainhint"></div>
      <div class="crow">
        <div class="clabel">Струм зарядки<small id="ckw"></small></div>
        <div class="stepper">
          <button id="cminus" aria-label="Зменшити струм">−</button>
          <b id="cval">—</b>
          <button id="cplus" aria-label="Збільшити струм">+</button>
        </div>
      </div>
      <div class="crow" id="nrow" hidden>
        <div class="clabel">Заряджати лише вночі<small id="nsub"></small></div>
        <button class="tog night" id="ntog" role="switch" aria-checked="false" aria-label="Заряджати лише вночі"></button>
      </div>
      <div class="crow">
        <div class="clabel">Тримати батарею будинку<small id="hsub"></small></div>
        <button class="tog" id="htog" role="switch" aria-checked="false" aria-label="Тримати батарею будинку"></button>
      </div>`;
  }

  _moneyHtml() {
    return `
      <div class="title">Скільки взяла машина</div>
      <div class="mbody" id="mbody">
        <div class="money">
          <div class="mtile" style="--c:${COLORS.day}">
            <div class="mlabel"><ha-icon icon="mdi:cash"></ha-icon>Вартість</div>
            <div class="mbig" id="mcost">—</div>
            <div class="msub" id="mcostsub"></div>
          </div>
          <div class="mtile" style="--c:${COLORS.solar}">
            <div class="mlabel"><ha-icon icon="mdi:solar-power-variant"></ha-icon>Від сонця</div>
            <div class="mbig" id="msolar">—</div>
            <div class="msub" id="msolarsub"></div>
          </div>
        </div>
        <div class="ehead"><span>Усього в машину</span><b id="mtotal">—</b></div>
        <div class="bar">${ENERGY.map((e) => `<span id="mb-${e.key}" style="background:${e.color};flex-grow:0;display:none"></span>`).join('')}</div>
        <div class="legend">${ENERGY.map(
          (e) => `<span id="ml-${e.key}"><i style="background:${e.color}"></i>${e.label}</span><b id="mv-${e.key}"></b><em id="mp-${e.key}"></em>`,
        ).join('')}</div>
        <div class="note" id="mnote"></div>
      </div>
      <div class="navbar">
        <div class="nav">
          <button id="nav-prev" aria-label="Назад"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
          <button class="navdate" id="nav-date" title="Повернутися до останнього"><ha-icon id="nav-icon" icon="mdi:ev-plug-type1"></ha-icon><span id="nav-label"></span></button>
          <button id="nav-next" aria-label="Вперед"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
        </div>
        <div class="seg">${Object.entries(PERIODS).map(([p, n]) => `<button data-p="${p}">${n}</button>`).join('')}</div>
      </div>`;
  }

  _bindCharge() {
    const c = this._config;
    const st = this._el('st');
    st.addEventListener('click', () => this._moreInfo(c.status));
    st.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && this._moreInfo(c.status));
    this._el('mainbtn').addEventListener('click', () => this._onMain());
    this._el('cminus').addEventListener('click', () => this._stepCurrent(-1));
    this._el('cplus').addEventListener('click', () => this._stepCurrent(1));
    this._el('htog').addEventListener('click', () => this._call('input_boolean', 'toggle', c.hold));
    this._el('ntog').addEventListener('click', () => this._call('input_boolean', 'toggle', c.night));
  }

  _bindMoney() {
    this._el('nav-prev').addEventListener('click', () => this._setRange(this._period, this._offset - 1));
    this._el('nav-next').addEventListener('click', () => this._setRange(this._period, Math.min(0, this._offset + 1)));
    this._el('nav-date').addEventListener('click', () => this._setRange(this._period, 0));
    this.shadowRoot.querySelectorAll('.seg [data-p]').forEach((b) => b.addEventListener('click', () => this._setRange(b.dataset.p, 0)));
  }

  // ---------- money: ranges and statistics ----------
  // All numbers come from HA statistics of the total counters (change over the range), so a session
  // that runs 23:00 -> 07:00 is counted as one piece, across midnight.

  _setRange(period, offset) {
    if (period === this._period && offset === this._offset) return;
    this._period = period;
    this._offset = offset;
    // The old numbers stay (dimmed) until the new ones arrive: clearing them to "—" made the card jump.
    this._refreshStats();
  }

  _range() {
    if (this._period === 'session') {
      const s = this._sessions && this._sessions[-this._offset];
      return s ? { start: s.start, end: s.end, session: s } : null;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (this._period === 'day') {
      start.setDate(start.getDate() + this._offset);
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 1);
    } else if (this._period === 'month') {
      start.setDate(1);
      start.setMonth(start.getMonth() + this._offset);
      end.setTime(start.getTime());
      end.setMonth(end.getMonth() + 1);
    } else {
      start.setMonth(0, 1);
      start.setFullYear(start.getFullYear() + this._offset);
      end.setTime(start.getTime());
      end.setFullYear(end.getFullYear() + 1);
    }
    return { start, end };
  }

  _rangeLabel() {
    if (this._period === 'session') {
      const r = this._range();
      if (!r) return this._sessions ? 'Сеансів ще немає' : 'Шукаю сеанси…';
      const { start, end, session } = r;
      const to = session.ongoing ? 'зараз' : fmtDM(start) === fmtDM(end) ? fmtHM(end) : `${fmtDM(end)} ${fmtHM(end)}`;
      return `${fmtDM(start)} ${fmtHM(start)} → ${to}`;
    }
    const { start } = this._range();
    if (this._period === 'month') return `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
    if (this._period === 'year') return String(start.getFullYear());
    if (this._offset === 0) return `Сьогодні, ${fmtDM(start)}`;
    if (this._offset === -1) return `Вчора, ${fmtDM(start)}`;
    return `${['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][start.getDay()]}, ${fmtDM(start)}.${start.getFullYear()}`;
  }

  async _refreshStats() {
    if (!this._hass || !this._config || this._config.view === 'charge' || !this._built) return;
    const token = ++this._token;
    this._loading = true;
    this._update();
    try {
      const sessions = await this._findSessions();
      if (token !== this._token) return;
      this._sessions = sessions;
      if (this._period === 'session' && -this._offset >= sessions.length) this._offset = 0;
      const r = this._range();
      const vals = r ? await this._fetchChanges(r.start, r.end) : null;
      if (token !== this._token) return;
      this._vals = vals;
      this._error = false;
    } catch (e) {
      if (token !== this._token) return;
      console.warn(`${ELEMENT}: statistics request failed`, e);
      this._error = true;
      this._vals = null; // do not show the previous range's numbers as if they were this one's
    }
    this._loading = false;
    this._update();
  }

  // Sessions = runs of 5-minute buckets where the car took energy; pauses up to SESSION_GAP_MIN join them.
  async _findSessions() {
    const id = `sensor.${ENERGY_TOTAL}`;
    const now = new Date();
    const res = await this._hass.callWS({
      type: 'recorder/statistics_during_period',
      start_time: new Date(now.getTime() - SESSION_LOOKBACK_DAYS * 86400000).toISOString(),
      end_time: now.toISOString(),
      statistic_ids: [id],
      period: '5minute',
      types: ['change'],
    });
    const list = [];
    let cur = null;
    const rows = (res[id] || []).slice().sort((x, y) => new Date(x.start) - new Date(y.start));
    for (const row of rows) {
      if (!(row.change > SESSION_MIN_KWH)) continue;
      const start = new Date(row.start);
      const end = new Date(row.end);
      if (cur && start - cur.end <= SESSION_GAP_MIN * 60000) cur.end = end;
      else list.push((cur = { start, end, ongoing: false }));
    }
    list.reverse();
    // A session that is still running ends "now" (the newest statistics are up to 5-10 minutes old).
    const p = this._watts(this._config.power) || 0;
    if (p > this._config.charging_power) {
      const last = list[0];
      if (last && now - last.end <= SESSION_GAP_MIN * 60000) {
        last.end = now;
        last.ongoing = true;
      } else {
        list.unshift({ start: new Date(now.getTime() - 5 * 60000), end: now, ongoing: true });
      }
    }
    return list;
  }

  async _fetchChanges(start, end) {
    const stop = new Date(Math.min(end.getTime(), Date.now()));
    if (stop <= start) return {};
    const one = (base) =>
      this._hass
        .callWS({
          type: 'recorder/statistic_during_period',
          statistic_id: `sensor.${base}`,
          fixed_period: { start_time: start.toISOString(), end_time: stop.toISOString() },
          types: ['change'],
        })
        .then((r) => (r && Number.isFinite(r.change) ? r.change : null));
    const keys = [...ENERGY.map((e) => [e.key, e.base]), ['total', ENERGY_TOTAL], ['cost', COST_TOTAL]];
    const values = await Promise.all(keys.map(([, base]) => one(base)));
    const out = {};
    keys.forEach(([k], i) => (out[k] = values[i]));
    return out;
  }

  // ---------- actions ----------

  async _onMain() {
    if (Date.now() < this._busyUntil) return;
    this._busyUntil = Date.now() + 3000;
    this._update();
    setTimeout(() => this._update(), 3100);
    const c = this._config;
    const on = this._st(c.switch)?.state === 'on';
    const hold = this._st(c.hold);
    try {
      if (on) {
        await this._call('switch', 'turn_off', c.switch);
        // The automation would also do this after 2 min; turning it off here gives the battery back at once.
        if (hold && hold.state === 'on') await this._call('input_boolean', 'turn_off', c.hold);
      } else {
        // The script holds the battery, lifts the night timer if needed and starts charging (it can take a
        // minute, so turn_on: the call returns at once and the card follows the script state).
        await this._call('script', 'turn_on', c.charge_now);
      }
    } catch (err) {
      this._setText('mainhint', `Помилка: ${err.message || err}`);
    }
  }

  _currentLimits() {
    const c = this._config;
    const a = this._st(c.current)?.attributes || {};
    const min = Math.max(c.min_current, Number.isFinite(a.min) ? a.min : c.min_current);
    const max = Math.min(c.max_current, Number.isFinite(a.max) ? a.max : c.max_current);
    const step = Number.isFinite(a.step) && a.step > 0 ? a.step : c.current_step;
    return { min, max, step };
  }

  _stepCurrent(dir) {
    const cur = this._pendingCurrent ?? this._num(this._config.current);
    if (cur == null) return;
    const { min, max, step } = this._currentLimits();
    const next = Math.min(max, Math.max(min, cur + dir * step));
    if (next === cur) return;
    this._pendingCurrent = next;
    this._pendingSince = Date.now();
    this._update();
    // Several quick clicks = one write to the charger.
    clearTimeout(this._sendTimer);
    this._sendTimer = setTimeout(() => {
      // _update() clears the pending value when it equals the current one (e.g. "+" then "−" within the
      // delay), so read it now: nothing pending or nothing changed = nothing to send (sending null failed
      // with "expected float at 'value'").
      const value = this._pendingCurrent;
      if (value == null || value === this._num(this._config.current)) {
        this._pendingCurrent = null;
        this._update();
        return;
      }
      this._call('number', 'set_value', this._config.current, { value }).catch((err) =>
        this._setText('mainhint', `Струм не змінено: ${err.message || err}`),
      );
    }, 700);
  }

  // ---------- update ----------

  _update() {
    if (!this._hass || !this._built) return;
    if (this._config.view !== 'money') this._updateCharge();
    if (this._config.view !== 'charge') this._updateMoney();
  }

  _updateCharge() {
    const c = this._config;
    const st = this._st(c.status);
    const online = !!st && !['unavailable', 'unknown'].includes(st.state) && st.attributes.online !== false;
    const swOn = this._st(c.switch)?.state === 'on';
    const power = this._watts(c.power) || 0;
    const charging = online && power > c.charging_power;
    const amps = this._num(c.measured_current);
    const volts = this._num(c.voltage);
    const holdSt = this._st(c.hold);
    const holdOn = holdSt?.state === 'on';
    const soc = this._num(c.battery_soc);
    const nightSt = this._st(c.night);
    const nightOn = nightSt?.state === 'on';
    // Charger status codes (integration attribute): 0 no car, 1 car connected, 2 charging, 4 charging forbidden.
    const code = st?.attributes.status_code;
    const noCar = online && code === '0';
    const nowSt = this._st(c.charge_now);
    const starting = nowSt?.state === 'on'; // the script is running
    const oneOff = this._st(c.charge_now_flag)?.state === 'on';
    const waitsForNight = online && !noCar && !charging && nightOn && !isNightHour();
    // When charging starts or stops, the session list changes.
    if (this._wasCharging !== null && this._wasCharging !== (online && power > c.charging_power)) {
      setTimeout(() => this._refreshStats(), 1000);
    }
    this._wasCharging = online && power > c.charging_power;

    // State line
    let head, sub, color, icon;
    if (!online) {
      [head, sub, color, icon] = ['Зарядка не на зв’язку', 'Перевірте живлення зарядки і Wi-Fi.', COLORS.warn, 'mdi:lan-disconnect'];
    } else if (charging) {
      const parts = [];
      if (amps != null) parts.push(`${amps.toFixed(1)} A`);
      if (volts != null) parts.push(`${Math.round(volts)} V`);
      [head, sub, color, icon] = ['Заряджає', parts.join(', '), COLORS.car, 'mdi:ev-plug-type1'];
    } else if (noCar) {
      [head, sub, color, icon] = ['Машина не підключена', st.state, COLORS.idle, 'mdi:ev-station'];
    } else if (starting) {
      [head, sub, color, icon] = ['Запускаю зарядку…', st.state, COLORS.car, 'mdi:ev-plug-type1'];
    } else if (waitsForNight) {
      [head, sub, color, icon] = ['Чекає нічного тарифу', `${st.state}; почне сама о ${NIGHT_START}:00`, COLORS.night, 'mdi:weather-night'];
    } else if (swOn) {
      [head, sub, color, icon] = ['Увімкнено, але не заряджає', st.state, COLORS.idle, 'mdi:ev-station'];
    } else {
      [head, sub, color, icon] = ['Не заряджає', st.state, COLORS.idle, 'mdi:ev-station'];
    }
    this._setText('sthead', head);
    this._setText('stsub', sub);
    this._setText('stpower', charging ? fmtW(power) : '');
    this._setStyle('st', '--c', color);
    this._setAttr('sticon', 'icon', icon);

    // Where the power comes from now
    const src = this._el('src');
    if (src.hidden === charging) src.hidden = !charging;
    if (charging) {
      const parts = {
        solar: Math.max(0, this._watts(c.solar_power) || 0),
        battery: Math.max(0, this._watts(c.battery_power) || 0),
        grid: Math.max(0, this._watts(c.grid_power) || 0),
      };
      const sum = parts.solar + parts.battery + parts.grid;
      for (const k of Object.keys(parts)) {
        this._setSegment(`sb-${k}`, parts[k], sum);
        this._setText(`sv-${k}`, fmtW(parts[k]));
        this._setText(`sp-${k}`, `${pct(parts[k], sum)} %`);
      }
      const hot = parts.battery > c.battery_warn;
      const lbl = this._el('sl-battery');
      if (lbl.classList.contains('hot') !== hot) {
        lbl.classList.toggle('hot', hot);
        this._el('sv-battery').classList.toggle('hot', hot);
      }
      this._setText(
        'srcwarn',
        !hot
          ? ''
          : holdOn
            ? 'Машина бере енергію з батареї будинку, хоча утримання ввімкнене. Перевірте сповіщення HA: межі SOC могли не записатися.'
            : 'Машина бере енергію з батареї будинку. Увімкніть «Тримати батарею будинку».',
      );
    }

    // Main button
    const btn = this._el('mainbtn');
    const busy = Date.now() < this._busyUntil;
    // Start is not offered without a car (the charger would do nothing) or while the start script runs.
    const noScript = !swOn && !nowSt;
    const disabled = !online || busy || (!swOn && (noCar || starting || noScript));
    if (btn.disabled !== disabled) btn.disabled = disabled;
    if (btn.classList.contains('stop') !== swOn) btn.classList.toggle('stop', swOn);
    this._setAttr('mainicon', 'icon', swOn ? 'mdi:stop' : 'mdi:play');
    this._setText(
      'maintext',
      !online ? 'Зарядка не на зв’язку' : swOn ? 'Зупинити зарядку' : noCar ? 'Підключіть машину' : starting ? 'Запускаю…' : 'Зарядити зараз',
    );
    const keep = soc != null ? `батарея будинку лишиться на ${Math.round(soc)} %` : 'батарея будинку не віддаватиме енергію машині';
    let hint = '';
    if (!online) {
      hint = '';
    } else if (swOn) {
      if (oneOff) hint = 'Разова зарядка: коли закінчиться, «лише вночі» увімкнеться знову.';
      else if (holdOn) hint = 'Після зупинки межі батареї в інверторі повернуться самі.';
    } else if (noScript) {
      hint = `Немає ${c.charge_now}: оновіть пакети ev-charger-packages до v0.4.0.`;
    } else if (noCar) {
      hint = nightOn && !isNightHour()
        ? `Зарядка почнеться сама о ${NIGHT_START}:00, якщо машина буде підключена.`
        : 'Зарядка почнеться сама, щойно підключите машину.';
    } else if (starting) {
      hint = 'Знімаю нічний таймер і чекаю, поки зарядка почне. Це до хвилини.';
    } else if (waitsForNight) {
      hint = `«Зарядити зараз» — разово: ${keep}, а «лише вночі» повернеться після зарядки.`;
    } else if (!isNightHour()) {
      hint = `«Зарядити зараз»: ${keep}, машина візьме сонце, решту — з мережі.`;
    }
    if (!this._el('mainhint').textContent.startsWith('Помилка') && !this._el('mainhint').textContent.startsWith('Струм')) {
      this._setText('mainhint', hint);
    }

    // Charge current
    const cur = this._num(c.current);
    if (this._pendingCurrent != null && (cur === this._pendingCurrent || Date.now() - this._pendingSince > 15000)) {
      this._pendingCurrent = null;
    }
    const shown = this._pendingCurrent ?? cur;
    const { min, max } = this._currentLimits();
    this._setText('cval', shown == null ? '—' : `${Math.round(shown)} A`);
    this._el('cval').classList.toggle('pending', this._pendingCurrent != null);
    // The ElectroS integration keeps its own target current in HA and sends it to the charger only with
    // the start command or while charging. Show the value really stored in the charger when it differs.
    const real = this._num(c.set_current);
    let ckw = shown == null ? 'зарядка не відповідає' : `≈ ${((shown * (volts || 230)) / 1000).toFixed(1)} kW, межа ${max} A`;
    if (shown != null && real != null && Math.round(real) !== Math.round(shown)) {
      ckw += swOn
        ? `; у зарядці ${Math.round(real)} A, оновлюється`
        : `; у самій зарядці ${Math.round(real)} A — ${Math.round(shown)} A застосується, коли зарядку запустить HA`;
    }
    this._setText('ckw', ckw);
    const minus = this._el('cminus');
    const plus = this._el('cplus');
    const offMinus = shown == null || shown <= min;
    const offPlus = shown == null || shown >= max;
    if (minus.disabled !== offMinus) minus.disabled = offMinus;
    if (plus.disabled !== offPlus) plus.disabled = offPlus;

    // Charge only at night
    const nrow = this._el('nrow');
    if (nrow.hidden !== !nightSt) nrow.hidden = !nightSt;
    if (nightSt) {
      this._setAttr('ntog', 'aria-checked', String(nightOn));
      // What the charger really has: the timer sensor of the integration fork (may be missing on old installs).
      const tSt = this._st(c.timer);
      const tOn = tSt?.attributes.enabled;
      const tKnown = tSt && !['unavailable', 'unknown'].includes(tSt.state);
      let nsub;
      if (oneOff && !nightOn) nsub = 'вимкнено на разову зарядку, увімкнеться після неї';
      else if (nightOn) {
        nsub = !tKnown
          ? `увімкнено: заряджає ${NIGHT_START}:00–0${NIGHT_END}:00`
          : tOn
            ? `увімкнено: таймер у зарядці ${tSt.state}, вдень зарядка не почнеться`
            : 'увімкнено, але таймера в зарядці ще немає — HA зараз поставить';
      } else {
        nsub = tKnown && tOn
          ? `вимкнено, але в зарядці ще таймер ${tSt.state} — HA зараз зніме`
          : 'вимкнено: заряджає одразу, як підключите машину';
      }
      const off = this._num(c.clock_offset);
      if (off != null && Math.abs(off) > c.clock_warn) nsub += `; годинник зарядки ${off > 0 ? '+' : '−'}${Math.round(Math.abs(off))} с`;
      this._setText('nsub', nsub);
    }

    // Hold home battery
    const tog = this._el('htog');
    this._setAttr('htog', 'aria-checked', String(holdOn));
    if (tog.disabled !== !holdSt) tog.disabled = !holdSt;
    let hsub;
    if (!holdSt) hsub = 'немає input_boolean.ev_battery_hold';
    else if (holdOn) {
      const t = this._st(c.hold_timer);
      const end = t && t.state === 'active' && t.attributes.finishes_at ? new Date(t.attributes.finishes_at) : null;
      hsub = `увімкнено${soc != null ? `, батарея ${Math.round(soc)} %` : ''}${end ? `, автовимкнення о ${pad2(end.getHours())}:${pad2(end.getMinutes())}` : ''}`;
    } else hsub = 'вимкнено: батарея будинку може віддавати енергію машині';
    this._setText('hsub', hsub);
  }

  _updateMoney() {
    // Switcher
    this._setText('nav-label', this._rangeLabel());
    this._setAttr('nav-icon', 'icon', this._period === 'session' ? 'mdi:ev-plug-type1' : 'mdi:calendar-blank-outline');
    const older = this._period === 'session' ? !this._sessions || -this._offset >= this._sessions.length - 1 : false;
    const prev = this._el('nav-prev');
    const next = this._el('nav-next');
    if (prev.disabled !== older) prev.disabled = older;
    if (next.disabled !== (this._offset === 0)) next.disabled = this._offset === 0;
    this.shadowRoot.querySelectorAll('.seg [data-p]').forEach((b) => {
      const on = b.dataset.p === this._period;
      if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
    });
    const body = this._el('mbody');
    if (body.classList.contains('dim') !== this._loading) body.classList.toggle('dim', this._loading);
    // While a new range loads, keep the numbers and notes of the previous one (dimmed): no "—", no jumps.
    if (this._loading && this._vals) return;

    const vals = this._vals || {};
    const has = (k) => vals[k] != null;
    const known = ENERGY.some((e) => has(e.key));
    const v = {};
    for (const e of ENERGY) v[e.key] = Math.max(0, vals[e.key] || 0);
    const sum = ENERGY.reduce((s, e) => s + v[e.key], 0);
    const grid = v.night + v.day;
    const cost = has('cost') ? Math.max(0, vals.cost) : null;
    const total = has('total') ? Math.max(0, vals.total) : null;

    this._setText('mcost', fmtUah(cost ?? (known ? 0 : null)));
    this._setText('mcostsub', `за ${fmtKwh(grid)} з мережі`);
    this._setText('msolar', known ? fmtKwh(v.solar) : '—');
    this._setText('msolarsub', sum > 0 ? `безкоштовно, ${pct(v.solar, sum)} % від усього` : 'безкоштовно');
    const into = total ?? (known ? sum : null);
    const c = this._config;
    // Range estimate: energy from the wall x charging efficiency / consumption per 100 km.
    const km = into != null && c.consumption > 0 ? Math.round((into * c.charge_efficiency * 100) / c.consumption) : null;
    this._setText('mtotal', into == null ? '—' : km != null ? `${fmtKwh(into)} ≈ ${km} км` : fmtKwh(into));
    for (const e of ENERGY) {
      this._setSegment(`mb-${e.key}`, v[e.key], sum);
      this._setText(`mv-${e.key}`, known ? fmtKwh(v[e.key]) : '—');
      this._setText(`mp-${e.key}`, `${pct(v[e.key], sum)} %`);
    }
    const hot = v.battery > 0.05;
    const lbl = this._el('ml-battery');
    if (lbl.classList.contains('hot') !== hot) {
      lbl.classList.toggle('hot', hot);
      this._el('mv-battery').classList.toggle('hot', hot);
    }

    const notes = [];
    if (this._error) notes.push('Не вдалося прочитати статистику HA. Спробую ще раз за 5 хв.');
    const r = this._period === 'session' ? this._range() : null;
    if (r) notes.push(`Тривалість ${fmtDur(r.end - r.start)}${r.session.ongoing ? ', ще триває (цифри оновлюються раз на 5 хв)' : ''}.`);
    if (this._period === 'session' && this._sessions && !this._sessions.length) {
      notes.push(`Сеанси шукаються за останні ${SESSION_LOOKBACK_DAYS} днів. Старіші — через День / Міс. / Рік.`);
    }
    if (!this._loading && this._vals && !known && this._period !== 'session') notes.push('За цей період даних немає.');
    if (total != null && total - sum > Math.max(0.05, total * 0.01)) {
      notes.push(`${fmtKwh(total - sum)} не розподілено за джерелами: тоді не було даних з інвертора.`);
    }
    this._setText('mnote', notes.join(' '));
  }
}

if (!customElements.get(ELEMENT)) {
  customElements.define(ELEMENT, EvChargerCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: ELEMENT,
  name: 'EV Charger Card',
  description: 'ElectroS EV charger: state, source of power now, start / stop, current, night-only charging, hold home battery, kWh and UAH by source per session / day / month / year (view: all | charge | money)',
});

console.info(`%c ${ELEMENT} ${CARD_VERSION} `, 'background:#f5b400;color:#000;border-radius:3px');
