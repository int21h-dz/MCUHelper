# McuHelper — MCU-NR VS Code Language Server

## Назначение
Расширение VS Code + LSP для исходных данных программы **MCU-NR** (модули PIN, NCG/NCGSIM, источники, регистрация, выгорание).

**Пользовательская документация:** [README.md](README.md) — установка, быстрый старт, возможности, команды, настройки.

**Политика README:** не описывать в README пользовательские сценарии **2D-срезов геометрии** (`MCU-NR: Сечения геометрии`) и **валидации через солвер MCU-NR** (`MCU-NR: Validate (INPUT)`, `mcuhelper.mcuNrPath`, `mcuhelper.variantName`, `mcuhelper.enableSolverValidation`). Эти возможности экспериментальны и документируются здесь, в `structure.md` (см. разделы «Команды extension», LSP custom requests).

## Структура репозитория

```
McuHelper/
├── docs/
│   ├── MCU-NR_Reference.md           # краткая справка + индекс строк TXT
│   └── MCU-NR_UserGuide_220519.txt   # полный текст PDF для grep/Read агентами
├── extension/                 # VS Code extension
│   ├── src/extension.ts       # активация, LSP client, Webview sidebar, команды
│   ├── src/sidebarView.ts     # WebviewView: каталог + 7 навигационных панелей
│   ├── src/navData.ts         # buildNavTree — деревья из LSP getIndex (Объекты: клики по зонам, objNum при дубликатах имён)
│   ├── src/catalogBridge.ts   # buildCatalogPayload (mcu-schema vendor)
│   ├── src/templateInsert.ts  # вставка шаблонов, DocumentDropEditProvider
│   ├── media/sidebar/         # sidebar.css, sidebarIcons.js, sidebarShell.js (design system)
│   └── src/geometryPanel.ts   # WebView: срезы геометрии (без 3D)
├── packages/
│   ├── mcu-schema/            # карточки, типы тел, hover-тексты, catalog.ts (шаблоны модулей)
│   ├── mcu-language/          # lexer, parser, semantic, document index, includeResolve
│   ├── mcu-geometry/          # Geometry IR, аналитика зон, срезы, queryPoint
│   │   └── src/
│   │       ├── zoneExpression.ts  # парсер булевых выражений зон
│   │       ├── pointInBody.ts     # pointInBody для RPP/RCZ/SPH/HEX/…
│   │       ├── query.ts           # queryPoint, buildSliceGrid (+ NET/LATT)
│   │       ├── gltl.ts            # парсинг PARM GLTL, сдвиги LCELL
│   │       ├── netQuery.ts        # индексация ячеек NET, pitch SBOX/RPP
│   │       ├── buildScene.ts      # GeometryScene + materials
│   │       └── primitives.ts      # buildPrimitive, bbox
│   └── mcu-lsp/               # language server (diagnostics, completion, hover)
│       └── src/
│           ├── server.ts          # тонкая обёртка connection.on*
│           └── serverHandlers.ts  # тестируемая логика custom requests / symbols / diagnostics
├── test/
│   ├── fixtures/              # примеры из UserGuide (*.mcu)
│   └── helpers/               # loadFixture, analyzeFixture, createTextDocument
├── structure.md
└── MCU-NR_UserGuide_220519.pdf  # полное руководство (147 стр.)
```

## Документация MCU-NR

| Файл | Назначение |
|------|------------|
| `docs/MCU-NR_Reference.md` | **Сжатая справка**: синтаксис, карты, тела, зоны; таблица **номеров строк** в TXT для углубления. **Расширяй и дополняй указатель, если в нем отсутствуют ссылки на /MCU-NR_UserGuide_220519.txt**|
| `docs/MCU-NR_UserGuide_220519.txt` | **Полный текст UserGuide** (~7400 строк): `Grep`/`Read offset+limit`; маркеры `===== PAGE N =====`; индекс в конце файла. |
| `MCU-NR_UserGuide_220519.pdf` | Оригинал (вёрстка, рисунки). |

