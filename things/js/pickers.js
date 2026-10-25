// Popovers: generic menu, When / Deadline / Tags / Move / Repeat / Reminder pickers.
import { db, T, byIndex, isOpenProject, createTag, commit } from "./store.js";
import { todayStr, toDate, ymd, isDate, fullDate, parseNatural, MONTHS, WD_SHORT, repeatLabel, WEEKDAYS, cap } from "./dates.js";
import { ic, pie } from "./icons.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let current = null;
export const popoverOpen = () => !!current;
export function closePopover() {
  if (!current) return;
  const c = current; current = null;
  c.layer.remove();
  c.onClose && c.onClose();
}

export function openPopover(anchor, build, { cls = "", onClose, width } = {}) {
  closePopover();
  const layer = document.createElement("div");
  layer.className = "pop-layer";
  layer.innerHTML = `<div class="pop ${cls}" role="dialog"></div>`;
  const pop = layer.firstChild;
  if (width) pop.style.width = width + "px";
  current = { layer, onClose };
  const close = () => { if (current && current.layer === layer) closePopover(); };
  build(pop, close);
  document.body.append(layer);
  layer.addEventListener("pointerdown", e => { if (e.target === layer) { e.preventDefault(); close(); } });
  place(pop, anchor);
  const first = pop.querySelector("[autofocus]") || pop.querySelector("input");
  if (first && !matchMedia("(max-width: 760px)").matches) first.focus();
  return close;
}

function place(pop, anchor) {
  if (matchMedia("(max-width: 760px)").matches) { pop.classList.add("sheet"); return; }
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 130, right: innerWidth / 2 + 130, top: 80, bottom: 80 };
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = Math.min(Math.max(8, r.left + (r.right - r.left) / 2 - w / 2), innerWidth - w - 8);
  let y = r.bottom + 6;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  pop.style.left = x + "px";
  pop.style.top = y + "px";
}

// Keyboard navigation for any popover with .opt rows.
function arrowNav(pop, input) {
  const opts = () => [...pop.querySelectorAll(".opt:not([hidden])")];
  const key = e => {
    const list = opts(); if (!list.length) return;
    let i = list.findIndex(o => o.classList.contains("hot"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      i = e.key === "ArrowDown" ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      list.forEach(o => o.classList.remove("hot"));
      list[i].classList.add("hot"); list[i].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && i >= 0) { e.preventDefault(); list[i].click(); }
  };
  (input || pop).addEventListener("keydown", key);
  if (!input) { pop.tabIndex = -1; setTimeout(() => pop.focus(), 0); }
}

export function menu(anchor, items) {
  openPopover(anchor, (pop, close) => {
    pop.innerHTML = items.map((it, i) => it.sep ? `<div class="sep"></div>` :
      `<button class="opt ${it.danger ? "danger" : ""}" data-i="${i}" ${it.disabled ? "disabled" : ""}>${it.icon ? ic(it.icon) : '<span class="ic"></span>'}<span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ""}</button>`).join("");
    pop.addEventListener("click", e => {
      const b = e.target.closest("[data-i]"); if (!b) return;
      close(); items[+b.dataset.i].action();
    });
    arrowNav(pop);
  }, { cls: "menu" });
}

/* ---------- calendar ---------- */
export function calendar(el, { selected, onPick, min }) {
  let cur = toDate(isDate(selected) ? selected : todayStr());
  cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
  const draw = () => {
    const t = todayStr(), y = cur.getFullYear(), m = cur.getMonth();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < offset; i++) cells += `<span></span>`;
    for (let d = 1; d <= days; d++) {
      const s = ymd(new Date(y, m, d));
      const dis = min && s < min;
      cells += `<button class="day ${s === t ? "is-today" : ""} ${s === selected ? "is-sel" : ""}" data-d="${s}" ${dis ? "disabled" : ""}>${s === t ? ic("star") : d}</button>`;
    }
    el.innerHTML = `<div class="cal-head"><button class="icon-btn" data-nav="-1">${ic("back")}</button><b>${MONTHS[m]} ${y}</b><button class="icon-btn flip" data-nav="1">${ic("back")}</button></div>
      <div class="cal-grid">${[1, 2, 3, 4, 5, 6, 0].map(i => `<i>${WD_SHORT[i]}</i>`).join("")}${cells}</div>`;
  };
  el.classList.add("cal");
  el.addEventListener("click", e => {
    const n = e.target.closest("[data-nav]");
    if (n) { cur = new Date(cur.getFullYear(), cur.getMonth() + +n.dataset.nav, 1); draw(); return; }
    const d = e.target.closest("[data-d]");
    if (d) onPick(d.dataset.d);
  });
  draw();
}

