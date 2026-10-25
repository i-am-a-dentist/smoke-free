// UI: routing, views, inline editor, drag and drop, keyboard, quick entry / quick find, settings.
import * as S from "./store.js";
import { T, commit, isProject } from "./store.js";
import * as D from "./dates.js";
import { ic, pie } from "./icons.js";
import * as P from "./pickers.js";

const { esc } = P;
const $ = (s, el = document) => el.querySelector(s);
const appEl = $("#app"), sidebarEl = $("#sidebar"), contentEl = $("#content"), scrollerEl = $("#scroller");
const toolbarEl = $("#toolbar"), topbarEl = $("#topbar"), fabEl = $("#fab");
const isNarrow = () => matchMedia("(max-width: 760px)").matches;
let lastPointer = "mouse";

const LISTS = {
  inbox: { title: "Входящие", icon: "inbox", color: "c-inbox", key: "1" },
  today: { title: "Сегодня", icon: "star", color: "c-today", key: "2" },
  upcoming: { title: "Предстоящие", icon: "calendar", color: "c-upcoming", key: "3" },
  anytime: { title: "В любое время", icon: "layers", color: "c-anytime", key: "4" },
  someday: { title: "Когда-нибудь", icon: "box", color: "c-someday", key: "5" },
  logbook: { title: "Журнал", icon: "logbook", color: "c-logbook", key: "6" },
  trash: { title: "Корзина", icon: "trash", color: "c-trash", key: "7" },
};
const LIST_ORDER = Object.keys(LISTS);

const ui = {
  view: { type: "today" },
  pane: "list",          // narrow screens: "home" (lists) or "list" (one list)
  openId: null,          // to-do expanded into the inline editor
  sel: new Set(), anchor: null,
  selectMode: false,     // touch multi-select
  tagFilter: null,
  touched: new Set(),    // toggled this visit: stay in place until the user leaves the list
  prevDone: new Map(),
  showLogged: false,
  focus: null,
  reveal: null,
  lastSec: null,         // heading the user touched last: new to-dos go under it
};
let sections = [];
const secById = id => sections.find(s => s.id === id);
const untitled = s => s && s.trim() ? esc(s) : `<span class="untitled">Без названия</span>`;

/* ================= routing ================= */
const hashFor = v => "#" + v.type + (v.id ? "/" + v.id : "");
const sameView = (a, b) => a.type === b.type && (a.id || null) === (b.id || null);

function setView(v) {
  if (sameView(v, ui.view)) return;
  ui.view = v; ui.openId = null; ui.sel.clear(); ui.anchor = null; ui.selectMode = false;
  ui.tagFilter = null; ui.touched.clear(); ui.prevDone.clear(); ui.showLogged = false; ui.lastSec = null;
  scrollerEl.scrollTop = 0;
}
function navigate(v) {
  const h = hashFor(v);
  if (location.hash === h) { ui.pane = "list"; setView(v); render(); }
  else location.hash = h;
}
function route() {
  const [type, id] = location.hash.slice(1).split("/");
  if (type === "home" || (!type && isNarrow())) { ui.pane = "home"; if (!isNarrow()) ui.pane = "list"; render(); return; }
  let v = { type: "today" };
  if (LISTS[type]) v = { type };
  else if (type === "project" && S.getProject(id)) v = { type, id };
  else if (type === "area" && S.getArea(id)) v = { type, id };
  else if (type === "tag" && S.getTag(id)) v = { type, id };
  ui.pane = "list";
  setView(v);
  render();
}

/* ================= views ================= */
const asOpen = x => (x.status !== "open" && ui.touched.has(x.id)) ? { ...x, status: "open" } : x;
const openBy = pred => x => pred(asOpen(x));
const sortedAreas = () => [...S.db.areas].sort(S.byIndex);
const anytimeize = x => { if (x.when === "someday" || (D.isDate(x.when) && x.when > T())) S.setWhen(x, null); if (!isProject(x)) x.inbox = false; };

function projectLink(p) {
  return `<button class="grp-link" data-nav-to="project:${p.id}">${pie(S.projectProgress(p), "c-project")}<span>${untitled(p.title)}</span></button>`;
}
function areaLink(a) {
  return `<button class="grp-link area" data-nav-to="area:${a.id}">${ic("area", "c-area")}<span>${untitled(a.title)}</span></button>`;
}

function vInbox() {
  const items = S.db.todos.filter(openBy(S.inInbox)).sort(S.byIndex);
  return { sections: [{ id: "inbox", items, assign: x => S.moveTodo(x, { kind: "inbox" }), ctx: {} }],
    empty: { icon: "inbox", text: "Входящие пусты. Записывайте сюда всё, что приходит в голову, — разберёте позже." } };
}

function vToday() {
  const t = T();
  const all = [
    ...S.db.projects.filter(p => !p.trashed && openBy(S.inToday)(p)),
    ...S.db.todos.filter(openBy(x => S.isOpenTodo(x) && S.inToday(x))),
  ].sort((a, b) => S.todayKey(a) - S.todayKey(b));
  const day = all.filter(x => !S.isEvening(x)), ev = all.filter(x => S.isEvening(x));
  const toToday = x => S.setWhen(x, t, false), toEvening = x => S.setWhen(x, t, true);
  return {
    sections: [
      { id: "today", items: day, orderKey: "todayIndex", assign: toToday, assignP: toToday, ctx: { parent: true } },
      { id: "evening", head: `${ic("moon", "c-evening")}<span>Этим вечером</span>`, cls: "evening", items: ev, orderKey: "todayIndex", assign: toEvening, assignP: toEvening, ctx: { parent: true }, alwaysShow: "drag" },
    ],
    empty: { icon: "star", text: "На сегодня ничего. Самое время что-нибудь запланировать — или отдохнуть." },
  };
}

function vUpcoming() {
  const t = T();
  const keyOf = x => D.isDate(x.when) && x.when > t ? x.when : (!x.when && x.deadline && x.deadline > t ? x.deadline : null);
  const items = [...S.db.todos.filter(openBy(S.isOpenTodo)), ...S.db.projects.filter(openBy(S.isOpenProject))]
    .map(x => [x, keyOf(x)]).filter(([, k]) => k);
  const secs = [];
  const daySec = (d, head) => ({ id: "d" + d, from: d, to: d, head, alwaysShow: true });
  for (let i = 1; i <= 7; i++) {
    const d = D.addDays(t, i);
    secs.push(daySec(d, `<span class="up-num">${D.toDate(d).getDate()}</span><span class="up-name">${i === 1 ? "Завтра" : D.cap(D.WEEKDAYS[D.weekday(d)])}</span>`));
  }
  const monthEnd = s => { const d = D.toDate(s); return D.ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
  let start = D.addDays(t, 8);
  const maxKey = items.reduce((m, [, k]) => k > m ? k : m, D.addMonths(t, 3));
  if (D.toDate(start).getDate() !== 1) {
    const e = monthEnd(start), a = D.toDate(start), b = D.toDate(e);
    secs.push({ id: "r" + start, from: start, to: e, head: `<span class="up-name">${a.getDate() === b.getDate() ? a.getDate() : a.getDate() + "–" + b.getDate()} ${D.MONTHS_GEN[a.getMonth()]}</span>` });
    start = D.addDays(e, 1);
  }
  while (start <= maxKey) {
    const e = monthEnd(start), dt = D.toDate(start);
    secs.push({ id: "m" + start, from: start, to: e, head: `<span class="up-name">${D.MONTHS[dt.getMonth()]}${dt.getFullYear() !== new Date().getFullYear() ? " " + dt.getFullYear() : ""}</span>` });
    start = D.addDays(e, 1);
  }
  for (const s of secs) {
    s.items = items.filter(([, k]) => k >= s.from && k <= s.to)
      .sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0].index - b[0].index).map(([x]) => x);
    s.ctx = { parent: true, datePill: s.from !== s.to };
    const d = s.from;
    s.assign = s.assignP = x => S.setWhen(x, d);
  }
  return { sections: secs, empty: null };
}

function vAnytime() {
  const open = S.db.todos.filter(openBy(S.inAnytime)).sort(S.byIndex);
  const ctx = { today: true };
  const secs = [{ id: "loose", items: open.filter(t => !t.projectId && !t.areaId), assign: x => { anytimeize(x); S.moveTodo(x, { kind: "none" }); }, ctx }];
  const projSec = p => ({ id: "p" + p.id, head: projectLink(p), items: open.filter(t => t.projectId === p.id),
    assign: x => { anytimeize(x); S.moveTodo(x, { kind: "project", id: p.id }); }, ctx });
  const activeIn = aid => S.db.projects.filter(p => (p.areaId || null) === aid && S.projectActive(p)).sort(S.byIndex);
  activeIn(null).forEach(p => secs.push(projSec(p)));
  for (const a of sortedAreas()) {
    const ps = activeIn(a.id).map(projSec);
    secs.push({ id: "a" + a.id, head: areaLink(a), cls: "area-sec", items: open.filter(t => !t.projectId && t.areaId === a.id),
      assign: x => { anytimeize(x); S.moveTodo(x, { kind: "area", id: a.id }); }, ctx, alwaysShow: ps.some(s => s.items.length) });
    secs.push(...ps.map(s => ({ ...s, cls: "in-area" })));
  }
  return { sections: secs, empty: { icon: "layers", text: "Здесь появятся все задачи, которые можно сделать в любой момент." } };
}

function vSomeday() {
  const todos = S.db.todos.filter(openBy(t => S.isOpenTodo(t) && t.when === "someday" && (!S.projectOf(t) || S.projectActive(S.projectOf(t))))).sort(S.byIndex);
  const projs = S.db.projects.filter(openBy(p => S.isOpenProject(p) && p.when === "someday")).sort(S.byIndex);
  const toSomeday = x => S.setWhen(x, "someday");
  const ctx = {};
  const secs = [{ id: "loose", items: [...projs.filter(p => !p.areaId), ...todos.filter(t => !t.projectId && !t.areaId)],
    assign: x => { toSomeday(x); S.moveTodo(x, { kind: "none" }); }, assignP: p => { toSomeday(p); p.areaId = null; }, ctx }];
  const projSec = p => ({ id: "p" + p.id, head: projectLink(p), items: todos.filter(t => t.projectId === p.id), assign: x => { toSomeday(x); S.moveTodo(x, { kind: "project", id: p.id }); }, ctx });
  const withTodos = aid => S.db.projects.filter(p => (p.areaId || null) === aid && todos.some(t => t.projectId === p.id)).sort(S.byIndex);
  withTodos(null).forEach(p => secs.push(projSec(p)));
  for (const a of sortedAreas()) {
    const ps = withTodos(a.id).map(projSec);
    secs.push({ id: "a" + a.id, head: areaLink(a), cls: "area-sec", items: [...projs.filter(p => p.areaId === a.id), ...todos.filter(t => !t.projectId && t.areaId === a.id)],
      assign: x => { toSomeday(x); S.moveTodo(x, { kind: "area", id: a.id }); }, assignP: p => { toSomeday(p); p.areaId = a.id; }, ctx, alwaysShow: ps.some(s => s.items.length) });
    secs.push(...ps.map(s => ({ ...s, cls: "in-area" })));
  }
  return { sections: secs, empty: { icon: "box", text: "Идеи и планы без срока. Загляните сюда, когда захочется нового." } };
}

const doneAt = x => x.completedAt || ui.prevDone.get(x.id) || 0;
function vLogbook() {
  const done = x => x.status !== "open" || ui.touched.has(x.id);
  const todos = S.db.todos.filter(t => S.visibleTodo(t) && done(t) && !(S.projectOf(t) && S.projectOf(t).status !== "open" && t.completedAt === S.projectOf(t).completedAt));
  const projs = S.db.projects.filter(p => !p.trashed && done(p));
  const all = [...projs, ...todos].sort((a, b) => doneAt(b) - doneAt(a));
  const t = T(), groups = new Map();
  for (const x of all) {
    const day = D.ymd(new Date(doneAt(x) || Date.now()));
    const recent = D.diffDays(t, day) <= 14;
    const key = recent ? day : day.slice(0, 7);
    if (!groups.has(key)) {
      const dt = D.toDate(recent ? day : key + "-01");
      groups.set(key, { id: "l" + key, head: `<span class="up-name">${recent ? D.cap(D.human(day, { long: true })) : D.MONTHS[dt.getMonth()] + " " + dt.getFullYear()}</span>`, items: [], ctx: { parent: true, logDate: !recent } });
    }
    groups.get(key).items.push(x);
  }
  return { sections: [...groups.values()], empty: { icon: "logbook", text: "Здесь будет всё, что вы выполнили." } };
}

