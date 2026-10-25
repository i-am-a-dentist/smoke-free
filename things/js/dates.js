// Local-date helpers. Dates are stored as "YYYY-MM-DD" strings in the user's time zone.
export const pad = n => String(n).padStart(2, "0");
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const todayStr = () => ymd(new Date());
export const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addDays(s, n) { const d = toDate(s); d.setDate(d.getDate() + n); return ymd(d); }
export function addMonths(s, n, dayOfMonth) {
  const d = toDate(s), day = dayOfMonth || d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return ymd(t);
}
export const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / 864e5);
export const weekday = s => toDate(s).getDay(); // 0 = Sunday
export const mondayOf = s => addDays(s, -((weekday(s) + 6) % 7));

export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const WD_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b > 1 && b < 5) return few;
  return many;
}

// "Сегодня", "Завтра", "Пятница", "3 ноя", "3 ноя 2027"
export function human(s, { long = false } = {}) {
  const d = diffDays(s, todayStr()), dt = toDate(s);
  if (d === 0) return "Сегодня";
  if (d === 1) return "Завтра";
  if (d === -1) return "Вчера";
  if (d > 1 && d < 7) return cap(WEEKDAYS[dt.getDay()]);
  const base = `${dt.getDate()} ${long ? MONTHS_GEN[dt.getMonth()] : MONTHS_SHORT[dt.getMonth()]}`;
  return dt.getFullYear() === new Date().getFullYear() ? base : `${base} ${dt.getFullYear()}`;
}
export function fullDate(s) {
  const dt = toDate(s);
  return `${cap(WEEKDAYS[dt.getDay()])}, ${dt.getDate()} ${MONTHS_GEN[dt.getMonth()]} ${dt.getFullYear()}`;
}
export function deadlineLabel(s) {
  const d = diffDays(s, todayStr());
  if (d < 0) return `просрочено на ${-d} ${plural(-d, "день", "дня", "дней")}`;
  if (d === 0) return "срок сегодня";
  return `осталось ${d} ${plural(d, "день", "дня", "дней")}`;
}

const WD_WORDS = [
  ["вс", "воск", "воскр", "воскресенье", "sun", "sunday"],
  ["пн", "пон", "понедельник", "mon", "monday"],
  ["вт", "вто", "вторник", "tue", "tues", "tuesday"],
  ["ср", "сре", "среда", "среду", "wed", "wednesday"],
  ["чт", "чет", "четверг", "thu", "thur", "thursday"],
  ["пт", "пят", "пятница", "пятницу", "fri", "friday"],
  ["сб", "суб", "суббота", "субботу", "sat", "saturday"],
];
const MONTH_RE = [/^(янв|jan)/, /^(фев|feb)/, /^(мар|mar)/, /^(апр|apr)/, /^(ма[йя]|may)/, /^(июн|jun)/,
  /^(июл|jul)/, /^(авг|aug)/, /^(сен|sep)/, /^(окт|oct)/, /^(ноя|nov)/, /^(дек|dec)/];
const monthOf = w => MONTH_RE.findIndex(r => r.test(w));

function makeDate(y, m, d, t) {
  const yearGiven = y != null;
  if (y != null && y < 100) y += 2000;
  const now = new Date();
  const dt = new Date(yearGiven ? y : now.getFullYear(), m, d);
  if (dt.getMonth() !== m || dt.getDate() !== d) return null;
  let s = ymd(dt);
  if (!yearGiven && s < t) s = ymd(new Date(dt.getFullYear() + 1, m, d));
  return s;
}