/* ---------- When ---------- */
export function whenPicker(anchor, { when, evening, reminder, allowReminder = true, title = "Когда?", onPick, onReminder }) {
  openPopover(anchor, (pop, close) => {
    const t = T();
    pop.innerHTML = `<div class="pop-title">${title}</div>
      <input class="pop-input" placeholder="Например: завтра, пт, 12.11, через 3 дня" autocomplete="off" autofocus>
      <button class="opt nl-preview" hidden></button>
      <button class="opt ${when === t && !evening ? "on" : ""}" data-w="today">${ic("star", "c-today")}<span>Сегодня</span></button>
      <button class="opt ${when === t && evening ? "on" : ""}" data-w="evening">${ic("moon", "c-evening")}<span>Этим вечером</span></button>
      <div class="cal-box"></div>
      <button class="opt ${when === "someday" ? "on" : ""}" data-w="someday">${ic("box", "c-someday")}<span>Когда-нибудь</span></button>
      ${allowReminder && onReminder ? `<div class="sep"></div><button class="opt" data-w="reminder">${ic("bell")}<span>${reminder ? "Напоминание: " + reminder : "Добавить напоминание"}</span></button>` : ""}
      ${when ? `<button class="opt muted" data-w="clear">${ic("close")}<span>Очистить</span></button>` : ""}`;
    const input = pop.querySelector(".pop-input"), prev = pop.querySelector(".nl-preview");
    let parsed = null;
    input.addEventListener("input", () => {
      parsed = parseNatural(input.value);
      prev.hidden = !parsed;
      if (parsed) {
        prev.classList.add("hot");
        prev.innerHTML = `${ic(parsed.when === "someday" ? "box" : parsed.evening ? "moon" : "calendar")}<span>${parsed.when === "someday" ? "Когда-нибудь" : parsed.evening ? "Этим вечером" : fullDate(parsed.when)}</span>`;
      }
    });
    input.addEventListener("keydown", e => { if (e.key === "Enter" && parsed) { e.preventDefault(); close(); onPick(parsed.when, !!parsed.evening); } });
    prev.addEventListener("click", () => { if (parsed) { close(); onPick(parsed.when, !!parsed.evening); } });
    calendar(pop.querySelector(".cal-box"), { selected: isDate(when) ? when : null, min: t, onPick: d => { close(); onPick(d, false); } });
    pop.addEventListener("click", e => {
      const b = e.target.closest("[data-w]"); if (!b) return;
      const w = b.dataset.w;
      if (w === "reminder") { reminderPicker(anchor, { time: reminder, onPick: onReminder }); return; }
      close();
      if (w === "today") onPick(t, false);
      if (w === "evening") onPick(t, true);
      if (w === "someday") onPick("someday", false);
      if (w === "clear") onPick(null, false);
    });
  }, { cls: "when", width: 280 });
}

export function deadlinePicker(anchor, { deadline, onPick }) {
  openPopover(anchor, (pop, close) => {
    pop.innerHTML = `<div class="pop-title">Крайний срок</div>
      <input class="pop-input" placeholder="Например: пятница, 30.11" autocomplete="off" autofocus>
      <button class="opt nl-preview" hidden></button>
      <div class="cal-box"></div>
      ${deadline ? `<button class="opt muted" data-clear>${ic("close")}<span>Убрать срок</span></button>` : ""}`;
    const input = pop.querySelector(".pop-input"), prev = pop.querySelector(".nl-preview");
    let parsed = null;
    input.addEventListener("input", () => {
      parsed = parseNatural(input.value);
      if (parsed && !isDate(parsed.when)) parsed = null;
      prev.hidden = !parsed;
      if (parsed) { prev.classList.add("hot"); prev.innerHTML = `${ic("flag", "c-deadline")}<span>${fullDate(parsed.when)}</span>`; }
    });
    const pick = d => { close(); onPick(d); };
    input.addEventListener("keydown", e => { if (e.key === "Enter" && parsed) { e.preventDefault(); pick(parsed.when); } });
    prev.addEventListener("click", () => parsed && pick(parsed.when));
    calendar(pop.querySelector(".cal-box"), { selected: deadline, onPick: pick });
    pop.querySelector("[data-clear]")?.addEventListener("click", () => pick(null));
  }, { cls: "when", width: 280 });
}