function vTrash() {
  const items = [...S.db.projects.filter(p => p.trashed), ...S.db.todos.filter(t => t.trashed && !S.projectOf(t)?.trashed)]
    .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
  const has = items.length > 0;
  return { sections: [{ id: "trash", items, ctx: { parent: true, trash: true } }],
    extra: has ? `<button class="btn subtle" data-act="empty-trash">Очистить корзину</button>` : "",
    empty: { icon: "trash", text: "Корзина пуста." } };
}

function vProject(p) {
  const all = S.db.todos.filter(t => t.projectId === p.id && !t.trashed);
  const open = all.filter(t => t.status === "open" || ui.touched.has(t.id)).sort(S.byIndex);
  const headings = S.db.headings.filter(h => h.projectId === p.id && !h.archived).sort(S.byIndex);
  const hIds = new Set(headings.map(h => h.id));
  const ctx = { when: true, today: true };
  const secs = [{ id: "ph", items: open.filter(t => !hIds.has(t.headingId)), assign: x => S.moveTodo(x, { kind: "project", id: p.id }), ctx }];
  for (const h of headings) {
    secs.push({ id: "h" + h.id, cls: "heading", alwaysShow: true, items: open.filter(t => t.headingId === h.id), ctx,
      head: `<input class="h-title" data-fk="htitle:${h.id}" value="${esc(h.title)}" placeholder="Новый заголовок"><button class="icon-btn h-menu" data-act="h-menu" data-hid="${h.id}" title="Действия">${ic("dots")}</button>`,
      assign: x => S.moveTodo(x, { kind: "project", id: p.id, headingId: h.id }) });
  }
  const logged = all.filter(t => t.status !== "open" && !ui.touched.has(t.id)).sort((a, b) => b.completedAt - a.completedAt);
  if (logged.length) {
    secs.push({ id: "logged", cls: "logged", alwaysShow: true, items: ui.showLogged ? logged : [], ctx: { logDate: true },
      head: `<button class="logged-toggle" data-act="toggle-logged">${ui.showLogged ? "Скрыть" : "Показать"} выполненные · ${logged.length}</button>` });
  }
  return { sections: secs, header: projectHeader(p), empty: null, emptyInline: !all.length && !headings.length ? "В проекте пока нет задач. Нажмите «+», чтобы добавить первую." : "" };
}

function vArea(a) {
  const projs = S.db.projects.filter(openBy(p => S.isOpenProject(p) && p.areaId === a.id)).sort(S.byIndex);
  const todos = S.db.todos.filter(openBy(t => S.isOpenTodo(t) && !t.projectId && t.areaId === a.id)).sort(S.byIndex);
  return {
    header: areaHeader(a),
    sections: [
      { id: "aprojects", items: projs.filter(p => p.when !== "someday"), assignP: p => { p.areaId = a.id; if (p.when === "someday") S.setWhen(p, null); }, ctx: {} },
      { id: "atodos", items: todos, assign: x => S.moveTodo(x, { kind: "area", id: a.id }), ctx: { when: true, today: true } },
      { id: "asomeday", head: `${ic("box", "c-someday")}<span>Когда-нибудь</span>`, items: projs.filter(p => p.when === "someday"), assignP: p => { p.areaId = a.id; S.setWhen(p, "someday"); }, ctx: {} },
    ],
    empty: null,
    emptyInline: !projs.length && !todos.length ? "В этой области пока пусто. Добавьте задачу или создайте проект через меню «…»." : "",
  };
}

function vTag(tag) {
  const items = [...S.db.projects.filter(p => S.isOpenProject(p) && S.hasTag(p, tag.id)), ...S.db.todos.filter(openBy(t => S.isOpenTodo(t) && S.hasTag(t, tag.id)))].sort(S.byIndex);
  return { sections: [{ id: "tag", items, assign: x => { if (!x.tags.includes(tag.id)) x.tags.push(tag.id); if (x.inbox) x.inbox = false; }, ctx: { parent: true, when: true, today: true } }],
    empty: { icon: "tag", text: "С этим тегом открытых задач нет." } };
}

function buildView() {
  const v = ui.view;
  if (v.type === "project") return vProject(S.getProject(v.id));
  if (v.type === "area") return vArea(S.getArea(v.id));
  if (v.type === "tag") return vTag(S.getTag(v.id));
  return { inbox: vInbox, today: vToday, upcoming: vUpcoming, anytime: vAnytime, someday: vSomeday, logbook: vLogbook, trash: vTrash }[v.type]();
}
function viewTitle() {
  const v = ui.view;
  if (v.type === "project") return S.getProject(v.id)?.title || "Новый проект";
  if (v.type === "area") return S.getArea(v.id)?.title || "Новая область";
  if (v.type === "tag") return S.getTag(v.id)?.title || "Тег";
  return LISTS[v.type].title;
}

/* ================= headers ================= */
function whenChip(x, act = "when") {
  if (!x.when) return "";
  const t = T();
  let icon = "calendar", label = D.isDate(x.when) ? D.human(x.when) : "";
  if (x.when === "someday") { icon = "box"; label = "Когда-нибудь"; }
  else if (x.when <= t) { icon = S.isEvening(x) ? "moon" : "star"; label = S.isEvening(x) ? "Этим вечером" : "Сегодня"; }
  const cls = icon === "star" ? "c-today" : icon === "moon" ? "c-evening" : icon === "box" ? "c-someday" : "c-upcoming";
  return `<span class="chip"><button data-act="${act}">${ic(icon, cls)}${label}</button><button class="x" data-act="clear-when" title="Убрать">${ic("close")}</button></span>`;
}
function deadlineChip(x) {
  if (!x.deadline) return "";
  const due = x.deadline <= T();
  return `<span class="chip ${due ? "due" : ""}"><button data-act="deadline">${ic("flag", "c-deadline")}Срок: ${D.human(x.deadline)} <em>${D.deadlineLabel(x.deadline)}</em></button><button class="x" data-act="clear-deadline" title="Убрать">${ic("close")}</button></span>`;
}
function tagChips(x, removable = true) {
  return (x.tags || []).map(id => S.getTag(id)).filter(Boolean)
    .map(t => `<span class="chip tagc"><button data-act="tags">${esc(t.title)}</button>${removable ? `<button class="x" data-act="remove-tag" data-tag="${t.id}" title="Убрать">${ic("close")}</button>` : ""}</span>`).join("");
}

function projectHeader(p) {
  const status = p.trashed ? `<div class="banner">${ic("trash")}Проект в корзине <button class="btn subtle" data-act="restore-view">Восстановить</button></div>`
    : p.status !== "open" ? `<div class="banner">${ic(p.status === "canceled" ? "cancel" : "logbook", "c-logbook")}${p.status === "canceled" ? "Отменён" : "Завершён"} ${D.human(D.ymd(new Date(p.completedAt)), { long: true }).toLowerCase()} <button class="btn subtle" data-act="p-complete">Вернуть в работу</button></div>` : "";
  return `<div class="view-head project-head" data-id="${p.id}">
    <div class="ph-row"><button class="ph-pie c-project" data-act="p-complete" title="${p.status === "open" ? "Завершить проект" : "Вернуть в работу"}">${pie(S.projectProgress(p))}</button>
      <input class="ph-title" data-fk="ptitle:${p.id}" value="${esc(p.title)}" placeholder="Новый проект">
      <button class="icon-btn" data-act="p-menu" title="Действия с проектом">${ic("dots")}</button></div>
    ${status}
    <div class="chips-row">${whenChip(p)}${deadlineChip(p)}${tagChips(p)}${S.areaOf(p) ? `<button class="chip plain" data-nav-to="area:${p.areaId}">${ic("area", "c-area")}${esc(S.areaOf(p).title || "Без названия")}</button>` : ""}</div>
    <textarea class="ph-notes" data-fk="pnotes:${p.id}" placeholder="Заметки" rows="1">${esc(p.notes)}</textarea>
  </div>`;
}
function areaHeader(a) {
  return `<div class="view-head project-head" data-id="${a.id}">
    <div class="ph-row"><span class="ph-pie c-area">${ic("area")}</span>
      <input class="ph-title" data-fk="atitle:${a.id}" value="${esc(a.title)}" placeholder="Новая область">
      <button class="icon-btn" data-act="a-menu" title="Действия с областью">${ic("dots")}</button></div>
    <div class="chips-row">${tagChips(a)}</div>
  </div>`;
}

/* ================= rows ================= */
function parentLabel(x) {
  if (isProject(x)) { const a = S.getArea(x.areaId); return a ? esc(a.title || "Без названия") : ""; }
  const p = S.projectOf(x); if (p) return esc(p.title || "Без названия");
  const a = S.getArea(x.areaId); if (a) return esc(a.title || "Без названия");
  return x.inbox ? "Входящие" : "";
}
function metaHtml(x, ctx) {
  const parts = [];
  if (x.repeat) parts.push(`<span class="mi" title="${esc(D.repeatLabel(x.repeat))}">${ic("repeat")}</span>`);
  if (x.reminder) parts.push(`<span class="mi">${ic("bell")}${esc(x.reminder)}</span>`);
  for (const id of x.tags || []) { const t = S.getTag(id); if (t) parts.push(`<span class="tagp">${esc(t.title)}</span>`); }
  if (x.notes && x.notes.trim()) parts.push(`<span class="mi" title="Есть заметки">${ic("notes")}</span>`);
  if (x.checklist && x.checklist.length) parts.push(`<span class="mi">${ic("checklist")}${x.checklist.filter(c => c.done).length}/${x.checklist.length}</span>`);
  return parts.join("");
}
function prefixHtml(x, ctx) {
  const out = [];
  if (ctx.logDate && doneAt(x)) out.push(`<span class="pill">${D.human(D.ymd(new Date(doneAt(x))))}</span>`);
  if (ctx.datePill && D.isDate(x.when) && x.when > T()) out.push(`<span class="pill">${D.toDate(x.when).getDate()} ${D.MONTHS_SHORT[D.toDate(x.when).getMonth()]}</span>`);
  if (ctx.today && x.status === "open" && S.inToday(x)) out.push(ic(S.isEvening(x) ? "moon" : "star", (S.isEvening(x) ? "c-evening" : "c-today") + " pre"));
  if (ctx.when && D.isDate(x.when) && x.when > T()) out.push(`<span class="pill">${D.human(x.when)}</span>`);
  if (ctx.when && x.when === "someday") out.push(ic("box", "c-someday pre"));
  return out.join("");
}
function deadlineHtml(x) {
  if (!x.deadline || x.status !== "open") return "";
  return `<span class="dl ${x.deadline <= T() ? "due" : ""}">${ic("flag")}${D.human(x.deadline)}</span>`;
}
function checkHtml(x, ctx) {
  const st = x.status === "completed" ? "done" : x.status === "canceled" ? "canceled" : "";
  return `<button class="check ${st} ${x.when === "someday" ? "dashed" : ""}" data-act="check" ${ctx.trash ? "disabled" : ""} aria-label="Выполнено">${st === "done" ? ic("check") : st === "canceled" ? ic("close") : ""}</button>`;
}

function rowHtml(x, sec) {
  const ctx = sec.ctx || {};
  if (isProject(x)) {
    const sub = ctx.parent ? parentLabel(x) : "";
    return `<div class="row prow ${ui.sel.has(x.id) ? "selected" : ""} ${x.status !== "open" ? "is-" + x.status : ""}" data-id="${x.id}" data-sec="${sec.id}">
      <span class="prow-pie c-project">${pie(S.projectProgress(x))}</span>
      <div class="row-main"><div class="row-line">${prefixHtml(x, ctx)}<span class="row-title">${untitled(x.title)}</span><span class="meta">${metaHtml(x, ctx)}</span></div>${sub ? `<div class="row-sub">${sub}</div>` : ""}</div>
      ${deadlineHtml(x)}${ctx.trash ? `<button class="icon-btn" data-act="restore" title="Восстановить">${ic("restore")}</button>` : ""}</div>`;
  }
  if (x.id === ui.openId) return cardHtml(x, sec);
  const sub = ctx.parent ? parentLabel(x) : "";
  return `<div class="row ${ui.sel.has(x.id) ? "selected" : ""} ${x.status !== "open" ? "is-" + x.status : ""}" data-id="${x.id}" data-sec="${sec.id}">
    ${checkHtml(x, ctx)}
    <div class="row-main"><div class="row-line">${prefixHtml(x, ctx)}<span class="row-title">${x.title.trim() ? esc(x.title) : `<span class="untitled">Новая задача</span>`}</span><span class="meta">${metaHtml(x, ctx)}</span></div>${sub ? `<div class="row-sub">${sub}</div>` : ""}</div>
    ${deadlineHtml(x)}${ctx.trash ? `<button class="icon-btn" data-act="restore" title="Восстановить">${ic("restore")}</button>` : ""}</div>`;
}