**Для агентов:** `structure.md` → `MCU-NR_Reference.md` (краткая выжимка `MCU-NR_UserGuide_220519.txt` с ссылками на нужные строки) → `MCU-NR_UserGuide_220519.txt` (по номеру строки из справки, если ссылки отсутствуют `MCU-NR_Reference.md` следует дополнить) → `test/fixtures/*.mcu`. Схемы карт: `packages/mcu-schema/src/index.ts`.

## Пакеты

| Пакет | Ответственность |
|-------|-----------------|
| `@mcuhelper/mcu-schema` | Схемы PIN/GEO карт, BODY_TYPES, FRAGMENT_ORDER |
| `@mcuhelper/mcu-language` | `parseDocument`, `analyzeSemantics`, `analyzeDocument` (кэш uri+version+hash), `buildSummaries`, `includeResolve` (`collectIncludesFromSource` — диапазоны `#include` до expand), … |
| `@mcuhelper/mcu-geometry` | `buildScene`, `queryPoint`, `buildSliceGrid`, `pointInBody`, `parseZoneExpression` |
| `@mcuhelper/mcu-lsp` | LSP server, solver bridge (INPUT + .LST) |

## LSP capabilities
- Diagnostics (табы в коде — `no-tabs`; в `**`/`C=` и после `;` допустимы, порядок фрагментов, ссылки на тела, MATR gaps, **matr-param-empty** / **matr-param-value** (`matrCardValidation.ts`), **matr-nuclide-syntax**, **matr-nuclide-extra**, **matr-nuclide-param**, **matr-nuclide-dup**, zone refs, **ENERGY**, **физические величины** ≥ 0)
- Completion (все карты `ALL_CARDS` + алиасы; **аргументы карт** — `SUMZON`→SUMB…ZONG, `CONTEN`→DENS…SPNU, `CODE`→RSTP…; markdown как в hover)
- **Signature Help** — подсказка активного параметра при вводе тел (`RCC`, `RCZ`, …), карт (`MATR`, `POWER`, `STEP`, `SUMZON`, `SPNT`, …), **строк нуклидов** (`name`, `dens`, `MODS=…`); `parameterHints.ts`, `bodyParamGroups.ts`, `cardLineParamGroups.ts`, `nuclideLineParamGroups.ts`
- **body-params-extra** — лишние токены в строке тела (`bodyParamValidation.ts`): лимит по числу полей тела; пробелы и запятые взаимозаменяемы (UserGuide §7.1, §9.1.3)
- Hover (из schema + символы документа)
- Definition, DocumentSymbol, **FoldingRange** (крупные фрагменты PIN/HEAD/… + блоки MATR), **DocumentLink** (`#include` → клик по имени файла; includes собираются из исходного текста до `expandIncludes`)
- Custom: `mcuhelper/getIndex`, `mcuhelper/getGeometry`, `mcuhelper/queryPoint`, `mcuhelper/getSlice`, `mcuhelper/validateInput`
- **Hover** (LSP): описания из UserGuide (`userGuideCards.generated.ts`) + `cardDescriptionsExtra.ts` + ручные карты; **без** заглушек «см. UserGuide»
- **extract-cards**: `npm run extract-cards --prefix packages/mcu-schema` — перегенерация карт из `docs/MCU-NR_UserGuide_220519.txt`
- `npm run build` в корне — также копирует esbuild-бандл LSP в `extension/server/server.js` (VSIX и Extension Development Host)
- **IAEA NDS** … bundled fallback (`bundledNaturalAbundance.ts`); expand **не ждёт** CSV — bundled сразу, IAEA в фоне
- **Hover нуклидов**: локальные данные (концентрация, ρ, атомная масса) — сразу; IAEA — из кэша + prefetch; **природный элемент** — кнопка «Разложить на изотопы (ICE)» в hover
- **POWER/STEP**: hover — **SVG-график** (мощность Q, сетка шагов/подшагов, ∫Q·dt), таблица POWER, **энерговыработка**, **МВт·сут/кг** при наличии VOL; `burnupLoad.ts` + `burnupLoadChart.ts`
- **EMES/EPRO**: hover на карте или строке продолжения — **SVG P(E)** (узлы энергии + вероятности), таблица; `sourceSpectrum.ts` + `sourceSpectrumChart.ts`
- **VOL**: объёмы материалов (см³) по номерам MATR → массы m=ρ·V; таблица в hover VOL/POWER/STEP, TreeView материалов; `materialVolumes.ts`
- **ENERGY/ENERG**: семантика — нижние границы ≥ 0, 0 явно; список строго по возрастанию (0, E1, …) или по убыванию (…, 0); `energyGroups.ts`
- **Физические величины**: TEMPR, MATR (T, DENS*, концентрации), VOL, POWER, STEP/DSTP, TIMP/TSEC/TMIN/THOU/TDAY/TYEA — значения ≥ 0 (константы EQU/SET тоже при подстановке); `positiveQuantities.ts`
- **EQU/SET и выражения**: неинициализированные имена в EQU/SET, параметрах тел, картах с числами; `variableRefs.ts` (`var-undef`, `expr-syntax`)
- **Подсветка**: TextMate (`syntaxes/mcunr.tmLanguage.json`) — карты, тела, зоны; **маркеры разделов** (`PIN`, `HEAD`, `FINISH`, …) — scope `markup.heading.section.*.mcunr`, жирный + фон (`editor.tokenColorCustomizations` в extension); семантические токены LSP отключены (UI freeze)

