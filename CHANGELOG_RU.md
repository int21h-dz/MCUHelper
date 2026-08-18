# Журнал изменений MCU-NR Helper

Формат: группировка по типу изменения с обоснованием пользы для проекта.

---

## [Unreleased] — 2026-08-14

### Тесты

- **iaeaNds + meshPreview (2026-08-14)** — unit-тесты с моком fetch/кэша в temp (без живой сети и без `~/.mcuhelper`); `resetIaeaNdsStateForTest` — inject `fetchImpl` + temp-кэш; meshPreview: остальные типы тел, bbox, сечения, nearby. **888** pass (было 869). `iaeaNds` ~43%→**95.6%** lines / **96%** funcs; `meshPreview` ~69%→**99.4%** lines / **100%** funcs. Global **86.51/78.60/82.22**. Полы: global 86/78/82, geometry 95/81/77, lsp 80/73/81. `coverage:check` зелёный. *Польза:* дыры закрыты честно, гейт не откатится.

### Исправления

- **`ORCT`/`OFLU` ложный `reg-obj-unknown`** — известные объекты собираются со **всех** хвостов зон (не схлопывая CELL/LCELL по имени) и из картограммы NET `O****`. Рег.зоны — аналогично из `P****`. *Польза:* `ORCT 2` больше не ругается, когда объект 2 задан в O-картограмме или в раннем прототипе с тем же именем зоны.

### Документация

- **README по diff (2026-08-14)** — пользовательский README приведён к текущему продукту: конструктор материалов (PNNL + пользовательский банк), генератор тел, вода/пар, MATR CodeLens, команды/версия VSIX 0.12.0, **888** тестов и честные пороги покрытия со ссылкой на [`docs/DEV.md`](docs/DEV.md). *Польза:* релизные заметки совпадают с тем, что реально в расширении, а не с состоянием на ~660 тестов.
- **Документация покрытия (2026-08-14)** — [`structure.md`](structure.md), [`docs/DEV.md`](docs/DEV.md), [`CHANGELOG_RU.md`](CHANGELOG_RU.md): снимок 888 тестов, закрытые дыры `iaeaNds`/`meshPreview`, `resetIaeaNdsStateForTest`, актуальные полы [`scripts/coverage-floors.json`](scripts/coverage-floors.json). Убраны остатки «869» / «iaeaNds ~43%» / «meshPreview ~69%». *Польза:* один источник правды для агентов и разработчиков после закрытия дыр.
- **Честный гейт покрытия (2026-08-14)** — сняты фальшивые пороги 95/80/88/95 из `package.json`. [`.c8rc.json`](.c8rc.json) больше не выкидывает модули с тестами (`contentDetect`, `expandNaturalIsotope`, `iaeaNds`); VS Code host (`*Panel`, `*Command`, `*Insert`, `extension.js`, `sidebarView`, `runPanelView`, `codeActions`, `mcuStepRunner`, `includePreview.js`, `server.js`, `warmup.js`) исключён явно как вне node:test. Новый локальный гейт: `coverage:check` = [`scripts/check-coverage.js`](scripts/check-coverage.js) + полы в [`scripts/coverage-floors.json`](scripts/coverage-floors.json). Снимок: global 83.14 / 77.62 / 78.78; полы global 83/77/78, language 94/79/97, schema 99/91/70, geometry 80/74/74, lsp 74/72/69, extension 63/76/57. CI / `.github` нет. *Польза:* гейт зелёный и честный; просадка language/schema/lsp не спрячется за UI.
- **`extension/README.md` (2026-08-14)** — убран устаревший блок «~660 тестов» и порог c8 ≥95%; ссылка на [`docs/DEV.md`](docs/DEV.md) как на источник снимка. *Польза:* нет противоречия с корневым README и DEV после честного фикса покрытия.
- **[`structure.md`](structure.md) (2026-08-14)** — таблица команд/полов, явный список exclude/include c8, дата снимка. *Польза:* агентам не нужно заново выводить политику покрытия из конфигов.