function cardHtml(t, sec) {
  const ck = t.checklist.map(c => `<div class="ck-item ${c.done ? "done" : ""}" data-ck="${c.id}"><button class="ck-box" data-act="ck-toggle" data-ck="${c.id}">${c.done ? ic("check") : ""}</button><input data-fk="ck:${t.id}:${c.id}" value="${esc(c.title)}" placeholder="Пункт"></div>`).join("");
  const btns = [
    !t.when && `<button class="icon-btn" data-act="when" title="Когда (Ctrl+S)">${ic("calendar")}</button>`,
    `<button class="icon-btn" data-act="tags" title="Теги (Ctrl+Shift+T)">${ic("tag")}</button>`,
    `<button class="icon-btn" data-act="checklist" title="Чек-лист">${ic("checklist")}</button>`,
    !t.deadline && `<button class="icon-btn" data-act="deadline" title="Крайний срок (Ctrl+Shift+D)">${ic("flag")}</button>`,
    `<button class="icon-btn" data-act="more" title="Ещё">${ic("dots")}</button>`,
  ].filter(Boolean).join("");
  const extra = [
    whenChip(t),
    t.reminder ? `<span class="chip"><button data-act="reminder">${ic("bell")}${esc(t.reminder)}</button><button class="x" data-act="clear-reminder">${ic("close")}</button></span>` : "",
    t.repeat ? `<span class="chip"><button data-act="repeat">${ic("repeat")}${esc(D.repeatLabel(t.repeat))}</button><button class="x" data-act="clear-repeat">${ic("close")}</button></span>` : "",
    deadlineChip(t),
  ].join("");
  return `<div class="row card ${t.status !== "open" ? "is-" + t.status : ""}" data-id="${t.id}" data-sec="${sec.id}">
    <div class="card-top">${checkHtml(t, sec.ctx || {})}<input class="card-title" data-fk="title:${t.id}" value="${esc(t.title)}" placeholder="Новая задача"></div>
    <div class="card-body">
      <textarea class="card-notes" data-fk="notes:${t.id}" placeholder="Заметки" rows="1">${esc(t.notes)}</textarea>
      ${t.tags.length ? `<div class="chips-row">${tagChips(t)}</div>` : ""}
      ${ck ? `<div class="checklist">${ck}</div>` : ""}
      <div class="card-foot"><div class="chips-row">${extra}</div><div class="card-btns">${btns}</div></div>
    </div></div>`;
}

function sectionHtml(sec) {
  const rows = sec.items.map(x => rowHtml(x, sec)).join("");
  if (!rows && !sec.alwaysShow) return "";
  const droppable = sec.assign || sec.assignP;
  const head = sec.head ? `<div class="sec-head" ${droppable ? `data-drop-sec="${sec.id}"` : ""}>${sec.head}</div>`
    : droppable ? `<div class="sec-drop" data-drop-sec="${sec.id}"></div>` : "";
  const dragOnly = sec.alwaysShow === "drag" && !rows;
  return `<section class="sec ${sec.cls || ""} ${dragOnly ? "drag-only" : ""}" data-sec="${sec.id}">${head}<div class="rows">${rows}</div></section>`;
}

/* ================= tag filter ================= */
function inheritedTags(x) {
  const out = new Set(x.tags || []);
  if (!isProject(x)) (S.projectOf(x)?.tags || []).forEach(t => out.add(t));
  (S.areaOf(x)?.tags || []).forEach(t => out.add(t));
  return out;
}
function matchesTag(x, tagId) {
  const set = S.tagWithDescendants(tagId);
  for (const t of inheritedTags(x)) if (set.has(t)) return true;
  return false;
}

/* ================= render ================= */
function render() {
  applyTheme();
  appEl.dataset.pane = ui.pane;
  renderSidebar();
  renderMain();
  renderToolbar();
}