## Команды extension
- `MCU-NR: Validate (INPUT)` — опциональный запуск солвера
- `MCU-NR: Экспорт диагностик` — список Problems в Output + буфер обмена
- `MCU-NR: Визуализация геометрии` — WebView: срезы XY/XZ/YZ (растр по зонам), зум колёсиком, автообновление при правке файла; запрос зоны в точке (клик)
- **Боковая панель MCU-NR (Webview, единый стиль):** … один `getIndex` на refresh (`refreshSidebarsCoalesced`); движение курсора обновляет только **Константы** (180 ms debounce); правка документа — все панели (350 ms)
- Зоны: `/reg:mat[/obj]`, `/:mat`, `:mat`, `#M=… Z=… O=…` — **неуказанные reg/obj → 1**; `/reg[/obj]` наследует mat; `zoneRegistration.ts`

## Семантика (scope)
- Тела и зоны в разных `LCELL`/`CELL` имеют отдельные scope (`lcell:NAME`, `cell:NAME`); дубликаты имён между scope — норма. `geometryScope.ts` — переходы scope; у `CELL` первый `END` только закрывает раздел тел (UserGuide §9.2.2, рис. А.49).
- Строки состава MATR (нуклиды) не парсятся как зоны; опечатки в числе (`U238 owl.…`) → `matr-nuclide-syntax`; лишние токены → `matr-nuclide-extra`; неверные `MODS`/`DTEM`/`ACE`/`PHT` → `matr-nuclide-param`; повтор имени в одном материале → `matr-nuclide-dup` (`nuclideParamValidation.ts`); hover/signature по параметрам строки нуклида
- После `MATR` KDMK может вставлять строку `** densaa …` (плотности) — парсер пропускает (`isMatrAuxLine`), нуклиды читаются дальше.
- `zone-mat` только если в файле есть PIN/MATR.
- Зоны парсятся **только** во фрагменте `geometry`; имена вроде GRBL/ZRTB с хвостом `/reg:mat` — зоны, а не смена фрагмента. Зона-носитель сети: `Z (NETNAME) тела…`; `(NETNAME)` не входит в булево выражение тел.
- `;` до конца строки — комментарий (лексер + `mergeStatementLines`).
- Визуализация: viewer в `extension/media/geometry/` (только срезы); `buildSliceGrid` + `queryPoint` в `mcu-geometry`.
- **Сложная геометрия в срезах:** `queryPoint` — приоритет LATT (GLTL) → NET (зона-носитель `(NETNAME)`) → глобальные зоны; имена зон с префиксом `C.K`, `NET[1,2].ZPE`.
- `zone-body`/`transf-ref` — только тела того же scope; **первая ссылка `0`** в зоне — всё пространство (UserGuide §9.1.4, `zoneBodyRefs.ts`), не тело N0
- Scope `global` для контейнера; `lcell:NAME` / `cell:NAME` для прототипов решётки/сети; **EQU/SET в прототипе** — локальные имена (UserGuide txt 3264–3268, 3541–3545), перекрытие global по имени без ошибки `const-redef`.
- Карты других модулей — `packages/mcu-schema/src/keywords.ts` (~229 меток).

