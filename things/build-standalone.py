#!/usr/bin/env python3
"""Собирает «Дела» в один автономный HTML-файл (dela.html), который открывается двойным щелчком, без сервера.

Запуск: python3 things/build-standalone.py
"""
import base64, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent
ORDER = ["dates", "icons", "store", "pickers", "app"]  # зависимости раньше зависимых

def bundle_module(name, src):
    exports = []
    def strip_export(m):
        exports.append(m.group(2))
        return m.group(1)
    src = re.sub(r"^export\s+((?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*))", strip_export, src, flags=re.M)
    def imp(m):
        what, mod = m.group(1).strip(), m.group(2)
        if what.startswith("* as "):
            return f"const {what[5:].strip()} = __m.{mod};"
        return f"const {what} = __m.{mod};"
    src = re.sub(r'^import\s+(.+?)\s+from\s+"\./(\w+)\.js";', imp, src, flags=re.M)
    if re.search(r"^\s*(import|export)\b", src, flags=re.M):
        raise SystemExit(f"{name}.js: неподдерживаемый import/export")
    getters = ", ".join(f"get {e}() {{ return {e}; }}" for e in exports)
    return f"__m.{name} = (() => {{\n{src}\nreturn {{ {getters} }};\n}})();\n"

js = "const __m = {};\n" + "".join(bundle_module(n, (ROOT / "js" / f"{n}.js").read_text("utf-8")) for n in ORDER)
css = (ROOT / "styles.css").read_text("utf-8")
icon = "data:image/png;base64," + base64.b64encode((ROOT / "icon-192.png").read_bytes()).decode()
touch = "data:image/png;base64," + base64.b64encode((ROOT / "apple-touch-icon.png").read_bytes()).decode()

html = (ROOT / "index.html").read_text("utf-8")
html = html.replace('<link rel="icon" href="icon-192.png">', f'<link rel="icon" href="{icon}">')
html = html.replace('<link rel="apple-touch-icon" href="apple-touch-icon.png">', f'<link rel="apple-touch-icon" href="{touch}">')
html = html.replace('<link rel="manifest" href="manifest.json">\n', "")
html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{css}</style>")
js = js.replace("</script", "<\\/script")
html = html.replace('<script type="module" src="js/app.js"></script>', f"<script>\n\"use strict\";\n{js}</script>")
for asset in ("icon-192.png", "styles.css", "js/app.js", "manifest.json"):
    if f'"{asset}"' in html.split("<script>")[0]:
        raise SystemExit(f"остался внешний файл: {asset}")
(ROOT / "dela.html").write_text(html, "utf-8")
print(f"Готово: {ROOT / 'dela.html'} ({len(html) // 1024} КБ)")