function renderMain() {
  const v = ui.view;
  if ((v.type === "project" && !S.getProject(v.id)) || (v.type === "area" && !S.getArea(v.id)) || (v.type === "tag" && !S.getTag(v.id))) { ui.view = { type: "today" }; }
  if (ui.reveal) {
    const x = S.getAny(ui.reveal);
    if (x && ui.view.type === "project" && x.status !== "open") ui.showLogged = true;
  }
  const model = buildView();
  const allItems = model.sections.flatMap(s => s.items);
  const tagIds = new Set();
  allItems.forEach(x => inheritedTags(x).forEach(t => tagIds.add(t)));
  if (ui.tagFilter && !tagIds.has(ui.tagFilter)) ui.tagFilter = null;
  if (ui.tagFilter) for (const s of model.sections) s.items = s.items.filter(x => matchesTag(x, ui.tagFilter));
  sections = model.sections;

  const L = LISTS[v.type];
  const header = model.header || `<div class="view-head"><h1><span class="vh-icon ${L ? L.color : "c-tag"}">${ic(L ? L.icon : "tag")}</span><span>${esc(viewTitle())}</span></h1>${model.extra || ""}</div>`;
  const tags = [...tagIds].map(S.getTag).filter(Boolean).sort(S.byIndex);
  const tagbar = tags.length && v.type !== "tag" ? `<div class="tagbar"><button class="tchip ${!ui.tagFilter ? "on" : ""}" data-tagf="">Все</button>${tags.map(t => `<button class="tchip ${ui.tagFilter === t.id ? "on" : ""}" data-tagf="${t.id}">${esc(t.title)}</button>`).join("")}</div>` : "";
  const body = sections.map(sectionHtml).join("");
  const anyItems = sections.some(s => s.items.length);
  const empty = !anyItems && model.empty ? `<div class="empty">${ic(model.empty.icon)}<p>${model.empty.text}</p></div>` : "";
  const inline = model.emptyInline ? `<p class="empty-inline">${model.emptyInline}</p>` : "";

  const ae = document.activeElement;
  const prevFocus = ae && contentEl.contains(ae) && ae.dataset.fk ? { fk: ae.dataset.fk, start: ae.selectionStart, end: ae.selectionEnd } : null;
  const top = scrollerEl.scrollTop;
  contentEl.innerHTML = header + tagbar + `<div class="sections">${body}</div>` + empty + inline;
  contentEl.dataset.view = v.type;
  document.title = `${viewTitle() || "Без названия"} — Дела`;
  contentEl.querySelectorAll("textarea").forEach(autosize);
  scrollerEl.scrollTop = top;

  if (ui.openId && !contentEl.querySelector(`.card[data-id="${ui.openId}"]`)) ui.openId = null;
  for (const id of ui.sel) if (!contentEl.querySelector(`.row[data-id="${id}"]`)) ui.sel.delete(id);
  const want = ui.focus || prevFocus;
  ui.focus = null;
  if (want) {
    const el = contentEl.querySelector(`[data-fk="${CSS.escape(want.fk)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      const len = el.value.length, s = want.caret === "end" ? len : (want.start ?? len), e = want.caret === "end" ? len : (want.end ?? s);
      try { el.setSelectionRange(s, e); } catch { /* not a text input */ }
      if (want.scroll) el.closest(".row, .sec, .view-head")?.scrollIntoView({ block: "nearest" });
    }
  }
  if (ui.reveal) {
    const id = ui.reveal; ui.reveal = null;
    const row = contentEl.querySelector(`.row[data-id="${id}"]`);
    if (row) {
      ui.sel = new Set([id]); ui.anchor = id; markSelection();
      row.scrollIntoView({ block: "center" });
      row.classList.add("flash");
    }
  }
}

function autosize(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
function markSelection() {
  contentEl.querySelectorAll(".row[data-id]").forEach(r => r.classList.toggle("selected", ui.sel.has(r.dataset.id)));
}

/* ================= sidebar ================= */
function sidebarProjects(areaId) {
  return S.db.projects.filter(p => (p.areaId || null) === areaId && S.isOpenProject(p) && p.when !== "someday").sort(S.byIndex);
}
function renderSidebar() {
  const v = ui.view, narrow = isNarrow();
  const active = (type, id) => !narrow && v.type === type && (v.id || null) === (id || null) ? "active" : "";
  const inbox = S.db.todos.filter(S.inInbox).length;
  const tc = S.todayCounts();
  const item = (type, extra = "") => {
    const L = LISTS[type];
    return `<a class="nav-item ${active(type)}" href="#${type}" draggable="false" data-drop="${type}"><span class="ni-icon ${L.color}">${ic(L.icon)}</span><span class="ni-label">${L.title}</span>${extra}</a>`;
  };
  const projectItem = p => `<a class="nav-item proj ${active("project", p.id)}" href="#project/${p.id}" draggable="false" data-drop="project:${p.id}" data-drag="project" data-id="${p.id}"><span class="ni-icon c-project">${pie(S.projectProgress(p))}</span><span class="ni-label">${untitled(p.title)}</span>${p.deadline && p.deadline <= T() ? `<span class="badge red">!</span>` : ""}</a>`;
  let html = `<div class="sb-head"><button class="sb-search" data-act="search">${ic("search")}<span>Быстрый поиск</span><kbd>/</kbd></button></div>
    <nav class="sb-scroll">
      <div class="sb-group">${item("inbox", inbox ? `<span class="count">${inbox}</span>` : "")}</div>
      <div class="sb-group">
        ${item("today", (tc.due ? `<span class="badge red">${tc.due}</span>` : "") + (tc.total ? `<span class="count">${tc.total}</span>` : ""))}
        ${item("upcoming")}${item("anytime")}${item("someday")}
      </div>
      <div class="sb-group">${item("logbook")}${item("trash")}</div>`;
  const loose = sidebarProjects(null);
  if (loose.length) html += `<div class="sb-group">${loose.map(projectItem).join("")}</div>`;
  for (const a of sortedAreas()) {
    html += `<div class="sb-group area-group"><a class="nav-item area ${active("area", a.id)}" href="#area/${a.id}" draggable="false" data-drop="area:${a.id}" data-drag="area" data-id="${a.id}"><span class="ni-icon c-area">${ic("area")}</span><span class="ni-label">${untitled(a.title)}</span></a>${sidebarProjects(a.id).map(projectItem).join("")}</div>`;
  }
  html += `</nav><div class="sb-foot"><button class="sb-new" data-act="new-list">${ic("plus")}<span>Новый список</span></button><button class="icon-btn" data-act="tags-manager" title="Теги">${ic("tag")}</button><button class="icon-btn" data-act="settings" title="Настройки">${ic("gear")}</button></div>`;
  const scroll = sidebarEl.querySelector(".sb-scroll")?.scrollTop || 0;
  sidebarEl.innerHTML = html;
  sidebarEl.querySelector(".sb-scroll").scrollTop = scroll;
}

/* ================= toolbar ================= */
function defaultSection() { return sections.find(s => s.assign && s.alwaysShow !== "drag" && s.id !== "logged") || null; }
function renderToolbar() {
  const n = ui.sel.size, has = n > 0 || !!ui.openId, v = ui.view.type;
  const canAdd = !!defaultSection();
  const inTrash = v === "trash";
  const b = (act, icon, title, on = true) => `<button class="tb" data-act="${act}" title="${title}" ${on ? "" : "disabled"}>${ic(icon)}</button>`;
  toolbarEl.innerHTML = `
    <div class="tb-group main-tools">${b("new", "plus", "Новая задача (Alt+N, Пробел)", canAdd)}${v === "project" ? b("new-heading", "heading", "Новый заголовок (Alt+Shift+N)") : ""}</div>
    <div class="tb-group sel-tools">
      ${n > 1 || ui.selectMode ? `<span class="tb-count">${n} выбрано</span>` : ""}
      ${b("when", "calendar", "Когда (Ctrl+S)", has)}${b("move", "move", "Переместить (Ctrl+Shift+M)", has)}${b("tags", "tag", "Теги (Ctrl+Shift+T)", has)}${b("deadline", "flag", "Крайний срок (Ctrl+Shift+D)", has)}
      ${b("complete", "check", "Выполнить (Ctrl+K)", has && !inTrash)}${inTrash ? b("restore-sel", "restore", "Восстановить", has) : b("trash", "trash", "Удалить (Delete)", has)}
      ${ui.selectMode || (isNarrow() && n) ? b("clear-sel", "close", "Готово") : ""}
    </div>
    <div class="tb-group">${b("search", "search", "Быстрый поиск (Ctrl+F или /)")}</div>`;
  toolbarEl.classList.toggle("has-sel", n > 0 || ui.selectMode);
  fabEl.hidden = !(ui.pane === "home" || (canAdd && !n && !ui.openId));
  const title = viewTitle();
  topbarEl.innerHTML = `<button class="tb-back" data-act="home">${ic("back")}<span>Списки</span></button><span class="tb-title">${esc(title)}</span><span class="spacer"></span>
    <button class="icon-btn" data-act="select-mode" title="Выбрать">${ic("select")}</button><button class="icon-btn" data-act="search" title="Поиск">${ic("search")}</button>`;
}

/* ================= actions ================= */
const items = ids => ids.map(S.getAny).filter(Boolean);
const targets = () => ui.openId ? [ui.openId] : [...ui.sel];
const anchorFor = ids => contentEl.querySelector(`.row[data-id="${ids[0]}"]`) || null;

function openTodo(id, { focus = lastPointer !== "touch" } = {}) {
  if (ui.openId && ui.openId !== id) closeEditor({ silent: true });
  ui.openId = id; ui.sel = new Set([id]); ui.anchor = id;
  if (focus) ui.focus = { fk: `title:${id}`, caret: "end" };
  render();
  contentEl.querySelector(".card")?.scrollIntoView({ block: "nearest" });
}
function closeEditor({ silent = false } = {}) {
  const id = ui.openId; if (!id) return;
  ui.openId = null;
  const t = S.getTodo(id);
  if (t && !t.title.trim() && !t.notes.trim() && !t.checklist.length && !t.repeat) {
    S.db.todos.splice(S.db.todos.indexOf(t), 1); S.save(); ui.sel.delete(id);
  } else ui.sel = new Set([id]);
  if (!silent) render();
}

function reorderInto(list, rest0, refId, before, key = "index") {
  const kv = x => key === "todayIndex" ? S.todayKey(x) : (x.index || 0);
  const moving = [...list].sort((a, b) => kv(a) - kv(b));
  const rest = rest0.filter(x => !list.includes(x));
  let pos = refId == null ? (before ? 0 : rest.length) : rest.findIndex(x => x.id === refId) + (before ? 0 : 1);
  if (pos < 0) pos = rest.length;
  const prev = pos > 0 ? kv(rest[pos - 1]) : null, next = pos < rest.length ? kv(rest[pos]) : null;
  const n = moving.length;
  moving.forEach((x, i) => {
    let v;
    if (prev == null && next == null) v = S.nextIndex();
    else if (prev == null) v = next - (n - i);
    else if (next == null) v = prev + i + 1;
    else v = prev + (next - prev) * (i + 1) / (n + 1);
    x[key] = v;
    if (v > S.db.seq) S.db.seq = Math.ceil(v);
  });
}

function newTodo({ title = "" } = {}) {
  let sec = null, ref = null;
  const selId = ui.openId || (ui.sel.size === 1 ? [...ui.sel][0] : null);
  if (selId) {
    const row = contentEl.querySelector(`.row[data-id="${selId}"]`);
    const s = row && secById(row.dataset.sec);
    if (s && s.assign && S.getTodo(selId)) { sec = s; ref = selId; }
  }
  if (!sec && ui.lastSec) sec = secById(ui.lastSec) || null;
  if (!sec) sec = defaultSection();
  if (!sec) { quickEntry(); return; }
  if (ui.openId) closeEditor({ silent: true });
  commit(() => {
    const t = S.createTodo({ title });
    sec.assign(t);
    if (ui.tagFilter) t.tags = [ui.tagFilter];
    reorderInto([t], sec.items, ref, false, sec.orderKey);
    ui.openId = t.id; ui.sel = new Set([t.id]); ui.anchor = t.id;
    ui.focus = { fk: `title:${t.id}`, caret: "end", scroll: true };
  });
}

function newHeading() {
  if (ui.view.type !== "project") return;
  const pid = ui.view.id;
  commit(() => { const h = S.createHeading(pid); ui.focus = { fk: `htitle:${h.id}`, caret: "end", scroll: true }; });
}

function newProject(areaId = null) {
  let p;
  commit(() => { p = S.createProject({ areaId }); });
  ui.focus = { fk: `ptitle:${p.id}`, caret: "end" };
  navigate({ type: "project", id: p.id });
}
function newArea() {
  let a;
  commit(() => { a = S.createArea(); });
  ui.focus = { fk: `atitle:${a.id}`, caret: "end" };
  navigate({ type: "area", id: a.id });
}

function toggleComplete(ids, status = "completed") {
  const list = items(ids);
  if (!list.length) return;
  const target = list.every(x => x.status === status) ? "open" : status;
  if (target !== "open") {
    for (const p of list.filter(isProject)) {
      const n = S.projectTodos(p).length;
      if (n && !confirm(`В проекте «${p.title || "Без названия"}» остались открытые задачи (${n}). ${status === "completed" ? "Завершить" : "Отменить"} проект вместе с ними?`)) return;
    }
  }
  let spawned = null;
  commit(() => {
    for (const x of list) {
      if (x.status !== "open") ui.prevDone.set(x.id, x.completedAt);
      ui.touched.add(x.id);
      spawned = S.setStatus(x, target) || spawned;
    }
  });
  if (spawned) toast(`Следующее повторение: ${esc(D.human(spawned.when, { long: true }).toLowerCase())}`);
}

function trashItems(ids) {
  const list = items(ids).filter(x => !x.trashed);
  if (!list.length) return;
  commit(() => { list.forEach(S.trash); ui.sel.clear(); if (ids.includes(ui.openId)) ui.openId = null; });
  toast(list.length === 1 ? "Перемещено в корзину" : `В корзину: ${list.length}`, { undo: true });
}
function restoreItems(ids) {
  const list = items(ids).filter(x => x.trashed);
  if (!list.length) return;
  commit(() => { list.forEach(S.restore); ui.sel.clear(); });
  toast(list.length === 1 ? "Восстановлено" : `Восстановлено: ${list.length}`, { undo: true });
}
function duplicateItems(ids) {
  commit(() => {
    const out = items(ids).map(S.duplicate);
    ui.sel = new Set(out.map(x => x.id));
  });
}

function setWhenFor(ids, when, evening) {
  commit(() => items(ids).forEach(x => { if (x.trashed) S.restore(x); S.setWhen(x, when, evening); }));
  if (ids.length && D.isDate(when) && when > T() && ui.view.type !== "upcoming" && ui.view.type !== "project" && ui.view.type !== "area") {
    toast(`Запланировано: ${esc(D.human(when, { long: true }).toLowerCase())}`, { undo: true });
  }
}
function askNotify() {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}
function actWhen(anchor, ids) {
  const list = items(ids); if (!list.length) return;
  const x = list[0], single = list.length === 1 && !isProject(x);
  P.whenPicker(anchor, {
    when: x.when, evening: x.evening, reminder: single ? x.reminder : null,
    onPick: (w, ev) => setWhenFor(ids, w, ev),
    onReminder: single ? time => {
      commit(() => { const t = S.getTodo(x.id); if (!D.isDate(t.when) && time) S.setWhen(t, T()); t.reminder = time; t.remindedFor = null; });
      if (time) askNotify();
    } : null,
  });
}
function actReminder(anchor, id) {
  const t = S.getTodo(id); if (!t) return;
  P.reminderPicker(anchor, { time: t.reminder, onPick: time => {
    commit(() => { const x = S.getTodo(id); if (!D.isDate(x.when) && time) S.setWhen(x, T()); x.reminder = time; x.remindedFor = null; });
    if (time) askNotify();
  } });
}
function actRepeat(anchor, id) {
  const t = S.getTodo(id); if (!t) return;
  P.repeatPicker(anchor, { rule: t.repeat, when: t.when, onPick: rule => commit(() => {
    const x = S.getTodo(id); x.repeat = rule;
    if (rule && !D.isDate(x.when)) S.setWhen(x, rule.mode === "fixed" && rule.days?.length ? firstMatching(rule) : T());
  }) });
}
function firstMatching(rule) {
  let d = T();
  for (let i = 0; i < 7; i++) { if (rule.days.includes(D.weekday(d))) return d; d = D.addDays(d, 1); }
  return T();
}
function actDeadline(anchor, ids) {
  const list = items(ids); if (!list.length) return;
  P.deadlinePicker(anchor, { deadline: list[0].deadline, onPick: d => commit(() => items(ids).forEach(x => { x.deadline = d; })) });
}
function actTags(anchor, ids, getter = items) {
  const list = getter(ids); if (!list.length) return;
  let prev = new Set(list.reduce((acc, x) => acc.filter(t => (x.tags || []).includes(t)), [...(list[0].tags || [])]));
  P.tagPicker(anchor, { selected: [...prev], onChange: next => {
    const now = new Set(next);
    commit(() => {
      for (const x of getter(ids)) {
        const s = new Set(x.tags || []);
        for (const t of now) if (!prev.has(t)) s.add(t);
        for (const t of prev) if (!now.has(t)) s.delete(t);
        x.tags = [...s];
      }
    });
    prev = now;
  } });
}
function actMove(anchor, ids) {
  const list = items(ids); if (!list.length) return;
  const projectsOnly = list.every(isProject);
  P.movePicker(anchor, { projectsOnly, title: projectsOnly ? "Переместить в область" : "Переместить", onPick: dest => {
    commit(() => {
      for (const x of items(ids)) {
        if (x.trashed) S.restore(x);
        if (isProject(x)) { if (dest.kind === "area" || dest.kind === "none") x.areaId = dest.kind === "area" ? dest.id : null; }
        else S.moveTodo(x, dest);
      }
    });
    const label = dest.kind === "inbox" ? "Входящие" : dest.kind === "project" ? S.getProject(dest.id)?.title : dest.kind === "area" ? S.getArea(dest.id)?.title : "без области";
    toast(`Перемещено: ${esc(label || "Без названия")}`, { undo: true });
  } });
}

function itemMenu(anchor, id) {
  const x = S.getAny(id); if (!x) return;
  const ids = ui.sel.has(id) ? [...ui.sel] : [id];
  if (isProject(x) && ids.length === 1) { projectMenu(anchor, x); return; }
  const single = ids.length === 1 && !isProject(x);
  if (x.trashed) {
    P.menu(anchor, [{ label: "Восстановить", icon: "restore", action: () => restoreItems(ids) }]);
    return;
  }
  P.menu(anchor, [
    { label: "Открыть", icon: "notes", hint: "Enter", action: () => openTodo(id), disabled: !single },
    { sep: 1 },
    { label: "Когда…", icon: "calendar", hint: "Ctrl+S", action: () => actWhen(anchor, ids) },
    { label: "Переместить…", icon: "move", hint: "Ctrl+⇧+M", action: () => actMove(anchor, ids) },
    { label: "Теги…", icon: "tag", hint: "Ctrl+⇧+T", action: () => actTags(anchor, ids) },
    { label: "Крайний срок…", icon: "flag", hint: "Ctrl+⇧+D", action: () => actDeadline(anchor, ids) },
    ...(single ? [
      { label: x.repeat ? "Изменить повтор…" : "Повторять…", icon: "repeat", action: () => actRepeat(anchor, id) },
      { label: "Напоминание…", icon: "bell", action: () => actReminder(anchor, id) },
    ] : []),
    { sep: 1 },
    { label: x.status === "completed" ? "Вернуть в работу" : "Выполнить", icon: "check", hint: "Ctrl+K", action: () => toggleComplete(ids) },
    { label: x.status === "canceled" ? "Вернуть в работу" : "Отменить", icon: "cancel", hint: "Ctrl+Alt+K", action: () => toggleComplete(ids, "canceled") },
    { label: "Дублировать", icon: "copy", hint: "Ctrl+D", action: () => duplicateItems(ids) },
    ...(single ? [{ label: "Преобразовать в проект", icon: "project", action: () => { let p; commit(() => { p = S.todoToProject(S.getTodo(id)); }); navigate({ type: "project", id: p.id }); } }] : []),
    { sep: 1 },
    { label: "Удалить", icon: "trash", danger: 1, hint: "Delete", action: () => trashItems(ids) },
  ]);
}

function projectMenu(anchor, p) {
  const id = p.id;
  const leave = () => { const a = p.areaId; if (ui.view.type === "project" && ui.view.id === id) navigate(a && S.getArea(a) ? { type: "area", id: a } : { type: "today" }); };
  P.menu(anchor, [
    ...(p.status === "open" ? [
      { label: "Завершить проект", icon: "logbook", action: () => toggleComplete([id]) },
      { label: "Отменить проект", icon: "cancel", action: () => toggleComplete([id], "canceled") },
    ] : [{ label: "Вернуть в работу", icon: "restore", action: () => toggleComplete([id], p.status) }]),
    { sep: 1 },
    { label: "Когда…", icon: "calendar", action: () => actWhen(anchor, [id]) },
    { label: "Теги…", icon: "tag", action: () => actTags(anchor, [id]) },
    { label: "Крайний срок…", icon: "flag", action: () => actDeadline(anchor, [id]) },
    { label: "Переместить в область…", icon: "move", action: () => actMove(anchor, [id]) },
    ...(ui.view.type === "project" ? [{ label: "Добавить заголовок", icon: "heading", hint: "Alt+⇧+N", action: newHeading }] : [{ label: "Открыть проект", icon: "chevron", action: () => navigate({ type: "project", id }) }]),
    { label: "Дублировать проект", icon: "copy", action: () => { let c; commit(() => { c = S.duplicate(S.getProject(id)); }); navigate({ type: "project", id: c.id }); } },
    { sep: 1 },
    { label: "Удалить проект", icon: "trash", danger: 1, action: () => { commit(() => S.trash(S.getProject(id))); toast("Проект перемещён в корзину", { undo: true }); leave(); } },
  ]);
}

function areaMenu(anchor, a) {
  P.menu(anchor, [
    { label: "Новый проект в области", icon: "plus", action: () => newProject(a.id) },
    { label: "Теги области…", icon: "tag", action: () => actTags(anchor, [a.id], ids => ids.map(S.getArea).filter(Boolean)) },
    { label: "Переименовать", icon: "notes", action: () => { ui.focus = { fk: `atitle:${a.id}`, caret: "end" }; renderMain(); } },
    { sep: 1 },
    { label: "Удалить область", icon: "trash", danger: 1, action: () => {
      if (!confirm(`Удалить область «${a.title || "Без названия"}»? Её проекты и задачи попадут в корзину.`)) return;
      commit(() => S.deleteArea(S.getArea(a.id)));
      toast("Область удалена", { undo: true });
      navigate({ type: "today" });
    } },
  ]);
}

function headingMenu(anchor, hid) {
  const h = S.getHeading(hid); if (!h) return;
  const siblings = S.db.headings.filter(x => x.projectId === h.projectId && !x.archived).sort(S.byIndex);
  const i = siblings.indexOf(h);
  const swap = j => commit(() => { const o = siblings[j]; [h.index, o.index] = [o.index, h.index]; });
  P.menu(anchor, [
    { label: "Архивировать (выполнить всё)", icon: "logbook", action: () => commit(() => S.archiveHeading(S.getHeading(hid))) },
    { label: "Преобразовать в проект", icon: "project", action: () => { let p; commit(() => { p = S.headingToProject(S.getHeading(hid)); }); navigate({ type: "project", id: p.id }); } },
    { label: "Переместить выше", icon: "back", disabled: i <= 0, action: () => swap(i - 1) },
    { label: "Переместить ниже", icon: "chevron", disabled: i >= siblings.length - 1, action: () => swap(i + 1) },
    { sep: 1 },
    { label: "Удалить заголовок", icon: "trash", danger: 1, action: () => {
      const n = S.db.todos.filter(t => t.headingId === hid && !t.trashed && t.status === "open").length;
      if (n && !confirm(`Под заголовком ${n} ${D.plural(n, "задача", "задачи", "задач")}. Удалить их вместе с заголовком?`)) return;
      commit(() => S.deleteHeading(S.getHeading(hid)));
      toast("Заголовок удалён", { undo: true });
    } },
  ]);
}

function newListMenu(anchor) {
  P.menu(anchor, [
    { label: "Новый проект", icon: "project", action: () => newProject(ui.view.type === "area" ? ui.view.id : null) },
    { label: "Новая область", icon: "area", action: newArea },
  ]);
}

/* ================= toast ================= */
let toastTimer;
function toast(html, { undo = false, action, onAction, ms = 4000 } = {}) {
  const el = $("#toast");
  el.innerHTML = `<span>${html}</span>${undo ? `<button data-t="undo">Отменить</button>` : ""}${action ? `<button data-t="act">${esc(action)}</button>` : ""}`;
  el.classList.add("show");
  el.onclick = e => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    if (b.dataset.t === "undo") S.undo(); else onAction && onAction();
    el.classList.remove("show");
  };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/* ================= events: content ================= */
let suppressClick = false;
document.addEventListener("click", e => {
  if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
  if (ui.openId && !e.target.closest(".card, .pop-layer, .modal-layer, #toolbar, #toast") && document.contains(e.target)) closeEditor();
}, true);
document.addEventListener("pointerdown", e => { lastPointer = e.pointerType === "mouse" ? "mouse" : "touch"; }, true);

function handleAct(act, el, id, e) {
  const t = id && S.getTodo(id);
  const pv = ui.view.type === "project" ? S.getProject(ui.view.id) : null;
  const headId = el.closest(".project-head")?.dataset.id;
  const ctxIds = id ? [id] : headId ? [headId] : targets();
  switch (act) {
    case "check": toggleComplete([id]); break;
    case "when": actWhen(el, ctxIds); break;
    case "deadline": actDeadline(el, ctxIds); break;
    case "tags": ui.view.type === "area" && headId ? actTags(el, [headId], ids => ids.map(S.getArea).filter(Boolean)) : actTags(el, ctxIds); break;
    case "more": itemMenu(el, id); break;
    case "repeat": actRepeat(el, id); break;
    case "reminder": actReminder(el, id); break;
    case "clear-when": commit(() => items(ctxIds).forEach(x => S.setWhen(x, null))); break;
    case "clear-deadline": commit(() => items(ctxIds).forEach(x => { x.deadline = null; })); break;
    case "clear-repeat": commit(() => { S.getTodo(id).repeat = null; }); break;
    case "clear-reminder": commit(() => { const x = S.getTodo(id); x.reminder = null; x.remindedFor = null; }); break;
    case "remove-tag": {
      const tag = el.dataset.tag;
      const obj = id ? S.getAny(id) : (S.getProject(headId) || S.getArea(headId));
      commit(() => { obj.tags = obj.tags.filter(x => x !== tag); });
      break;
    }
    case "checklist": {
      const cid = S.uid();
      commit(() => { t.checklist.push({ id: cid, title: "", done: false }); ui.focus = { fk: `ck:${id}:${cid}` }; });
      break;
    }
    case "ck-toggle": commit(() => { const c = t.checklist.find(c => c.id === el.dataset.ck); c.done = !c.done; }); break;
    case "restore": restoreItems([id]); break;
    case "restore-view": commit(() => S.restore(pv)); break;
    case "p-menu": projectMenu(el, pv); break;
    case "p-complete": toggleComplete([pv.id], pv.status === "canceled" ? "canceled" : "completed"); break;
    case "a-menu": areaMenu(el, S.getArea(ui.view.id)); break;
    case "h-menu": headingMenu(el, el.dataset.hid); break;
    case "toggle-logged": ui.showLogged = !ui.showLogged; renderMain(); break;
    case "empty-trash":
      if (confirm("Окончательно удалить всё из корзины?")) { commit(S.emptyTrash); toast("Корзина очищена", { undo: true }); }
      break;
  }
}

contentEl.addEventListener("click", e => {
  const act = e.target.closest("[data-act]");
  const row = e.target.closest(".row[data-id]");
  if (act) { handleAct(act.dataset.act, act, row?.dataset.id, e); return; }
  const nav = e.target.closest("[data-nav-to]");
  if (nav) { const [type, id] = nav.dataset.navTo.split(":"); navigate({ type, id }); return; }
  const tf = e.target.closest("[data-tagf]");
  if (tf) { ui.tagFilter = tf.dataset.tagf || null; renderMain(); return; }
  if (row && !row.classList.contains("card")) { rowClick(row, e); return; }
  if (!row && !e.target.closest("input, textarea, button") && ui.sel.size) { ui.sel.clear(); markSelection(); renderToolbar(); }
});

function rowClick(row, e) {
  const id = row.dataset.id, x = S.getAny(id);
  ui.lastSec = null;
  const multi = e.metaKey || e.ctrlKey || e.shiftKey;
  if (isProject(x) && !multi && !ui.selectMode && ui.view.type !== "trash") { navigate({ type: "project", id }); return; }
  if (lastPointer === "touch" && !ui.selectMode) { if (!isProject(x) && !x.trashed) openTodo(id); return; }
  if (ui.selectMode || e.metaKey || e.ctrlKey) { ui.sel.has(id) ? ui.sel.delete(id) : ui.sel.add(id); ui.anchor = id; }
  else if (e.shiftKey && ui.anchor) {
    const rows = [...contentEl.querySelectorAll(".row[data-id]")].map(r => r.dataset.id);
    const a = rows.indexOf(ui.anchor), b = rows.indexOf(id);
    if (a >= 0 && b >= 0) ui.sel = new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1));
  } else { ui.sel = new Set([id]); ui.anchor = id; }
  markSelection(); renderToolbar();
}

contentEl.addEventListener("dblclick", e => {
  const row = e.target.closest(".row[data-id]:not(.card)");
  if (!row || e.target.closest("[data-act]")) return;
  const x = S.getAny(row.dataset.id);
  if (x && !isProject(x) && !x.trashed) openTodo(x.id);
});

contentEl.addEventListener("contextmenu", e => {
  const row = e.target.closest(".row[data-id]");
  if (!row || e.target.closest("input, textarea")) return;
  e.preventDefault();
  if (lastPointer === "touch") return;
  const id = row.dataset.id;
  if (!ui.sel.has(id)) { ui.sel = new Set([id]); ui.anchor = id; markSelection(); renderToolbar(); }
  const pt = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) };
  itemMenu(pt, id);
});

// Typing in inline fields edits data in place; one undo step per editing session.
let pendingSnap = null;
contentEl.addEventListener("focusin", e => {
  if (e.target.dataset?.fk) pendingSnap = S.snapshot();
  if (e.target.dataset?.fk?.startsWith("htitle:")) ui.lastSec = "h" + e.target.dataset.fk.slice(7);
});
contentEl.addEventListener("input", e => {
  const fk = e.target.dataset?.fk; if (!fk) return;
  if (pendingSnap) { S.pushUndo(pendingSnap); pendingSnap = null; }
  const [k, id, sub] = fk.split(":"), v = e.target.value;
  if (k === "title") S.getTodo(id).title = v;
  else if (k === "notes") S.getTodo(id).notes = v;
  else if (k === "ck") { const c = S.getTodo(id).checklist.find(c => c.id === sub); if (c) c.title = v; }
  else if (k === "ptitle") { S.getProject(id).title = v; renderSidebar(); topbarEl.querySelector(".tb-title").textContent = v; }
  else if (k === "pnotes") S.getProject(id).notes = v;
  else if (k === "atitle") { S.getArea(id).title = v; renderSidebar(); topbarEl.querySelector(".tb-title").textContent = v; }
  else if (k === "htitle") S.getHeading(id).title = v;
  if (e.target.tagName === "TEXTAREA") autosize(e.target);
  S.save();
});

contentEl.addEventListener("keydown", e => {
  const fk = e.target.dataset?.fk; if (!fk || e.isComposing) return;
  const [k, id, cid] = fk.split(":");
  if (k === "title" && e.key === "Enter") { e.preventDefault(); closeEditor(); }
  else if ((k === "ptitle" || k === "atitle" || k === "htitle") && e.key === "Enter") { e.preventDefault(); e.target.blur(); }
  else if (k === "ptitle" && e.key === "ArrowDown") { e.preventDefault(); contentEl.querySelector(".ph-notes")?.focus(); }
  else if (k === "ck") checklistKey(e, id, cid);
});

function checklistKey(e, tid, cid) {
  const t = S.getTodo(tid), i = t.checklist.findIndex(c => c.id === cid);
  const focusCk = j => { const c = t.checklist[j]; if (c) contentEl.querySelector(`[data-fk="ck:${tid}:${c.id}"]`)?.focus(); };
  if (e.key === "Enter") {
    e.preventDefault();
    if (!e.target.value.trim()) { commit(() => { t.checklist.splice(i, 1); ui.focus = { fk: `notes:${tid}`, caret: "end" }; }); return; }
    const nid = S.uid();
    const at = e.target.selectionStart, val = e.target.value;
    commit(() => {
      t.checklist[i].title = val.slice(0, at);
      t.checklist.splice(i + 1, 0, { id: nid, title: val.slice(at), done: false });
      ui.focus = { fk: `ck:${tid}:${nid}`, start: 0, end: 0 };
    });
  } else if (e.key === "Backspace" && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
    e.preventDefault();
    const prev = t.checklist[i - 1], rest = e.target.value;
    commit(() => {
      t.checklist.splice(i, 1);
      if (prev) { const len = prev.title.length; prev.title += rest; ui.focus = { fk: `ck:${tid}:${prev.id}`, start: len, end: len }; }
      else ui.focus = { fk: `notes:${tid}`, caret: "end" };
    });
  } else if (e.key === "ArrowUp") { e.preventDefault(); focusCk(i - 1); }
  else if (e.key === "ArrowDown") { e.preventDefault(); focusCk(i + 1); }
}

// Pasting several lines: into a checklist item → several items; into a new to-do's title → several to-dos.
contentEl.addEventListener("paste", e => {
  const fk = e.target.dataset?.fk; if (!fk) return;
  const text = (e.clipboardData || window.clipboardData).getData("text");
  const lines = text.split(/\r?\n/).map(s => s.replace(/^\s*([-*•]|\d+[.)]|\[[ x]\])\s*/i, "").trim()).filter(Boolean);
  if (lines.length < 2) return;
  const [k, id, cid] = fk.split(":");
  if (k === "ck") {
    e.preventDefault();
    const t = S.getTodo(id), i = t.checklist.findIndex(c => c.id === cid);
    commit(() => {
      t.checklist[i].title += lines[0];
      const add = lines.slice(1).map(title => ({ id: S.uid(), title, done: false }));
      t.checklist.splice(i + 1, 0, ...add);
      ui.focus = { fk: `ck:${id}:${add[add.length - 1].id}`, caret: "end" };
    });
  } else if (k === "title" && !S.getTodo(id).title && confirm(`Создать ${lines.length} ${D.plural(lines.length, "задачу", "задачи", "задач")} — по одной на строку?`)) {
    e.preventDefault();
    const row = contentEl.querySelector(`.row[data-id="${id}"]`), sec = secById(row?.dataset.sec);
    commit(() => {
      const first = S.getTodo(id); first.title = lines[0];
      let prev = first;
      for (const line of lines.slice(1)) {
        const t = S.createTodo({ ...structuredClone(first), id: S.uid(), title: line, createdAt: Date.now() });
        if (sec) reorderInto([t], [...sec.items, first], prev.id, false, sec.orderKey);
        prev = t;
      }
      ui.openId = null; ui.sel = new Set([id]);
    });
  } else if (k === "ptitle" || k === "atitle" || k === "htitle" || k === "title") {
    e.preventDefault();
    document.execCommand("insertText", false, lines.join(" "));
  }
});

/* ================= events: sidebar, toolbar, topbar ================= */
sidebarEl.addEventListener("click", e => {
  const a = e.target.closest("[data-act]");
  if (a) {
    if (a.dataset.act === "search") quickFind();
    if (a.dataset.act === "new-list") newListMenu(a);
    if (a.dataset.act === "settings") settings();
    if (a.dataset.act === "tags-manager") tagsManager();
    return;
  }
  const link = e.target.closest("a.nav-item");
  if (link && link.getAttribute("href") === location.hash) { e.preventDefault(); ui.pane = "list"; render(); }
});
sidebarEl.addEventListener("contextmenu", e => {
  const n = e.target.closest(".nav-item[data-drag]"); if (!n) return;
  e.preventDefault();
  if (lastPointer === "touch") return;
  const pt = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) };
  if (n.dataset.drag === "project") projectMenu(pt, S.getProject(n.dataset.id));
  else areaMenu(pt, S.getArea(n.dataset.id));
});

toolbarEl.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  const ids = targets();
  switch (b.dataset.act) {
    case "new": newTodo(); break;
    case "new-heading": newHeading(); break;
    case "when": actWhen(b, ids); break;
    case "move": actMove(b, ids); break;
    case "tags": actTags(b, ids); break;
    case "deadline": actDeadline(b, ids); break;
    case "complete": toggleComplete(ids); break;
    case "trash": trashItems(ids); break;
    case "restore-sel": restoreItems(ids); break;
    case "clear-sel": ui.sel.clear(); ui.selectMode = false; markSelection(); renderToolbar(); break;
    case "search": quickFind(); break;
  }
});
topbarEl.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.dataset.act === "home") { if (ui.openId) closeEditor({ silent: true }); location.hash = "#home"; }
  if (b.dataset.act === "search") quickFind();
  if (b.dataset.act === "select-mode") { ui.selectMode = !ui.selectMode; if (!ui.selectMode) ui.sel.clear(); if (ui.openId) closeEditor({ silent: true }); render(); }
});
fabEl.addEventListener("click", () => { if (suppressClick) return; ui.pane === "home" ? quickEntry() : newTodo(); });

/* ================= drag and drop (mouse + touch) ================= */
let drag = null;
document.addEventListener("pointerdown", e => {
  if (e.button !== 0 || P.popoverOpen() || modal) return;
  const src = e.target.closest("#content .row[data-id]:not(.card), #sidebar .nav-item[data-drag]");
  if (!src || e.target.closest("button, input, textarea, select")) return;
  if (ui.view.type === "logbook" && src.matches(".row")) return;
  drag = { src, x0: e.clientX, y0: e.clientY, pid: e.pointerId, touch: e.pointerType !== "mouse", mode: "pending" };
  if (drag.touch) {
    const d = drag;
    d.timer = setTimeout(() => { if (drag === d && d.mode === "pending") { startDrag(d.x0, d.y0); navigator.vibrate?.(12); } }, 380);
  }
});
document.addEventListener("pointermove", e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (drag.mode === "pending") {
    if (!drag.touch && Math.hypot(dx, dy) > 5) startDrag(e.clientX, e.clientY);
    else if (drag.touch) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6 && drag.src.matches(".row") && ui.view.type !== "trash") { clearTimeout(drag.timer); drag.mode = "swipe"; drag.src.classList.add("swiping"); }
      else if (Math.hypot(dx, dy) > 10) { clearTimeout(drag.timer); drag = null; return; }
    }
  }
  if (drag.mode === "swipe") {
    const x = Math.max(-120, Math.min(120, dx));
    drag.src.style.transform = `translateX(${x}px)`;
    drag.src.dataset.swipe = x > 70 ? "when" : x < -70 ? "select" : "";
  } else if (drag.mode === "drag") {
    drag.lastX = e.clientX; drag.lastY = e.clientY;
    drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
    findTarget(e.clientX, e.clientY);
  }
}, { passive: false });
document.addEventListener("touchmove", e => { if (drag && (drag.mode === "drag" || drag.mode === "swipe")) e.preventDefault(); }, { passive: false });
document.addEventListener("pointerup", e => endDrag(e, true));
document.addEventListener("pointercancel", e => endDrag(e, false));
document.addEventListener("contextmenu", e => { if (drag && drag.touch) e.preventDefault(); });

function startDrag(x, y) {
  const src = drag.src;
  if (src.matches(".row")) {
    const id = src.dataset.id, obj = S.getAny(id);
    if (!ui.sel.has(id)) { ui.sel = new Set([id]); ui.anchor = id; markSelection(); renderToolbar(); }
    drag.kind = isProject(obj) ? "project" : "todo";
    drag.ids = drag.kind === "todo" ? [...ui.sel].filter(i => S.getTodo(i)) : [id];
    drag.label = (obj.title || "Без названия") + (drag.ids.length > 1 ? ` и ещё ${drag.ids.length - 1}` : "");
  } else {
    drag.kind = src.dataset.drag;
    drag.ids = [src.dataset.id];
    drag.label = (drag.kind === "project" ? S.getProject(drag.ids[0]) : S.getArea(drag.ids[0]))?.title || "Без названия";
  }
  drag.mode = "drag";
  drag.ghost = document.createElement("div");
  drag.ghost.className = "ghost";
  drag.ghost.textContent = drag.label;
  drag.ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
  document.body.append(drag.ghost);
  document.body.classList.add("dragging");
  drag.ids.forEach(id => document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.classList.add("drag-src")));
  drag.lastY = y;
  drag.scrollTimer = setInterval(autoScroll, 16);
}
function autoScroll() {
  if (!drag || drag.mode !== "drag") return;
  for (const el of [scrollerEl, sidebarEl.querySelector(".sb-scroll")]) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (drag.lastX < r.left || drag.lastX > r.right) continue;
    if (drag.lastY < r.top + 40 && drag.lastY > r.top - 20) el.scrollTop -= 10;
    else if (drag.lastY > r.bottom - 40 && drag.lastY < r.bottom + 20) el.scrollTop += 10;
  }
}
function clearMarks() {
  document.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach(el => el.classList.remove("drop-before", "drop-after", "drop-into"));
}
function findTarget(x, y) {
  clearMarks();
  const el = document.elementFromPoint(x, y);
  let t = null;
  const half = node => { const r = node.getBoundingClientRect(); return y < r.top + r.height / 2; };
  const nav = el?.closest(".nav-item[data-drop]");
  if (drag.kind === "todo") {
    if (nav && nav.dataset.drop !== "upcoming") t = { type: "nav", el: nav, drop: nav.dataset.drop };
    else {
      const row = el?.closest("#content .row[data-id]");
      const sec = row && secById(row.dataset.sec);
      if (row && !drag.ids.includes(row.dataset.id) && sec?.assign) t = { type: "row", el: row, sec: sec.id, refId: row.dataset.id, before: half(row) };
      else {
        const head = el?.closest("[data-drop-sec]") || el?.closest(".sec")?.querySelector("[data-drop-sec]");
        if (head && secById(head.dataset.dropSec)?.assign) t = { type: "sec", el: head, sec: head.dataset.dropSec };
      }
    }
  } else if (drag.kind === "project") {
    if (nav?.dataset.drag === "project" && !drag.ids.includes(nav.dataset.id)) t = { type: "navproj", el: nav, refId: nav.dataset.id, before: half(nav) };
    else if (nav && (nav.dataset.drag === "area" || ["today", "anytime", "someday", "logbook", "trash"].includes(nav.dataset.drop))) t = { type: "nav", el: nav, drop: nav.dataset.drop };
    else {
      const row = el?.closest("#content .row[data-id]");
      const sec = row && secById(row.dataset.sec);
      if (row && !drag.ids.includes(row.dataset.id) && sec?.assignP) t = { type: "row", el: row, sec: sec.id, refId: row.dataset.id, before: half(row) };
      else {
        const head = el?.closest("[data-drop-sec]");
        if (head && secById(head.dataset.dropSec)?.assignP) t = { type: "sec", el: head, sec: head.dataset.dropSec };
      }
    }
  } else if (drag.kind === "area") {
    if (nav?.dataset.drag === "area" && !drag.ids.includes(nav.dataset.id)) t = { type: "navarea", el: nav, refId: nav.dataset.id, before: half(nav) };
  }
  if (t) t.el.classList.add(t.type === "row" || t.type === "navproj" || t.type === "navarea" ? (t.before ? "drop-before" : "drop-after") : "drop-into");
  drag.target = t;
}
function endDrag(e, commitDrop) {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  clearTimeout(d.timer);
  if (d.mode === "drag") {
    clearInterval(d.scrollTimer);
    d.ghost.remove();
    document.body.classList.remove("dragging");
    document.querySelectorAll(".drag-src").forEach(el => el.classList.remove("drag-src"));
    clearMarks();
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
    if (commitDrop && d.target) applyDrop(d);
  } else if (d.mode === "swipe") {
    const act = d.src.dataset.swipe, id = d.src.dataset.id;
    d.src.style.transform = ""; d.src.classList.remove("swiping");
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
    if (act === "when") actWhen(d.src, ui.sel.has(id) && ui.sel.size > 1 ? [...ui.sel] : [id]);
    if (act === "select") { ui.selectMode = true; ui.sel.has(id) ? ui.sel.delete(id) : ui.sel.add(id); markSelection(); renderToolbar(); }
  }
}

function applyDrop(d) {
  const t = d.target;
  if (t.type === "nav" && t.drop === "trash") { trashItems(d.ids); return; }
  if (t.type === "nav" && t.drop === "logbook") { toggleComplete(d.ids.filter(id => S.getAny(id)?.status === "open")); return; }
  commit(() => {
    if (d.kind === "area") {
      reorderInto(d.ids.map(S.getArea).filter(Boolean), sortedAreas(), t.refId, t.before);
      return;
    }
    const list = items(d.ids);
    if (t.type === "nav") {
      const [kind, id] = t.drop.split(":");
      for (const x of list) {
        if (x.trashed) S.restore(x);
        if (kind === "inbox" && !isProject(x)) S.moveTodo(x, { kind: "inbox" });
        else if (kind === "today") S.setWhen(x, T(), false);
        else if (kind === "anytime") anytimeize(x);
        else if (kind === "someday") S.setWhen(x, "someday");
        else if (kind === "project" && !isProject(x)) S.moveTodo(x, { kind: "project", id });
        else if (kind === "area") { if (isProject(x)) x.areaId = id; else S.moveTodo(x, { kind: "area", id }); }
      }
    } else if (t.type === "navproj") {
      const ref = S.getProject(t.refId);
      list.forEach(p => { p.areaId = ref.areaId; });
      reorderInto(list, sidebarProjects(ref.areaId || null), ref.id, t.before);
    } else {
      const sec = secById(t.sec);
      for (const x of list) { if (x.trashed) S.restore(x); (isProject(x) ? sec.assignP : sec.assign)?.(x); }
      reorderInto(list, sec.items, t.type === "row" ? t.refId : null, t.type === "row" ? t.before : true, sec.orderKey);
    }
  });
}

/* ================= keyboard ================= */
function moveSelection(dir, extend) {
  const rows = [...contentEl.querySelectorAll(".row[data-id]")];
  if (!rows.length) return;
  const ids = rows.map(r => r.dataset.id);
  const cur = ui.cursor && ui.sel.has(ui.cursor) ? ui.cursor : [...ui.sel].pop();
  let i = cur ? ids.indexOf(cur) : -1;
  i = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + dir));
  const id = ids[i];
  if (extend && ui.anchor) {
    const a = ids.indexOf(ui.anchor);
    ui.sel = new Set(ids.slice(Math.min(a, i), Math.max(a, i) + 1));
  } else { ui.sel = new Set([id]); ui.anchor = id; }
  ui.cursor = id;
  markSelection(); renderToolbar();
  rows[i].scrollIntoView({ block: "nearest" });
}
function nudge(dir) {
  const ids = targets(); if (ids.length !== 1) return;
  const row = contentEl.querySelector(`.row[data-id="${ids[0]}"]`);
  const sec = row && secById(row.dataset.sec);
  if (!sec || !(sec.assign || sec.assignP)) return;
  const i = sec.items.findIndex(x => x.id === ids[0]), j = i + dir;
  if (j < 0 || j >= sec.items.length) return;
  commit(() => reorderInto(items(ids), sec.items, sec.items[j].id, dir < 0, sec.orderKey));
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (P.popoverOpen()) { e.preventDefault(); P.closePopover(); return; }
    if (modal) { e.preventDefault(); closeModal(); return; }
    if (ui.openId) { e.preventDefault(); closeEditor(); return; }
    if (document.activeElement?.dataset?.fk) { document.activeElement.blur(); return; }
    if (ui.sel.size) { ui.sel.clear(); ui.selectMode = false; markSelection(); renderToolbar(); }
    return;
  }
  if (P.popoverOpen() || modal) return;
  const mod = e.metaKey || e.ctrlKey, alt = e.altKey, shift = e.shiftKey, code = e.code;
  const inField = !!e.target.closest?.("input, textarea, select, [contenteditable]");
  const ids = targets(), anchor = anchorFor(ids);
  const go = fn => { e.preventDefault(); fn(); };

  if ((e.ctrlKey || alt) && code === "Space") return go(quickEntry);
  if (mod && !shift && !alt && code === "KeyF") return go(() => quickFind());
  if ((mod || alt) && !shift && code === "KeyN") return go(() => newTodo());
  if ((mod || alt) && shift && code === "KeyN") return go(() => ui.view.type === "project" ? newHeading() : newProject());
  if ((mod || alt) && !shift && /^Digit[1-7]$/.test(code)) return go(() => navigate({ type: LIST_ORDER[+code.slice(5) - 1] }));
  if (mod && code === "KeyZ" && !inField) return go(() => { if (shift ? S.redo() : S.undo()) toast(shift ? "Повторено" : "Отменено"); });
  if (mod && code === "KeyY" && !inField) return go(() => { if (S.redo()) toast("Повторено"); });
  if (mod && code === "Enter" && ui.openId) return go(closeEditor);

  if (ids.length && (mod || alt)) {
    if (code === "KeyK" && !shift) return go(() => toggleComplete(ids, mod && alt ? "canceled" : "completed"));
    if (code === "KeyT" && !shift) return go(() => setWhenFor(ids, T(), false));
    if (code === "KeyE" && !shift) return go(() => setWhenFor(ids, T(), true));
    if (code === "KeyR" && !shift) return go(() => commit(() => items(ids).forEach(anytimeize)));
    if (code === "KeyO" && !shift) return go(() => setWhenFor(ids, "someday"));
    if (code === "KeyS" && !shift) return go(() => actWhen(anchor, ids));
    if (code === "KeyD" && shift) return go(() => actDeadline(anchor, ids));
    if (code === "KeyT" && shift) return go(() => actTags(anchor, ids));
    if (code === "KeyM" && shift) return go(() => actMove(anchor, ids));
    if (code === "KeyR" && shift && ids.length === 1 && S.getTodo(ids[0])) return go(() => actRepeat(anchor, ids[0]));
    if (code === "KeyD" && !shift && !inField) return go(() => duplicateItems(ids));
    if (code === "KeyC" && shift && ids.length === 1 && S.getTodo(ids[0])) return go(() => {
      if (ui.openId !== ids[0]) openTodo(ids[0]);
      handleAct("checklist", contentEl, ids[0]);
    });
    if ((code === "ArrowUp" || code === "ArrowDown") && !inField) return go(() => nudge(code === "ArrowUp" ? -1 : 1));
  }
  if (inField || mod || alt) return;

  if (e.key === "ArrowDown" || e.key === "ArrowUp") return go(() => moveSelection(e.key === "ArrowDown" ? 1 : -1, shift));
  if (e.key === "Enter" && ids.length === 1) {
    const x = S.getAny(ids[0]);
    return go(() => isProject(x) ? navigate({ type: "project", id: x.id }) : !x.trashed && openTodo(x.id));
  }
  if (e.key === " ") return go(() => newTodo());
  if ((e.key === "Backspace" || e.key === "Delete") && ids.length) return go(() => trashItems(ids));
  if (e.key === "?") return go(shortcutsHelp);
  if (e.key === "/") return go(() => quickFind());
  if (e.key.length === 1 && /\p{L}|\d/u.test(e.key)) return go(() => quickFind(e.key));
});

/* ================= modals ================= */
let modal = null;
function openModal(cls, build) {
  closeModal();
  const layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true"></div>`;
  document.body.append(layer);
  modal = { layer, box: layer.firstChild, onClose: null };
  layer.addEventListener("pointerdown", e => { if (e.target === layer) closeModal(); });
  build(modal.box, modal);
  return modal;
}
function closeModal() {
  if (!modal) return;
  P.closePopover();
  const m = modal; modal = null;
  m.layer.remove();
  m.onClose && m.onClose();
}

function homeViewOf(x) {
  if (x.trashed || (!isProject(x) && S.projectOf(x)?.trashed)) return { type: "trash" };
  if (isProject(x)) return { type: "project", id: x.id };
  if (x.projectId && S.getProject(x.projectId)) return { type: "project", id: x.projectId };
  if (x.status !== "open") return { type: "logbook" };
  if (x.inbox) return { type: "inbox" };
  if (S.inToday(x)) return { type: "today" };
  if (x.areaId && S.getArea(x.areaId)) return { type: "area", id: x.areaId };
  if (x.when === "someday") return { type: "someday" };
  if (D.isDate(x.when) && x.when > T()) return { type: "upcoming" };
  return { type: "anytime" };
}
function reveal(x) {
  if (isProject(x)) { navigate({ type: "project", id: x.id }); return; }
  ui.reveal = x.id;
  navigate(homeViewOf(x));
}

function searchAll(q) {
  const out = [];
  q = q.replace(/ё/g, "е");
  const has = s => (s || "").toLowerCase().replace(/ё/g, "е").includes(q);
  for (const [type, L] of Object.entries(LISTS)) if (!q || has(L.title)) out.push({ group: "Списки", icon: ic(L.icon, L.color), label: L.title, go: () => navigate({ type }) });
  if (!q) return out;
  for (const a of sortedAreas()) if (has(a.title)) out.push({ group: "Области", icon: ic("area", "c-area"), label: a.title || "Без названия", go: () => navigate({ type: "area", id: a.id }) });
  for (const p of S.db.projects.filter(p => !p.trashed).sort(S.byIndex)) if (has(p.title) || has(p.notes)) out.push({ group: "Проекты", icon: pie(S.projectProgress(p), "c-project"), label: p.title || "Без названия", sub: p.status !== "open" ? "в журнале" : parentLabel(p), go: () => navigate({ type: "project", id: p.id }) });
  for (const t of S.db.tags) if (has(t.title)) out.push({ group: "Теги", icon: ic("tag", "c-tag"), label: t.title, go: () => navigate({ type: "tag", id: t.id }) });
  const todos = S.db.todos.filter(t => !t.trashed && (has(t.title) || has(t.notes) || t.checklist.some(c => has(c.title))))
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.createdAt - a.createdAt).slice(0, 60);
  for (const t of todos) out.push({ group: "Задачи", icon: `<span class="check mini ${t.status === "completed" ? "done" : t.status === "canceled" ? "canceled" : ""}">${t.status === "completed" ? ic("check") : ""}</span>`, label: t.title || "Новая задача", sub: parentLabel(t), go: () => reveal(t) });
  return out;
}

function quickFind(prefill = "") {
  openModal("qf", box => {
    box.innerHTML = `<div class="qf-bar">${ic("search")}<input placeholder="Быстрый поиск: задачи, проекты, теги" autocomplete="off" spellcheck="false"></div><div class="qf-res"></div>`;
    const input = $("input", box), res = $(".qf-res", box);
    let results = [], hot = 0;
    const draw = () => {
      results = searchAll(input.value.trim().toLowerCase());
      let g = null, html = "";
      results.forEach((r, i) => {
        if (r.group !== g) { g = r.group; html += `<div class="qf-group">${g}</div>`; }
        html += `<button class="qf-item ${i === hot ? "hot" : ""}" data-i="${i}">${r.icon}<span class="qf-label">${esc(r.label)}</span>${r.sub ? `<span class="qf-sub">${r.sub}</span>` : ""}</button>`;
      });
      res.innerHTML = html || `<div class="empty-mini">Ничего не найдено</div>`;
      res.querySelector(".hot")?.scrollIntoView({ block: "nearest" });
    };
    input.value = prefill;
    input.addEventListener("input", () => { hot = 0; draw(); });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); hot = Math.min(results.length - 1, hot + 1); draw(); }
      if (e.key === "ArrowUp") { e.preventDefault(); hot = Math.max(0, hot - 1); draw(); }
      if (e.key === "Enter" && results[hot]) { e.preventDefault(); const r = results[hot]; closeModal(); r.go(); }
    });
    res.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) { const r = results[+b.dataset.i]; closeModal(); r.go(); } });
    draw();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function quickEntry() {
  const draft = { title: "", notes: "", when: null, evening: false, deadline: null, tags: [], dest: { kind: "inbox" } };
  if (ui.pane === "list" && ui.view.type === "project") draft.dest = { kind: "project", id: ui.view.id };
  if (ui.pane === "list" && ui.view.type === "area") draft.dest = { kind: "area", id: ui.view.id };
  if (ui.pane === "list" && ui.view.type === "today") draft.when = T();
  openModal("qe", box => {
    box.innerHTML = `<div class="qe-head">Быстрый ввод</div>
      <input class="qe-title" placeholder="Новая задача" autocomplete="off">
      <textarea class="qe-notes" placeholder="Заметки" rows="2"></textarea>
      <div class="chips-row qe-chips"></div>
      <div class="qe-foot">
        <button class="chip plain qe-dest" data-q="dest"></button><span class="spacer"></span>
        <button class="icon-btn" data-q="when" title="Когда">${ic("calendar")}</button>
        <button class="icon-btn" data-q="tags" title="Теги">${ic("tag")}</button>
        <button class="icon-btn" data-q="deadline" title="Крайний срок">${ic("flag")}</button>
      </div>
      <div class="pop-actions"><button class="btn" data-q="cancel">Отмена</button><button class="btn primary" data-q="save">Сохранить</button></div>`;
    const title = $(".qe-title", box), notes = $(".qe-notes", box);
    const draw = () => {
      const chips = [];
      if (draft.when) chips.push(whenChip(draft, "q-when").replace('data-act="clear-when"', 'data-q="clear-when"').replace('data-act="q-when"', 'data-q="when"'));
      if (draft.deadline) chips.push(`<span class="chip"><button data-q="deadline">${ic("flag", "c-deadline")}Срок: ${D.human(draft.deadline)}</button><button class="x" data-q="clear-deadline">${ic("close")}</button></span>`);
      draft.tags.map(S.getTag).filter(Boolean).forEach(t => chips.push(`<span class="chip tagc"><button data-q="tags">${esc(t.title)}</button></span>`));
      $(".qe-chips", box).innerHTML = chips.join("");
      const d = draft.dest;
      $(".qe-dest", box).innerHTML = d.kind === "inbox" ? `${ic("inbox", "c-inbox")}Входящие` : d.kind === "project" ? `${pie(0, "c-project")}${esc(S.getProject(d.id)?.title || "Без названия")}` : `${ic("area", "c-area")}${esc(S.getArea(d.id)?.title || "Без названия")}`;
    };
    const save = () => {
      if (!title.value.trim() && !notes.value.trim()) { closeModal(); return; }
      let t;
      commit(() => {
        t = S.createTodo({ title: title.value.trim(), notes: notes.value, tags: draft.tags, deadline: draft.deadline });
        S.moveTodo(t, draft.dest);
        if (draft.dest.kind === "inbox") { t.inbox = true; t.index = -S.nextIndex(); }
        if (draft.when) S.setWhen(t, draft.when, draft.evening);
      });
      closeModal();
      toast(`Сохранено: ${esc(homeViewOf(t).type === "inbox" ? "во Входящих" : "задача создана")}`, { action: "Показать", onAction: () => reveal(S.getTodo(t.id)) });
    };
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-q]"); if (!b) return;
      const q = b.dataset.q;
      if (q === "cancel") closeModal();
      if (q === "save") save();
      if (q === "when") P.whenPicker(b, { when: draft.when, evening: draft.evening, onPick: (w, ev) => { draft.when = w; draft.evening = ev; draw(); } });
      if (q === "clear-when") { draft.when = null; draw(); }
      if (q === "deadline") P.deadlinePicker(b, { deadline: draft.deadline, onPick: d => { draft.deadline = d; draw(); } });
      if (q === "clear-deadline") { draft.deadline = null; draw(); }
      if (q === "tags") P.tagPicker(b, { selected: draft.tags, onChange: ids => { draft.tags = ids; draw(); } });
      if (q === "dest") P.movePicker(b, { title: "Куда", onPick: d => { draft.dest = d.kind === "none" ? { kind: "inbox" } : d; draw(); } });
    });
    title.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); save(); } });
    notes.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });
    notes.addEventListener("input", () => autosize(notes));
    draw();
    title.focus();
  });
}