// Natural-language date entry (Russian and English). Returns { when, evening? } or null.
export function parseNatural(input) {
  let s = input.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  if (!s) return null;
  const t = todayStr();
  if (/^(сегодня|сег|today|tod)$/.test(s)) return { when: t };
  if (/^(вечер|вечером|сегодня вечером|этим вечером|tonight|evening|this evening|eve)$/.test(s)) return { when: t, evening: true };
  if (/^(завтра|зав|tomorrow|tom|tmr)$/.test(s)) return { when: addDays(t, 1) };
  if (/^послезавтра$/.test(s)) return { when: addDays(t, 2) };
  if (/^(когда-?нибудь|когда нибудь|потом|someday|some day)$/.test(s)) return { when: "someday" };

  let m = s.match(/^(?:через|in|\+)\s*(\d+)?\s*([a-zа-я]*)$/);
  if (m && (m[1] || m[2])) {
    const n = m[1] ? +m[1] : 1, u = m[2];
    if (/^(д|дн|дня|дней|день|d|days?)?$/.test(u)) return { when: addDays(t, n) };
    if (/^(н|нед|недел[ьюяи]|недель|w|wk|weeks?)$/.test(u)) return { when: addDays(t, 7 * n) };
    if (/^(м|мес|месяц|месяца|месяцев|mo|months?)$/.test(u)) return { when: addMonths(t, n) };
    if (/^(г|год|года|лет|y|yr|years?)$/.test(u)) return { when: addMonths(t, 12 * n) };
  }
  if (/^(на )?(следующей|след\.?|следующая) недел[еяю]$|^next week$/.test(s)) {
    return { when: addDays(t, ((1 - weekday(t) + 7) % 7) || 7) };
  }
  if (/^(в )?(следующем|след\.?) месяце$|^next month$/.test(s)) {
    const d = toDate(t); return { when: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
  }
  if (/^(на )?выходн(ых|ые)$|^(this )?weekend$/.test(s)) {
    return { when: addDays(t, (6 - weekday(t) + 7) % 7) };
  }
  const w = s.replace(/^(во|в|next|this|on|след\S*|следующ\S*|ближайш\S*)\s+/, "").replace(/\.$/, "");
  const wd = WD_WORDS.findIndex(list => list.includes(w));
  if (wd >= 0) return { when: addDays(t, ((wd - weekday(t) + 7) % 7) || 7) };

  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { const r = makeDate(+m[1], +m[2] - 1, +m[3], t); return r && { when: r }; }
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/))) { const r = makeDate(m[3] ? +m[3] : null, +m[2] - 1, +m[1], t); return r && { when: r }; }
  if ((m = s.match(/^(\d{1,2})\s+([a-zа-я]+)\.?(?:\s+(\d{4}))?$/)) && monthOf(m[2]) >= 0) {
    const r = makeDate(m[3] ? +m[3] : null, monthOf(m[2]), +m[1], t); return r && { when: r };
  }
  if ((m = s.match(/^([a-zа-я]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)) && monthOf(m[1]) >= 0) {
    const r = makeDate(m[3] ? +m[3] : null, monthOf(m[1]), +m[2], t); return r && { when: r };
  }
  if ((m = s.match(/^(\d{1,2})(?:-?е|-?го|th|st|nd|rd)?$/))) {
    const day = +m[1], d = toDate(t);
    for (let i = 0; i < 13; i++) {
      const r = makeDate(d.getFullYear() + Math.floor((d.getMonth() + i) / 12), (d.getMonth() + i) % 12, day, "0000");
      if (r && r >= t) return { when: r };
    }
  }
  return null;
}

// Repeat rules: { freq: "day"|"week"|"month"|"year", interval, days?: [0..6], mode: "fixed"|"after", anchor }
export function nextOccurrence(rule, from) {
  const n = Math.max(1, rule.interval || 1), anchor = rule.anchor || from;
  switch (rule.freq) {
    case "day": return addDays(from, n);
    case "week":
      if (rule.days && rule.days.length) {
        for (let i = 1; i <= 7 * n + 7; i++) {
          const d = addDays(from, i);
          if (!rule.days.includes(weekday(d))) continue;
          const wk = Math.round(diffDays(mondayOf(d), mondayOf(anchor)) / 7);
          if (((wk % n) + n) % n === 0) return d;
        }
      }
      return addDays(from, 7 * n);
    case "month": return addMonths(from, n, toDate(anchor).getDate());
    case "year": return addMonths(from, 12 * n, toDate(anchor).getDate());
  }
  return addDays(from, 1);
}

export function repeatLabel(r) {
  if (!r) return "";
  const n = r.interval || 1;
  const units = {
    day: [`Каждый день`, `Каждые ${n} ${plural(n, "день", "дня", "дней")}`],
    week: [`Каждую неделю`, `Каждые ${n} ${plural(n, "неделю", "недели", "недель")}`],
    month: [`Каждый месяц`, `Каждые ${n} ${plural(n, "месяц", "месяца", "месяцев")}`],
    year: [`Каждый год`, `Каждые ${n} ${plural(n, "год", "года", "лет")}`],
  }[r.freq];
  let s = n === 1 ? units[0] : units[1];
  if (r.freq === "week" && r.days && r.days.length) s += ": " + [1, 2, 3, 4, 5, 6, 0].filter(d => r.days.includes(d)).map(d => WD_SHORT[d]).join(", ");
  if (r.mode === "after") s += " после выполнения";
  return s;
}
