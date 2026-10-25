// Data model, persistence, undo history and list queries.
import { todayStr, isDate, addDays, diffDays, nextOccurrence } from "./dates.js";

const KEY = "things.data.v1";
export let db;
const listeners = [];
const undoStack = [], redoStack = [];

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
export const T = () => todayStr();
export const nextIndex = () => (db.seq = (db.seq || 0) + 1);
export const onChange = f => listeners.push(f);
const emit = () => listeners.forEach(f => f());

function blank() {
  return { todos: [], projects: [], headings: [], areas: [], tags: [], seq: 0, settings: { theme: "auto" } };
}

const TODO_DEFAULTS = {
  title: "", notes: "", status: "open", when: null, evening: false, deadline: null, tags: [], checklist: [],
  projectId: null, areaId: null, headingId: null, inbox: false, todayIndex: null, completedAt: null,
  trashed: false, repeat: null, reminder: null, remindedFor: null,
};
const PROJECT_DEFAULTS = {
  title: "", notes: "", status: "open", when: null, evening: false, deadline: null, tags: [], areaId: null,
  todayIndex: null, completedAt: null, trashed: false,
};

function normalize(d) {
  const out = Object.assign(blank(), d);
  out.settings = Object.assign({ theme: "auto" }, d.settings);
  out.todos = (d.todos || []).map(t => Object.assign({}, TODO_DEFAULTS, t));
  out.projects = (d.projects || []).map(p => Object.assign({}, PROJECT_DEFAULTS, p));
  const max = Math.max(0, ...[...out.todos, ...out.projects, ...out.headings, ...out.areas, ...out.tags].map(x => x.index || 0));
  out.seq = Math.max(out.seq || 0, Math.ceil(max));
  return out;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    db = raw ? normalize(JSON.parse(raw)) : seed();
  } catch { db = seed(); }
  save();
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ } }
export function reloadFromStorage() { try { const raw = localStorage.getItem(KEY); if (raw) { db = normalize(JSON.parse(raw)); emit(); } } catch { /* ignore */ } }

export function commit(fn) {
  pushUndo(JSON.stringify(db));
  fn();
  save();
  emit();
}
export function pushUndo(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}
export const snapshot = () => JSON.stringify(db);
export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(JSON.stringify(db));
  db = JSON.parse(undoStack.pop());
  save(); emit();
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(JSON.stringify(db));
  db = JSON.parse(redoStack.pop());
  save(); emit();
  return true;
}
export function replaceAll(data) { commit(() => { db = normalize(data); }); }
export function resetToDemo() { commit(() => { db = seed(); }); }
export function wipe() { commit(() => { db = blank(); }); }

/* ---------- lookups ---------- */
export const getTodo = id => db.todos.find(x => x.id === id);
export const getProject = id => id ? db.projects.find(x => x.id === id) : null;
export const getArea = id => id ? db.areas.find(x => x.id === id) : null;
export const getHeading = id => id ? db.headings.find(x => x.id === id) : null;
export const getTag = id => db.tags.find(x => x.id === id);
export const getAny = id => getTodo(id) || getProject(id);
export const isProject = x => !!x && db.projects.includes(x);

export const byIndex = (a, b) => (a.index || 0) - (b.index || 0);
export const todayKey = x => x.todayIndex ?? x.index;
export const projectOf = t => getProject(t.projectId);
export const areaOf = x => getArea(isProject(x) ? x.areaId : (projectOf(x)?.areaId ?? x.areaId));

export const visibleTodo = t => !t.trashed && !projectOf(t)?.trashed;
export const isOpenTodo = t => t.status === "open" && visibleTodo(t);
export const isOpenProject = p => p.status === "open" && !p.trashed;
export const isEvening = x => !!x.evening && x.when === T();

export function inToday(x) {
  if (x.status !== "open" || x.trashed) return false;
  if (isDate(x.when) && x.when <= T()) return true;
  return !!(x.deadline && x.deadline <= T() && x.when !== "someday");
}
export function projectActive(p) {
  return !!p && isOpenProject(p) && p.when !== "someday" && !(isDate(p.when) && p.when > T());
}
export function inAnytime(t) {
  if (!isOpenTodo(t) || t.inbox || t.when === "someday") return false;
  if (isDate(t.when) && t.when > T()) return false;
  const p = projectOf(t);
  return p ? projectActive(p) : true;
}
export const inInbox = t => isOpenTodo(t) && t.inbox;