function shortcutsHelp() {
  const rows = [
    ["Создание", [["Новая задача", "Пробел · Alt+N"], ["Быстрый ввод", "Ctrl+Пробел · Alt+Пробел"], ["Новый заголовок / проект", "Alt+Shift+N"], ["Пункт чек-листа", "Ctrl+Shift+C"]]],
    ["Навигация", [["Входящие … Корзина", "Alt+1 … Alt+7"], ["Быстрый поиск", "/ · Ctrl+F · просто печатайте"], ["Выбор задач", "↑ ↓ · Shift+↑↓ · Ctrl+клик"], ["Открыть / закрыть", "Enter · Esc"]]],
    ["Планирование", [["Когда…", "Ctrl+S"], ["Сегодня", "Ctrl+T · Alt+T"], ["Этим вечером", "Ctrl+E"], ["В любое время", "Ctrl+R"], ["Когда-нибудь", "Ctrl+O"], ["Крайний срок", "Ctrl+Shift+D"], ["Повтор", "Ctrl+Shift+R"]]],
    ["Правка", [["Выполнить / отменить", "Ctrl+K · Ctrl+Alt+K"], ["Теги", "Ctrl+Shift+T"], ["Переместить", "Ctrl+Shift+M"], ["Дублировать", "Ctrl+D"], ["Сдвинуть вверх/вниз", "Ctrl+↑ ↓"], ["В корзину", "Delete"], ["Отменить / повторить", "Ctrl+Z · Ctrl+Shift+Z"]]],
  ];
  openModal("help", box => {
    box.innerHTML = `<div class="modal-head"><h2>Сочетания клавиш</h2><button class="icon-btn" data-close>${ic("close")}</button></div>
      <p class="muted small">На Mac вместо Ctrl можно нажимать ⌘. Если браузер перехватывает сочетание, используйте вариант с Alt (⌥).</p>
      <div class="help-grid">${rows.map(([g, list]) => `<div><h3>${g}</h3>${list.map(([a, k]) => `<div class="help-row"><span>${a}</span><kbd>${k}</kbd></div>`).join("")}</div>`).join("")}</div>
      <p class="muted small">На телефоне: свайп вправо — «Когда», свайп влево — выбор нескольких, долгое нажатие — перетаскивание.</p>`;
    box.querySelector("[data-close]").addEventListener("click", closeModal);
  });
}