## Ключевые слова (лексер)
- `packages/mcu-schema/src/keywords.ts` — единый справочник карт по UserGuide + алиасы (`NAMVAR`→`NAMV`, `MAXSER`→`MAXS`, `POWER`→`POWE`, `BURNUP`→`BURN`, …); `CONTEN` без алиаса на геом. `CONT`
- Лексер: тип токена `card` для известных меток, `label` — имя зоны/тела.
- `cspell.json` + `cspell-mcu-labels.txt` — cSpell: словарь через `dictionaryDefinitions`; для `mcunr` игнорируются идентификаторы `A-Z…` (EQU, имена тел).

## Производительность UI (anti-freeze)

- **`ensureDocumentIndex(doc)`** (`serverHandlers.ts`) — единая точка parse для diagnostics, hover, getIndex, getGeometry; кэш `analyzeDocument` по uri+version+hash
- **`documents.onDidClose`** → `clearDocument(uri)`
- **Диагностики LSP:** debounce 250 ms на `didChange`; open/save — сразу
- **Semantic tokens:** capability **отключена** в LSP (не только `editor.semanticHighlighting.enabled: false`) — VS Code блокировал UI ~25 с при первом вводе при применении decorations; TextMate-подсветка остаётся
- **Прогрев (первый символ):** `warmup.ts` — completion + diagnostics при `onInitialize`; extension — `buildCatalogPayload()` + `getIndex` после LSP Running
- **Sidebar webview:** `ready` → `scheduleRefresh()` (без N×`pushState` на resolve)
- **Sidebar:** `refreshSidebarsCoalesced` — single-flight + merge scope; при вводе selection-refresh отключён 600 ms; debounce all 500 ms; полный refresh отменяет constants-only
- **Профилирование:** `MCUHELPER_PROFILE=1` — лог времени parse в stderr LSP
- **Geometry panel:** debounce 800 ms + `geometryGeneration` (отмена устаревших `getGeometry`)
- **expandNaturalIsotope:** `withProgress`, не переключает редактор если уже активен; bundled IAEA offline

## Настройки
- `mcuhelper.mcuNrPath` — путь к MCU-NR
- `mcuhelper.variantName` — имя варианта (1–8 символов)
- `mcuhelper.enableSolverValidation` — авто-INPUT (по умолчанию false)
- `mcuhelper.enableIaeaNuclideHover` — справочник IAEA NDS в hover по нуклидам (по умолчанию true)

## Сборка
```bash
npm install
npm run build
```

### Упаковка VSIX (установка на других машинах)
```bat
package-vsix.bat
```
Создаёт `release/mcuhelper-vscode-<version>.vsix`. Установка: **Extensions → … → Install from VSIX** или `code --install-extension release\mcuhelper-vscode-0.1.0.vsix`.

