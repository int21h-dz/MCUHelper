# MCU Helper

**Расширение [Visual Studio Code](https://code.visualstudio.com/download) + Language Server** для исходных данных программ семейства [MCU6](#о-mcu-и-mcu-nr).

[`VS Code ^1.85`](https://code.visualstudio.com/download) · `Node.js` · язык `mcunr` · ~374 теста

> **English:** MCU Helper is a VS Code extension and Language Server for editing MCU6 input decks — text files that describe materials, 3D geometry, sources, tallying, and burnup for Monte Carlo particle transport. It brings syntax highlighting, diagnostics, completions, hover documentation, a module catalog, and convenient navigation inside MCU input files.

![Демонстрация MCU Helper в VS Code](media/Promo.gif)

---

## Содержание

- [О MCU](#о-mcu-и-mcu-nr)
- [Что такое McuHelper](#что-такое-mcuhelper)
- [Возможности](#возможности)
- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Команды](#команды)
- [Настройки](#настройки)
- [Разработка](#разработка)
- [Тесты и документация](#тесты-и-документация)

---

## О MCU и MCU-NR

### Программа MCU

[**MCU**](https://mcuproject.ru/rabout.html) (**M**onte-**C**arlo **U**niversal) — проект Курчатовского института по разработке универсальной программы для численного моделирования переноса излучения в трёхмерных системах методом Монте-Карло. Поддерживаются нейтроны, гамма-кванты, электроны и позитроны.

Метод Монте-Карло позволяет моделировать взаимодействие излучения с веществом на основе оценённых ядерных данных без жёстких ограничений на геометрию. Программы семейства MCU применяются при анализе ядерной и радиационной безопасности, расчётах реакторов, проектировании защиты, дозиметрии, моделировании выгорания и во многих других задачах атомной отрасли.

Подробнее на официальном сайте: **[О проекте MCU](https://mcuproject.ru/rabout.html)**.
---

## Что такое McuHelper

Исходники MCU — большие текстовые файлы со строгим синтаксисом.

**McuHelper** (MCU-NR Helper) добавляет к VS Code поддержку уровня современных IDE: подсветку, диагностику, автодополнение и навигацию.

### Архитектура

Монорепозиторий из пакетов и расширения VS Code:

| Компонент | Назначение |
|-----------|------------|
| [`packages/mcu-schema`](packages/mcu-schema) | Схемы карт PIN/GEO, типы тел, hover-тексты, каталог шаблонов модулей |
| [`packages/mcu-language`](packages/mcu-language) | Лексер, парсер, семантический анализ, индекс документа |
| [`packages/mcu-geometry`](packages/mcu-geometry) | Geometry IR, аналитика зон, запросы к геометрии |
| [`packages/mcu-lsp`](packages/mcu-lsp) | Language Server: diagnostics, completion, hover, custom requests |
| [`extension/`](extension) | UI VS Code: боковая панель и команды |

```mermaid
flowchart LR
  Editor[VS Code Editor] --> Ext[extension]
  Ext --> LSP[mcu-lsp]
  LSP --> Lang[mcu-language]
  LSP --> Geo[mcu-geometry]
  Lang --> Schema[mcu-schema]
  Geo --> Schema
  Ext --> Sidebar[Webview Sidebar]
```

---

## Возможности

### Редактор и Language Server

- **Подсветка синтаксиса** — TextMate-грамматика + **семантические токены** LSP (карта, зона, тело, нуклид, число, комментарий)
- **Диагностики** в реальном времени:
  - запрет табуляции в коде (в `**` / `C=` и после `;` допустима);
  - порядок фрагментов варианта;
  - ссылки на несуществующие тела и зоны;
  - состав `MATR`: нуклиды, `MODS`, дубликаты, лишние параметры;
  - группы `ENERGY` / `ENERG` (монотонность, нижние границы ≥ 0);
  - физические величины ≥ 0 (температура, плотность, мощность, время, объёмы);
  - неинициализированные имена в `EQU`/`SET` и выражениях
- **Автодополнение** — все карты (~229 меток), алиасы, аргументы карт (`SUMZON`→`SUMB`…`ZONG`, `CONTEN`→`DENS`…, `CODE`→`RSTP`…), символы документа
- **Signature Help** — подсказка активного параметра при вводе тел (`RCC`, `RCZ`, …), карт (`MATR`, `POWER`, `STEP`, …), строк нуклидов
- **Hover** — описания из UserGuide; для нуклидов — концентрация, плотность, атомная масса; опционально справочник **IAEA NDS** (ENDF, сечения, распад); для `POWER`/`STEP` — SVG-график мощности и энерговыработки; для `EMES`/`EPRO` — спектр источника; для `VOL` — объёмы материалов
- **Автоопределение языка** `mcunr` по содержимому (`PIN`, `MATR`, `HEAD`, …) — даже для файлов без расширения `.mcu`
- **Сворачивание (folding)** — фрагменты варианта (`PIN`…`FINISH`) и блоки `MATR` в редакторе
- **Кликабельный `#include`** — переход к включаемому файлу (Ctrl+Click / F12); поддерживаются `#include <path>` и `#include path` (расширения `.mcu` / `.mcunr` подставляются автоматически)
- **Выделение маркеров разделов** — `PIN`, `HEAD`, `FINISH` и др. визуально крупнее (bold + цвет + фон)

### Боковая панель MCU-NR

Иконка в Activity Bar → контейнер **MCU-NR** с восемью вкладками (Webview, единый стиль):

| Вкладка | Назначение |
|---------|------------|
| **Каталог** | 8 модулей варианта; карточки карт с hover; drag или клик → вставка шаблона в редактор |
| **Материалы** | Дерево `MATR` с плотностью и группами |
| **Константы** | Эффективный набор `EQU`/`SET` в позиции курсора (global + локальные LCELL/CELL) |
| **Тела** | Список геометрических тел по scope |
| **Сети** | Ячейки `NET` |
| **Решётки** | Элементы `LATT` / `LCELL` |
| **Зоны** | Булевы выражения зон |
| **Объекты** | Регистрационные объекты |

Клик по элементу — переход к строке в файле. Кнопка обновления на панели — пересчёт индекса.

### Прочее

- **MCU-NR: Разложить природный элемент на изотопы** — кнопка в hover нуклида (ICE)
- **MCU-NR: Определить язык по содержимому** — ручное переключение на `mcunr`
- Встроенные настройки **cSpell** для языка `mcunr` (игнорирование имён карт и тел)

---

## Установка

Для работы расширения нужен **[Visual Studio Code](https://code.visualstudio.com/download)** (версия 1.85 и новее). Скачать: [code.visualstudio.com/download](https://code.visualstudio.com/download).

### Из VSIX (рекомендуется для пользователей)

1. Скачать свежий релиз [MCUHelper](https://github.com/int21h-dz/MCUHelper/releases)

2. Установите в VS Code:
   - **Extensions** → **…** → **Install from VSIX…**
   - или из командной строки:

     ```bat
     code --install-extension release\mcuhelper-vscode-0.1.0.vsix
     ```

### Из исходников (разработка)

```bash
npm install
npm run build
```

Запуск: откройте репозиторий в VS Code → **F5** → **Extension Development Host**.

---

## Быстрый старт

1. Откройте файл варианта — `.mcu`, `.mcunr` или текстовый файл с картами `PIN` / `MATR` / `HEAD`.
2. Язык редактора переключится на **mcunr** автоматически (настройка `mcuhelper.autoDetectLanguage`).
3. В Activity Bar нажмите иконку **MCU-NR** — откроется боковая панель с каталогом и навигацией.
4. Наведите курсор на карту или нуклид — появится hover из UserGuide.
**Примеры файлов** в репозитории:

| Файл | Что демонстрирует |
|------|-------------------|
| [test/fixtures/full_variant.mcu](test/fixtures/full_variant.mcu) | Полный вариант |
| [test/fixtures/pin_example.mcu](test/fixtures/pin_example.mcu) | Фрагмент PIN / MATR |
| [test/fixtures/trx_geometry.mcu](test/fixtures/trx_geometry.mcu) | Пример описания геометрии |
| [test/fixtures/latt_example.mcu](test/fixtures/latt_example.mcu) | Решётка LATT |
| [test/fixtures/cell_example.mcu](test/fixtures/cell_example.mcu) | Ячейка CELL / NET |

---

## Команды

Вызов: **Ctrl+Shift+P** → введите `MCU-NR`.

### Навигация и каталог

| Команда | Описание |
|---------|----------|
| MCU-NR: Каталог модулей | Открыть вкладку каталога |
| MCU-NR: Показать материалы | Вкладка материалов |
| MCU-NR: Показать константы | Вкладка констант |
| MCU-NR: Показать тела | Вкладка тел |
| MCU-NR: Показать сети | Вкладка сетей |
| MCU-NR: Показать решётки | Вкладка решёток |
| MCU-NR: Показать зоны | Вкладка зон |
| MCU-NR: Показать объекты | Вкладка объектов |
| MCU-NR: Обновить индекс | Пересчитать индекс документа |
| MCU-NR: Вставить шаблон | Вставка шаблона из каталога |

### Дополнительные команды

| Команда | Описание |
|---------|----------|
| MCU-NR: Экспорт диагностик | Вывод Problems в Output |

### Утилиты

| Команда | Описание |
|---------|----------|
| MCU-NR: Определить язык по содержимому | Принудительно `mcunr` |
| MCU-NR: Разложить природный элемент на изотопы | ICE-разложение из hover |

---

## Настройки

**Settings** → поиск `mcuhelper`.

| Параметр | По умолчанию | Описание |
|----------|--------------|----------|
| `mcuhelper.enableIaeaNuclideHover` | `true` | Дополнять hover по нуклидам данными IAEA NDS |
| `mcuhelper.autoDetectLanguage` | `true` | Определять MCU-NR по содержимому и переключать язык на `mcunr` |
| `mcuhelper.autoDetectFromLanguages` | `plaintext`, `txt`, `ini`, … | С каких language id переключать (уже размеченные языки не трогает) |
| `mcuhelper.trace.server` | `off` | Лог LSP: `off` / `messages` / `verbose` |

---

## Разработка

### Сборка

```bash
npm install
npm run build
```

Скрипт `build` компилирует все пакеты и копирует бандл LSP в `extension/server/server.js` (нужно для VSIX и Extension Development Host).

### Упаковка VSIX

```bat
package-vsix.bat
```
---

## Тесты и документация

### Тесты

```bash
npm test
```

Запускает ~374 теста в пакетах `mcu-schema`, `mcu-language`, `mcu-geometry`, `mcu-lsp`, `extension`.

```bash
npm run test:coverage
npm run coverage:check
```

Покрытие (c8): lines/statements ≥ 95%, branches ≥ 80%, functions ≥ 88%.

### Документация MCU-NR

| Ресурс | Описание |
|--------|----------|
| [mcuproject.ru](https://mcuproject.ru/rabout.html) | Официальный сайт семейства MCU |

---

## Связанные ссылки

- [Visual Studio Code — скачать](https://code.visualstudio.com/download) — редактор, в котором работает расширение
- [О проекте MCU](https://mcuproject.ru/rabout.html) — Monte-Carlo Universal, Курчатовский институт