export function reminderPicker(anchor, { time, onPick }) {
  openPopover(anchor, (pop, close) => {
    const quick = ["09:00", "12:00", "15:00", "18:00", "21:00"];
    pop.innerHTML = `<div class="pop-title">Напоминание</div>
      <div class="time-row"><input type="time" class="pop-input" value="${esc(time || "09:00")}" autofocus><button class="btn primary" data-ok>Готово</button></div>
      <div class="chips">${quick.map(q => `<button class="chip" data-q="${q}">${q}</button>`).join("")}</div>
      ${time ? `<button class="opt muted" data-clear>${ic("close")}<span>Убрать напоминание</span></button>` : ""}`;
    const input = pop.querySelector("input");
    const done = v => { close(); onPick(v); };
    pop.querySelector("[data-ok]").addEventListener("click", () => done(input.value || null));
    input.addEventListener("keydown", e => { if (e.key === "Enter") done(input.value || null); });
    pop.addEventListener("click", e => { const q = e.target.closest("[data-q]"); if (q) done(q.dataset.q); });
    pop.querySelector("[data-clear]")?.addEventListener("click", () => done(null));
  }, { width: 260 });
}

/* ---------- Tags ---------- */
export function tagPicker(anchor, { selected, onChange }) {
  const sel = new Set(selected);
  openPopover(anchor, (pop, close) => {
    pop.innerHTML = `<div class="pop-title">Теги</div><input class="pop-input" placeholder="Найти или создать тег" autocomplete="off" autofocus><div class="opt-list"></div>`;
    const input = pop.querySelector("input"), list = pop.querySelector(".opt-list");
    const depth = t => { let d = 0, p = t; while (p.parentId && d < 5) { p = db.tags.find(x => x.id === p.parentId) || {}; d++; } return d; };
    const ordered = () => {
      const out = [];
      const walk = (pid, d) => db.tags.filter(t => (t.parentId || null) === pid).sort(byIndex).forEach(t => { out.push(t); walk(t.id, d + 1); });
      walk(null, 0);
      return out;
    };
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const tags = ordered().filter(t => !q || t.title.toLowerCase().includes(q));
      const exact = db.tags.some(t => t.title.toLowerCase() === q);
      list.innerHTML = tags.map(t => `<button class="opt ${sel.has(t.id) ? "on" : ""}" data-id="${t.id}" style="padding-left:${10 + (q ? 0 : depth(t)) * 14}px">${ic(sel.has(t.id) ? "check" : "tag")}<span>${esc(t.title)}</span></button>`).join("")
        + (q && !exact ? `<button class="opt" data-new>${ic("plus")}<span>Создать тег «${esc(input.value.trim())}»</span></button>` : "")
        + (!tags.length && !q ? `<div class="empty-mini">Тегов пока нет — введите название</div>` : "");
      const first = list.querySelector(".opt"); if (first && q) first.classList.add("hot");
    };
    input.addEventListener("input", draw);
    list.addEventListener("click", e => {
      const b = e.target.closest(".opt"); if (!b) return;
      if (b.dataset.new !== undefined) {
        let tag;
        commit(() => { tag = createTag(input.value.trim()); });
        sel.add(tag.id); input.value = "";
      } else { sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id); }
      onChange([...sel]);
      draw(); input.focus();
    });
    arrowNav(pop, input);
    draw();
  }, { width: 270 });
}

