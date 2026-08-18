# MCU-NR Helper — руководство разработчика

> Актуально на **2026-08-14**. Структура проекта и контекст для агентов — в [`structure.md`](../structure.md) (локальный файл, в gitignore).

## Требования

- [Node.js](https://nodejs.org/) (LTS)
- [Visual Studio Code](https://code.visualstudio.com/download) ^1.85 — для Extension Development Host и упаковки VSIX
- Windows — основная среда сборки (`package-vsix.bat`); пакеты кросс-платформенные (Node + TypeScript)

## Первичная настройка

```bash
npm install
npm run build
```

Скрипт `build` компилирует все workspace-пакеты и копирует артефакты в `extension/` (LSP → `extension/server/server.js`, vendor schema/language/geometry).

## Структура monorepo

| Каталог | npm-пакет | Назначение |
|---------|-----------|------------|
| `packages/mcu-schema/` | mcu-schema | Схемы карт MCU-NR |
| `packages/mcu-language/` | mcu-language | Парсер, семантика, include, burnup, конструкторы MATR/тел и др. |
| `packages/mcu-geometry/` | mcu-geometry | Превью геометрии, meshPreview |
| `packages/mcu-lsp/` | mcu-lsp | Language Server |
| `extension/` | extension | VS Code extension (UI, команды, webview) |

Подробнее о панелях, потоках данных и паттернах — [`structure.md`](../structure.md).

## Сборка и упаковка

```bash
npm run build
```

VSIX (Windows):

```bat
package-vsix.bat
```

- Без аргументов — интерактивное меню bump/пересборка.
- `package-vsix.bat nobump` — без увеличения версии.
- Готовые `.vsix` — каталог `release/`.

Дополнительные скрипты корня:

| Команда | Назначение |
|---------|------------|
| `npm run copy-extension-assets` | LSP + vendor в `extension/` |
| `npm run refresh-materials-compendium` | PNNL JSON → slim+gzip в `extension/media/materialsCompendium/` |

## Тестирование

### Запуск

```bash
npm test
```

Последовательно: `mcu-schema` → `mcu-language` → `mcu-geometry` → `mcu-lsp` → `extension`. Фреймворк — **node:test** (без Jest/Mocha).

### Снимок 2026-08-14

**888 тестов, 0 падений:**

| Пакет | Тестов |
|-------|--------|
| mcu-schema | 60 |
| mcu-language | 435 |
| mcu-geometry | 92 |
| mcu-lsp | 178 |
| extension | 123 |

> [`README.md`](../README.md) ссылается на этот снимок; при расхождении цифр правьте оба файла.

Тесты одного пакета:

```bash
npm run test --prefix packages/mcu-language
```

Фикстуры общие: [`test/fixtures/`](../test/fixtures/).

## Покрытие кода (c8)

Юнит-покрытие — это **регрессионный пол**, не цель «95% всего репозитория». VS Code host (activate, webview `*Panel`, тонкие `*Command`/`*Insert`) в node:test не гоняется и в c8 **не входит**. Модули, у которых уже есть unit-тесты (`contentDetect`, `expandNaturalIsotope`, `iaeaNds`), наоборот **входят** — даже если процент низкий.

GitHub Actions / иной CI в репозитории **нет**. `coverage:check` — локальный гейт после `test:coverage`.

### Команды

```bash
npm run test:coverage    # отчёт text + html + lcov в coverage/ (gitignore)
npm run coverage:check   # полы из scripts/coverage-floors.json
node scripts/check-coverage.js --suggest   # предложить floor(факт)
```

Конфиг: [`.c8rc.json`](../.c8rc.json) — `all: true`, include `dist/**/*.js` пяти пакетов. Гейт: [`scripts/check-coverage.js`](../scripts/check-coverage.js) + [`scripts/coverage-floors.json`](../scripts/coverage-floors.json).

HTML: после `test:coverage` открой `coverage/index.html` — красные строки = неисполненные. Это и есть «какие файлы болят», скриншоты не нужны.

### Снимок и полы (2026-08-14, после iaeaNds + meshPreview)

| Пакет | Lines факт | Branch | Funcs | Пол lines | Пол branch | Пол funcs |
|-------|------------|--------|-------|-----------|------------|-----------|
| **global** | 86.51% | 78.60% | 82.22% | 86 | 78 | 82 |
| mcu-schema | 99.92% | 91.82% | 71.15% | 99 | 91 | 70 |
| mcu-language | 94.64% | 80.07% | 97.67% | 94 | 79 | 97 |
| mcu-geometry | 95.77% | 81.32% | 77.77% | 95 | 81 | 77 |
| mcu-lsp | 80.89% | 73.14% | 81.44% | 80 | 73 | 81 |
| extension | 63.10% | 76.44% | 57.51% | 63 | 76 | 57 |

Пол ≈ `Math.floor(факт)`; у schema functions 70 (факт 71.15 — запас на шум V8). Старый глобальный порог 95/80/88/95 **снят**: он не выполнялся и маскировался выкидыванием уже покрытых файлов.

### Что исключено (вне юнит-вселенной)

- generated / harness: `userGuideCards.generated.js`, `*.test.js`, `test-setup.js`, `vscode-mock.js`, `types.js`
- VS Code host: `extension.js`, `sidebarView.js`, `runPanelView.js`, `*Panel.js`, `*Command.js`, `*Insert.js`, `codeActions.js`, `mcuStepRunner.js`, `includePreview.js` (ядро — `includePreviewCore.js`)
- LSP bootstrap: `server.js`, `warmup.js`

**Не исключать** только чтобы поднять процент. Webview JS (`extension/media/**/*.js`) в c8 не входит: это не TypeScript/`dist`.

### Закрытые дыры (2026-08-14)

| Модуль | Было → стало | Подход |
|--------|--------------|--------|
| `iaeaNds` (mcu-lsp) | ~43% → **95.6% lines / 96% funcs** | `resetIaeaNdsStateForTest`: temp-кэш + inject `fetchImpl`; без `~/.mcuhelper` и без глобального `fetch` |
| `meshPreview` (mcu-geometry) | ~69% → **99.4% lines / 100% funcs** | типы тел, bbox, сечения, nearby, граничные случаи |

Тестов: **888** (было 869). `coverage:check` — зелёный.

### Честные дыры (включены в отчёт)

| Модуль | Lines | Замечание |
|--------|-------|-----------|
| defaultPhyLib | 0% | загрузчик vendor, без тестов |
| expandNaturalIsotope | ~30% | тесты есть, в основном `findNuclideSpan` |
| contentDetect | ~43% | тесты есть, vscode-ветки тонкие |
| mcuTerminalRun | ~21% | |
| materialsCompendiumStore | ~31% | |
| parameteThrVerify | ~43% | |

### Паттерн

Логику выносить из webview-host в модули без `vscode` API (`includePreviewCore`, `navData`, `runPanelHelpers`) и покрывать node:test. Сеть и user-кэш — temp-файлы + inject (`resetIaeaNdsStateForTest`). `@vscode/test-electron` для панелей не используем.

## Отладка

- **Extension Development Host:** Run and Debug → «Run Extension» (`extension/.vscode/launch.json`).
- **LSP trace:** Settings → `mcuhelper.trace.server` = `messages` / `verbose`.
- **Логи отладки:** `.cursor/debug-*.log` (gitignore).

## Стандарты

- TypeScript 5.3+, strict в пакетах.
- Комментарии и пользовательская документация — на русском.
- Новые классы — отдельные файлы; стиль окружающего кода.
- Не коммитить: `coverage/`, `structure.md`, proprietary docs в `docs/` (см. `.gitignore`).

## Связанные документы

| Документ | Аудитория |
|----------|-----------|
| [`README.md`](../README.md) | Пользователи и обзор возможностей |
| [`structure.md`](../structure.md) | Агенты / быстрый контекст (локально) |
| [`CHANGELOG_RU.md`](../CHANGELOG_RU.md) | Журнал изменений |
| [mcuproject.ru](https://mcuproject.ru/rabout.html) | Официальная документация MCU |