function settings() {
  openModal("settings", box => {
    const draw = () => {
      const th = S.db.settings.theme || "auto";
      const perm = "Notification" in window ? Notification.permission : "unsupported";
      const counts = `${S.db.todos.length} ${D.plural(S.db.todos.length, "задача", "задачи", "задач")}, ${S.db.projects.length} ${D.plural(S.db.projects.length, "проект", "проекта", "проектов")}, ${S.db.areas.length} ${D.plural(S.db.areas.length, "область", "области", "областей")}`;
      box.innerHTML = `<div class="modal-head"><h2>Настройки</h2><button class="icon-btn" data-s="close">${ic("close")}</button></div>
        <div class="set-row"><span>Оформление</span><div class="seg">${[["auto", "Авто"], ["light", "Светлая"], ["dark", "Тёмная"]].map(([k, l]) => `<button class="${th === k ? "on" : ""}" data-theme="${k}">${l}</button>`).join("")}</div></div>
        <div class="set-row"><span>Напоминания</span>${perm === "granted" ? `<span class="muted">Уведомления включены</span>` : perm === "unsupported" ? `<span class="muted">Браузер не поддерживает уведомления</span>` : perm === "denied" ? `<span class="muted">Уведомления запрещены в браузере</span>` : `<button class="btn" data-s="notify">Включить уведомления</button>`}</div>
        <div class="set-row"><span>Теги</span><button class="btn" data-s="tags">Управление тегами</button></div>
        <div class="set-row"><span>Клавиатура</span><button class="btn" data-s="keys">Сочетания клавиш</button></div>
        <h3>Данные</h3>
        <p class="muted small">Всё хранится только в этом браузере: ${counts}. Делайте резервную копию, чтобы перенести данные на другое устройство.</p>
        <div class="set-actions">
          <button class="btn" data-s="export">${ic("download")}Экспорт (JSON)</button>
          <label class="btn">${ic("upload")}Импорт<input type="file" accept="application/json,.json" hidden></label>
          <button class="btn" data-s="demo">Демо-данные</button>
          <button class="btn danger" data-s="wipe">Удалить всё</button>
        </div>`;
    };
    draw();
    box.addEventListener("click", e => {
      const th = e.target.closest("[data-theme]");
      if (th) { commit(() => { S.db.settings.theme = th.dataset.theme; }); draw(); return; }
      const b = e.target.closest("[data-s]"); if (!b) return;
      const s = b.dataset.s;
      if (s === "close") closeModal();
      if (s === "notify") Notification.requestPermission().then(draw);
      if (s === "tags") tagsManager();
      if (s === "keys") shortcutsHelp();
      if (s === "export") {
        const blob = new Blob([JSON.stringify(S.db, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `dela-backup-${T()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      if (s === "demo" && confirm("Заменить текущие данные демонстрационными? Это можно отменить через Ctrl+Z.")) { S.resetToDemo(); closeModal(); navigate({ type: "today" }); }
      if (s === "wipe" && confirm("Удалить все задачи, проекты, области и теги?")) { S.wipe(); closeModal(); navigate({ type: "inbox" }); }
    });
    box.addEventListener("change", e => {
      const f = e.target.files?.[0]; if (!f) return;
      f.text().then(txt => {
        const data = JSON.parse(txt);
        if (!Array.isArray(data.todos)) throw new Error("bad file");
        S.replaceAll(data);
        closeModal();
        toast("Данные импортированы", { undo: true });
      }).catch(() => alert("Не удалось прочитать файл. Нужен JSON, сохранённый через «Экспорт»."));
    });
  });
}

function tagsManager() {
  openModal("tagsm", (box, m) => {
    const draw = () => {
      const out = [];
      const walk = (pid, d) => S.db.tags.filter(t => (t.parentId || null) === pid).sort(S.byIndex).forEach(t => { out.push([t, d]); walk(t.id, d + 1); });
      walk(null, 0);
      const count = id => S.db.todos.filter(x => S.isOpenTodo(x) && x.tags.includes(id)).length;
      box.innerHTML = `<div class="modal-head"><h2>Теги</h2><button class="icon-btn" data-t="close">${ic("close")}</button></div>
        <div class="tag-list">${out.map(([t, d]) => `<div class="tag-item" style="padding-left:${d * 20}px">
          <button class="icon-btn" data-t="open" data-id="${t.id}" title="Показать задачи">${ic("tag", "c-tag")}</button>
          <input value="${esc(t.title)}" data-id="${t.id}" class="pop-input">
          <select data-id="${t.id}" class="pop-input" title="Родительский тег"><option value="">— верхний уровень —</option>${S.db.tags.filter(x => x.id !== t.id && !S.tagWithDescendants(t.id).has(x.id)).map(x => `<option value="${x.id}" ${t.parentId === x.id ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select>
          <span class="muted small tcount">${count(t.id) || ""}</span>
          <button class="icon-btn" data-t="del" data-id="${t.id}" title="Удалить">${ic("trash")}</button></div>`).join("") || `<p class="muted">Тегов пока нет.</p>`}</div>
        <form class="tag-new"><input class="pop-input" placeholder="Новый тег" required><button class="btn primary">Добавить</button></form>`;
    };
    draw();
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      if (b.dataset.t === "close") closeModal();
      if (b.dataset.t === "open") { closeModal(); navigate({ type: "tag", id: b.dataset.id }); }
      if (b.dataset.t === "del") { const t = S.getTag(b.dataset.id); if (confirm(`Удалить тег «${t.title}»?`)) { commit(() => S.deleteTag(t)); draw(); } }
    });
    box.addEventListener("change", e => {
      const id = e.target.dataset.id; if (!id) return;
      if (e.target.tagName === "INPUT") { const v = e.target.value.trim(); if (v) commit(() => { S.getTag(id).title = v; }); }
      if (e.target.tagName === "SELECT") { commit(() => { S.getTag(id).parentId = e.target.value || null; }); draw(); }
    });
    box.addEventListener("submit", e => {
      e.preventDefault();
      const input = e.target.querySelector("input"), v = input.value.trim();
      if (v) { commit(() => S.createTag(v)); draw(); box.querySelector(".tag-new input").focus(); }
    });
  });
}

/* ================= theme, reminders, boot ================= */
function applyTheme() {
  const th = S.db.settings.theme;
  if (th === "light" || th === "dark") document.documentElement.dataset.theme = th;
  else delete document.documentElement.dataset.theme;
  const dark = th === "dark" || (th !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  $('meta[name="theme-color"]').setAttribute("content", dark ? "#1C1C1E" : "#F4F5F7");
}

function checkReminders() {
  const now = new Date(), t = T();
  let changed = false;
  for (const x of S.db.todos) {
    if (!x.reminder || x.status !== "open" || x.trashed || !D.isDate(x.when) || x.when > t) continue;
    const key = x.when + " " + x.reminder;
    if (x.remindedFor === key) continue;
    if (new Date(`${x.when}T${x.reminder}`) <= now) { x.remindedFor = key; changed = true; notify(x); }
  }
  if (changed) S.save();
}
function notify(x) {
  toast(`${ic("bell")} ${esc(x.title || "Напоминание")}`, { action: "Открыть", onAction: () => reveal(S.getTodo(x.id)), ms: 10000 });
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body: "Напоминание · Дела", tag: x.id, icon: "icon-192.png" };
  (navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(null))
    .then(reg => reg ? reg.showNotification(x.title || "Напоминание", opts) : new Notification(x.title || "Напоминание", opts))
    .catch(() => { try { new Notification(x.title || "Напоминание", opts); } catch { /* not allowed here */ } });
}

let lastDay = T();
setInterval(() => {
  checkReminders();
  if (T() !== lastDay) { lastDay = T(); if (!document.activeElement?.dataset?.fk) render(); }
}, 20000);

S.load();
S.onChange(render);
window.addEventListener("hashchange", route);
window.addEventListener("storage", e => { if (e.key === "things.data.v1") S.reloadFromStorage(); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
matchMedia("(max-width: 760px)").addEventListener("change", render);
route();
checkReminders();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