## Тесты
***При добавлении новых фрагментов кода*** надо сразу реализовывать новые тесты.
**Runner:** Node.js built-in `node:test`. **Покрытие:** [c8](https://github.com/bcoe/c8) по скомпилированному `dist/**/*.js`.

### Команды (корень)

```bash
npm test                  # все пакеты: schema → language → geometry → lsp → extension (~374 теста)
npm run test:coverage     # c8 + HTML-отчёт в coverage/
npm run coverage:check    # gate: lines/statements ≥95%, branches ≥80%, functions ≥88%
```

### Пакеты

| Пакет | Скрипт | Тест-файлы (src) | ~тестов |
|-------|--------|------------------|---------|
| `mcu-schema` | `npm run test --prefix packages/mcu-schema` | `keywords`, `catalog`, `bodyParamGroups`, `cardLineParamGroups`, `nuclideLineParamGroups`, `moduleCards`, `index.smoke`, `cardDescriptionsExtra`, `userGuideCards.smoke`, `cardArgEnums` | 47 |
| `mcu-language` | `npm run test --prefix packages/mcu-language` | unit: `lexer`, `preprocessor`, `expression`, `document`, `constants`, `schemaBridge`, `otherModules`, `bodyVolume`, `calculationControl`, `materialVolumes`, `materialDensity`, `semantic`, `energyGroups`; integration: `integration/fixtures` | 175 |
| `mcu-geometry` | `npm run test --prefix packages/mcu-geometry` | `geometry`, `netQuery`, `gltl`, `primitives`, `hex2d`, `bodyRefs`, `colors`, `pointInBody`, `query`, `buildScene` | 71 |
| `mcu-lsp` | `npm run test --prefix packages/mcu-lsp` | `hover`, `completion`, `signatureHelp`, `solver`, `iaeaNds`, `serverHandlers`, `lsp.integration` | 61 |
| `extension` | `npm run test --prefix extension` | `navData`, `catalogBridge`, `contentDetect`, `expandNaturalIsotope` | 20 |

### Общие хелперы

`test/helpers/index.js` — `loadFixture(name)`, `loadRuntest(relPath)`, `createTextDocument(uri, text)`, `analyzeFixture(name)`.

Фикстуры: `test/fixtures/*.mcu`, интеграционные кейсы: `RUNTEST/**`.

### Покрытие (`.c8rc.json`)

Инструментируется `packages/*/dist/**` и `extension/dist/**`. **Исключения** (не тестируемые или покрываются косвенно):

- VS Code UI: `extension/dist/extension.js`, `sidebarView.js`, `geometryPanel.js`, `templateInsert.js`
- LSP bootstrap / сеть: `packages/mcu-lsp/dist/server.js`, `iaeaNds.js`
- Extension register-команды: `expandNaturalIsotope.js`, `contentDetect.js`
- Автоген: `userGuideCards.generated.js`
- Только типы: `packages/mcu-geometry/dist/types.js`

Текущее покрытие после исключений: **~95% lines/statements**, **~80% branches**, **~88% functions**.

### LSP без e2e

Логика LSP тестируется через `serverHandlers.ts` + `lsp.integration.test.ts` (in-memory `TextDocument`, custom requests `mcuhelper/getIndex`, `queryPoint` и т.д.) без запуска VS Code UI.

## Язык файлов
- Language id: `mcunr`
- Расширения `.mcu`/`.mcunr` — подсказка VS Code, **не обязательны**
- **Автоопределение по содержимому:** `packages/mcu-language/src/detect.ts` — эвристика по картам (`PIN` без обязательных value1/value2, `MATR`, `HEAD`, …); комментарии `**`/`C=` пропускаются; скан до 2 МБ (+ до 8 МБ при нехватке score). Расширение: `setTextDocumentLanguage('mcunr')` при `mcuhelper.autoDetectLanguage=true` и `languageId` из `autoDetectFromLanguages` (по умолчанию incl. `ini`).
- Команда: `MCU-NR: Определить язык по содержимому`
- Настройки: `mcuhelper.autoDetectLanguage`, `mcuhelper.autoDetectFromLanguages`