export function projectTodos(p, { all = false } = {}) {
  return db.todos.filter(t => t.projectId === p.id && !t.trashed && (all || t.status === "open"));
}
export function projectProgress(p) {
  const all = projectTodos(p, { all: true });
  if (!all.length) return p.status === "open" ? 0 : 1;
  return all.filter(t => t.status !== "open").length / all.length;
}
export function tagWithDescendants(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const t of db.tags) if (t.parentId && out.has(t.parentId) && !out.has(t.id)) { out.add(t.id); grew = true; } }
  return out;
}
export const hasTag = (x, tagId) => { const set = tagWithDescendants(tagId); return (x.tags || []).some(t => set.has(t)); };

export function todayItems() {
  const todos = db.todos.filter(t => isOpenTodo(t) && inToday(t));
  const projects = db.projects.filter(p => !p.trashed && inToday(p));
  return [...projects, ...todos].sort((a, b) => todayKey(a) - todayKey(b));
}
export const todayCounts = () => {
  const items = todayItems();
  return { total: items.length, due: items.filter(x => x.deadline && x.deadline <= T()).length };
};

/* ---------- mutations (call inside commit) ---------- */
export function createTodo(props = {}) {
  const t = Object.assign({ id: uid(), index: nextIndex(), createdAt: Date.now() }, structuredClone(TODO_DEFAULTS), props);
  db.todos.push(t);
  return t;
}
export function createProject(props = {}) {
  const p = Object.assign({ id: uid(), index: nextIndex(), createdAt: Date.now() }, structuredClone(PROJECT_DEFAULTS), props);
  db.projects.push(p);
  return p;
}
export function createArea(title = "") { const a = { id: uid(), title, index: nextIndex(), tags: [] }; db.areas.push(a); return a; }
export function createHeading(projectId, title = "") { const h = { id: uid(), projectId, title, index: nextIndex(), archived: false }; db.headings.push(h); return h; }
export function createTag(title, parentId = null) { const t = { id: uid(), title, parentId, index: nextIndex() }; db.tags.push(t); return t; }

export function setWhen(x, when, evening = false) {
  x.when = when || null;
  x.evening = !!evening && isDate(when);
  if (when && x.inbox !== undefined) x.inbox = false;
  if (!isDate(x.when)) x.reminder = null;
  x.remindedFor = null;
}

export function moveTodo(t, dest) {
  if (dest.kind === "inbox") Object.assign(t, { inbox: true, projectId: null, areaId: null, headingId: null, when: null, evening: false });
  if (dest.kind === "project") Object.assign(t, { inbox: false, projectId: dest.id, areaId: null, headingId: dest.headingId || null });
  if (dest.kind === "area") Object.assign(t, { inbox: false, projectId: null, areaId: dest.id, headingId: null });
  if (dest.kind === "none") Object.assign(t, { inbox: false, projectId: null, areaId: null, headingId: null });
}

// Completing a repeating to-do logs it and schedules the next occurrence as a fresh copy.
export function setStatus(x, status) {
  if (isProject(x)) return setProjectStatus(x, status);
  const wasOpen = x.status === "open";
  x.status = status;
  x.completedAt = status === "open" ? null : Date.now();
  if (wasOpen && status === "completed" && x.repeat) {
    const rule = x.repeat, t = T();
    let next;
    if (rule.mode === "after") next = nextOccurrence(rule, t);
    else {
      next = nextOccurrence(rule, isDate(x.when) ? x.when : t);
      while (next < t) next = nextOccurrence(rule, next);
      if (next === x.when) next = nextOccurrence(rule, next);
    }
    const copy = structuredClone(x);
    Object.assign(copy, {
      id: uid(), status: "open", completedAt: null, createdAt: Date.now(), when: next, remindedFor: null,
      evening: x.evening, checklist: x.checklist.map(c => ({ ...c, id: uid(), done: false })),
      deadline: x.deadline && isDate(x.when) ? addDays(next, diffDays(x.deadline, x.when)) : null,
      todayIndex: null, index: x.index,
    });
    db.todos.push(copy);
    x.repeat = null;
    x.repeatNext = copy.id;
    return copy;
  }
  return null;
}
function setProjectStatus(p, status) {
  p.status = status;
  p.completedAt = status === "open" ? null : Date.now();
  if (status !== "open") for (const t of projectTodos(p)) { t.status = status; t.completedAt = p.completedAt; }
}