/* ---------- Move ---------- */
export function movePicker(anchor, { onPick, includeInbox = true, projectsOnly = false, title = "Переместить" }) {
  openPopover(anchor, (pop, close) => {
    pop.innerHTML = `<div class="pop-title">${title}</div><input class="pop-input" placeholder="Найти проект или область" autocomplete="off" autofocus><div class="opt-list"></div>`;
    const input = pop.querySelector("input"), list = pop.querySelector(".opt-list");
    const entries = () => {
      const out = [];
      if (includeInbox && !projectsOnly) out.push({ label: "Входящие", icon: ic("inbox", "c-inbox"), dest: { kind: "inbox" } });
      if (projectsOnly) out.push({ label: "Без области", icon: ic("close"), dest: { kind: "none" } });
      const projectEntries = (p, d) => {
        out.push({ label: p.title || "Без названия", icon: pie(0, "c-project"), dest: { kind: "project", id: p.id }, depth: d });
        if (!projectsOnly) db.headings.filter(h => h.projectId === p.id && !h.archived).sort(byIndex)
          .forEach(h => out.push({ label: h.title || "Без названия", icon: ic("heading"), dest: { kind: "project", id: p.id, headingId: h.id }, depth: d + 1 }));
      };
      if (!projectsOnly) db.projects.filter(p => !p.areaId && isOpenProject(p)).sort(byIndex).forEach(p => projectEntries(p, 0));
      for (const a of [...db.areas].sort(byIndex)) {
        out.push({ label: a.title || "Без названия", icon: ic("area", "c-area"), dest: { kind: "area", id: a.id }, depth: 0 });
        if (!projectsOnly) db.projects.filter(p => p.areaId === a.id && isOpenProject(p)).sort(byIndex).forEach(p => projectEntries(p, 1));
      }
      return out;
    };
    const all = entries();
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const shown = all.filter(e => !q || e.label.toLowerCase().includes(q));
      list.innerHTML = shown.map(e => `<button class="opt" data-i="${all.indexOf(e)}" style="padding-left:${10 + (q ? 0 : (e.depth || 0)) * 16}px">${e.icon}<span>${esc(e.label)}</span></button>`).join("") || `<div class="empty-mini">Ничего не найдено</div>`;
      if (q) list.querySelector(".opt")?.classList.add("hot");
    };
    input.addEventListener("input", draw);
    list.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) { close(); onPick(all[+b.dataset.i].dest); } });
    arrowNav(pop, input);
    draw();
  }, { width: 290 });
}

/* ---------- Repeat ---------- */
export function repeatPicker(anchor, { rule, when, onPick }) {
  openPopover(anchor, (pop, close) => {
    const r = Object.assign({ freq: "week", interval: 1, days: [], mode: "fixed" }, rule || {});
    if (!rule && isDate(when)) r.days = [toDate(when).getDay()];
    const draw = () => {
      pop.innerHTML = `<div class="pop-title">Повторять</div>
        <div class="seg">${[["fixed", "По расписанию"], ["after", "После выполнения"]].map(([k, l]) => `<button class="${r.mode === k ? "on" : ""}" data-mode="${k}">${l}</button>`).join("")}</div>
        <div class="rep-row">Каждые <input type="number" min="1" max="99" value="${r.interval}" class="pop-input num">
          <select class="pop-input">${[["day", "дн."], ["week", "нед."], ["month", "мес."], ["year", "г."]].map(([k, l]) => `<option value="${k}" ${r.freq === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        ${r.freq === "week" && r.mode === "fixed" ? `<div class="wd-row">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="wd ${r.days.includes(d) ? "on" : ""}" data-wd="${d}" title="${cap(WEEKDAYS[d])}">${WD_SHORT[d]}</button>`).join("")}</div>` : ""}
        <div class="rep-preview">${esc(repeatLabel(r))}</div>
        <div class="pop-actions">${rule ? `<button class="btn" data-off>Не повторять</button>` : ""}<button class="btn primary" data-ok>Готово</button></div>`;
    };
    draw();
    pop.addEventListener("click", e => {
      const m = e.target.closest("[data-mode]"); if (m) { r.mode = m.dataset.mode; draw(); return; }
      const w = e.target.closest("[data-wd]");
      if (w) { const d = +w.dataset.wd; r.days = r.days.includes(d) ? r.days.filter(x => x !== d) : [...r.days, d]; draw(); return; }
      if (e.target.closest("[data-off]")) { close(); onPick(null); return; }
      if (e.target.closest("[data-ok]")) {
        close();
        onPick({ freq: r.freq, interval: Math.max(1, +r.interval || 1), days: r.freq === "week" && r.mode === "fixed" ? r.days : [], mode: r.mode, anchor: isDate(when) ? when : T() });
      }
    });
    pop.addEventListener("change", e => {
      if (e.target.matches("select")) { r.freq = e.target.value; draw(); }
      if (e.target.matches(".num")) { r.interval = Math.max(1, +e.target.value || 1); draw(); }
    });
  }, { width: 300 });
}