export function trash(x) { x.trashed = true; x.trashedAt = Date.now(); }
export function restore(x) {
  x.trashed = false;
  if (isProject(x)) { if (x.areaId && !getArea(x.areaId)) x.areaId = null; return; }
  if (x.projectId && !getProject(x.projectId)) x.projectId = null;
  if (x.areaId && !getArea(x.areaId)) x.areaId = null;
  if (x.headingId && !getHeading(x.headingId)) x.headingId = null;
  const p = projectOf(x);
  if (p && p.trashed) restore(p);
  if (!x.projectId && !x.areaId && !x.when && !x.inbox) x.inbox = true;
}
export function emptyTrash() {
  const deadProjects = new Set(db.projects.filter(p => p.trashed).map(p => p.id));
  db.todos = db.todos.filter(t => !t.trashed && !deadProjects.has(t.projectId));
  db.headings = db.headings.filter(h => !deadProjects.has(h.projectId));
  db.projects = db.projects.filter(p => !p.trashed);
}
export function deleteArea(a) {
  for (const p of db.projects) if (p.areaId === a.id) trash(p);
  for (const t of db.todos) if (t.areaId === a.id) trash(t);
  db.areas = db.areas.filter(x => x !== a);
}
export function deleteTag(tag) {
  for (const t of db.tags) if (t.parentId === tag.id) t.parentId = tag.parentId;
  for (const x of [...db.todos, ...db.projects, ...db.areas]) x.tags = (x.tags || []).filter(id => id !== tag.id);
  db.tags = db.tags.filter(t => t !== tag);
}
export function duplicate(x) {
  if (isProject(x)) {
    const p = createProject({ ...structuredClone(x), id: uid(), index: x.index + 0.5, status: "open", completedAt: null, title: x.title + " (копия)" });
    const map = {};
    for (const h of db.headings.filter(h => h.projectId === x.id)) map[h.id] = createHeading(p.id, h.title).id;
    for (const t of projectTodos(x)) createTodo({ ...structuredClone(t), id: uid(), projectId: p.id, headingId: map[t.headingId] || null });
    return p;
  }
  return createTodo({ ...structuredClone(x), id: uid(), index: x.index + 0.5, status: "open", completedAt: null, createdAt: Date.now() });
}
export function todoToProject(t) {
  const p = createProject({ title: t.title, notes: t.notes, areaId: areaOf(t)?.id || null, when: t.when, deadline: t.deadline, tags: [...t.tags] });
  for (const c of t.checklist) createTodo({ title: c.title, projectId: p.id, status: c.done ? "completed" : "open", completedAt: c.done ? Date.now() : null });
  db.todos = db.todos.filter(x => x !== t);
  return p;
}
export function headingToProject(h) {
  const src = getProject(h.projectId);
  const p = createProject({ title: h.title, areaId: src?.areaId || null });
  for (const t of db.todos) if (t.headingId === h.id) { t.projectId = p.id; t.headingId = null; }
  db.headings = db.headings.filter(x => x !== h);
  return p;
}
export function archiveHeading(h) {
  for (const t of db.todos) if (t.headingId === h.id && t.status === "open") { t.status = "completed"; t.completedAt = Date.now(); }
  h.archived = true;
}
export function deleteHeading(h) {
  for (const t of db.todos) if (t.headingId === h.id) trash(t);
  db.headings = db.headings.filter(x => x !== h);
}

/* ---------- first-run sample data ---------- */
function seed() {
  const prev = db;
  db = blank();
  const t = T();
  const [home, work, errand, important] = ["Дом", "Работа", "Дела", "Важно"].map(n => createTag(n));
  const calls = createTag("Звонки", errand.id);

  const meet = createProject({ title: "Знакомство с приложением", notes: "Короткий тур по возможностям. Выполняйте задачи по ходу — это тоже часть знакомства.", when: t });
  const h1 = createHeading(meet.id, "Основы");
  const h2 = createHeading(meet.id, "Планирование");
  const h3 = createHeading(meet.id, "Скорость");
  const tour = [
    [h1, "Отметьте эту задачу выполненной", "Нажмите на квадратик слева. Выполненное попадает в Журнал."],
    [h1, "Откройте задачу двойным щелчком", "Внутри — заметки, чек-лист, теги и сроки. На телефоне достаточно одного касания."],
    [h1, "Создайте новую задачу", "Кнопка «+» внизу, клавиша Пробел или Alt+N. Быстрый ввод из любого места — Ctrl+Пробел."],
    [h2, "Запланируйте задачу на завтра", "Кнопка «Когда» понимает обычный текст: «завтра», «пт», «через 3 дня», «12.11»."],
    [h2, "Перетащите задачу в другой список", "Хватайте строку мышью (или долгим нажатием на телефоне) и бросайте на список слева."],
    [h2, "Поставьте крайний срок", "Флажок в открытой задаче. Задачи со сроком сами появятся в «Сегодня» в нужный день."],
    [h3, "Найдите что угодно: Ctrl+F или «/»", "Быстрый поиск ищет по задачам, проектам, областям и тегам. Можно просто начать печатать."],
    [h3, "Посмотрите все сочетания клавиш — «?»", ""],
  ];
  for (const [h, title, notes] of tour) createTodo({ title, notes, projectId: meet.id, headingId: h.id });

  const personal = createArea("Личное"); personal.tags = [home.id];
  const job = createArea("Работа"); job.tags = [work.id];
  const reno = createProject({ title: "Ремонт ванной", areaId: personal.id, deadline: addDays(t, 30), notes: "Бюджет — до 250 000 ₽" });
  createTodo({ title: "Выбрать плитку", projectId: reno.id, tags: [home.id], when: addDays(t, 2) });
  createTodo({ title: "Позвонить сантехнику", projectId: reno.id, tags: [calls.id], when: t });
  createTodo({ title: "Купить смеситель", projectId: reno.id, checklist: [{ id: uid(), title: "Сравнить 3 модели", done: true }, { id: uid(), title: "Проверить размеры", done: false }] });
  createTodo({ title: "Демонтаж старой плитки", projectId: reno.id, status: "completed", completedAt: Date.now() - 864e5 });
  const trip = createProject({ title: "Отпуск в горах", areaId: personal.id, when: "someday" });
  createTodo({ title: "Посмотреть билеты", projectId: trip.id });
  createTodo({ title: "Пробежка", areaId: personal.id, when: t, evening: true, repeat: { freq: "week", interval: 1, days: [1, 3, 5], mode: "fixed", anchor: t } });
  createTodo({ title: "Выучить 20 испанских слов", areaId: personal.id, when: "someday" });

  const q = createProject({ title: "Квартальный отчёт", areaId: job.id, deadline: addDays(t, 5), tags: [important.id] });
  createTodo({ title: "Собрать цифры продаж", projectId: q.id, when: t, tags: [work.id] });
  createTodo({ title: "Подготовить слайды", projectId: q.id, when: addDays(t, 1) });
  createTodo({ title: "Отправить черновик руководителю", projectId: q.id, deadline: addDays(t, 3), tags: [important.id] });
  createTodo({ title: "Ответить на письма", areaId: job.id, when: t, repeat: { freq: "day", interval: 1, mode: "after", anchor: t } });
  createTodo({ title: "Планёрка с командой", areaId: job.id, when: addDays(t, 3), reminder: "10:00" });

  createTodo({ title: "Купить продукты", inbox: true, checklist: ["Молоко", "Хлеб", "Яблоки"].map(x => ({ id: uid(), title: x, done: false })) });
  createTodo({ title: "Записаться к стоматологу", inbox: true, tags: [calls.id] });
  createTodo({ title: "Идея: подкаст про привычки", inbox: true, notes: "Формат — 15 минут, раз в неделю." });
  createTodo({ title: "Оплатить интернет", when: addDays(t, 6), tags: [home.id] });

  const out = db;
  db = prev;
  return out;
}
