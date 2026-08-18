/**
 * Конструктор строки геометрического тела: типы, поля параметров, текст вставки.
 */

import { getBodyParamCount } from "./constants";
import { evaluateExpression, mergeTrailingMultiplyOperands } from "./expression";

export interface BodyParamField {
  id: string;
  label: string;
  defaultValue: string;
  /** Текст ховера в генераторе (группа UserGuide). */
  hint?: string;
}

export interface BodyTypeOption {
  key: string;
  title: string;
  description: string;
  fields: BodyParamField[];
  /**
   * Группы индексов полей для форматирования (запятые внутри группы, пробел между).
   * Пример SPH: [[0,1,2],[3]] → `x,y,z R`.
   */
  formatGroups: number[][];
}

const BODY_GENERATOR_TYPES: BodyTypeOption[] = [
  {
    key: "SPH",
    title: "Шар",
    description: "Центр и радиус.",
    fields: [
      { id: "x", label: "x", defaultValue: "0" },
      { id: "y", label: "y", defaultValue: "0" },
      { id: "z", label: "z", defaultValue: "0" },
      { id: "R", label: "R", defaultValue: "1" },
    ],
    formatGroups: [[0, 1, 2], [3]],
  },
  {
    key: "RCC",
    title: "Круговой цилиндр",
    description: "Центр нижнего основания, вектор высоты, радиус.",
    fields: [
      { id: "x", label: "x", defaultValue: "0" },
      { id: "y", label: "y", defaultValue: "0" },
      { id: "z", label: "z", defaultValue: "0" },
      { id: "dx", label: "dx", defaultValue: "0" },
      { id: "dy", label: "dy", defaultValue: "0" },
      { id: "dz", label: "dz", defaultValue: "1" },
      { id: "R", label: "R", defaultValue: "1" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5], [6]],
  },
  {
    key: "ELL",
    title: "Эллипсоид вращения",
    description: "C1,C2 — фокусы, D>0 малая полуось. Если D<0: C1 центр, C2 полуось вращения, |D| другая полуось.",
    fields: [
      { id: "C1x", label: "C1x", defaultValue: "0" },
      { id: "C1y", label: "C1y", defaultValue: "0" },
      { id: "C1z", label: "C1z", defaultValue: "0" },
      { id: "C2x", label: "C2x", defaultValue: "0" },
      { id: "C2y", label: "C2y", defaultValue: "0" },
      { id: "C2z", label: "C2z", defaultValue: "2" },
      { id: "D", label: "D", defaultValue: "1" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5], [6]],
  },
  {
    key: "RPP",
    title: "Параллелепипед по осям",
    description: "X1<Xs, Y1<Ys, Z1<Zs.",
    fields: [
      { id: "X1", label: "X1", defaultValue: "-1" },
      { id: "Xs", label: "Xs", defaultValue: "1" },
      { id: "Y1", label: "Y1", defaultValue: "-1" },
      { id: "Ys", label: "Ys", defaultValue: "1" },
      { id: "Z1", label: "Z1", defaultValue: "0" },
      { id: "Zs", label: "Zs", defaultValue: "1" },
    ],
    formatGroups: [[0, 1], [2, 3], [4, 5]],
  },
  {
    key: "RCZ",
    title: "Цилиндр вдоль OZ",
    description: "Центр нижнего основания, высота, радиус.",
    fields: [
      { id: "x", label: "x", defaultValue: "0" },
      { id: "y", label: "y", defaultValue: "0" },
      { id: "z", label: "z", defaultValue: "0" },
      { id: "H", label: "H", defaultValue: "1" },
      { id: "R", label: "R", defaultValue: "1" },
    ],
    formatGroups: [[0, 1, 2], [3], [4]],
  },
  {
    key: "UCX",
    title: "Бесконечный цилиндр OX",
    description: "Ось ∥ OX. Y, Z — пересечение с OYZ, R — радиус.",
    fields: [
      { id: "Y", label: "Y", defaultValue: "0" },
      { id: "Z", label: "Z", defaultValue: "0" },
      { id: "R", label: "R", defaultValue: "1" },
    ],
    formatGroups: [[0], [1], [2]],
  },
  {
    key: "UCY",
    title: "Бесконечный цилиндр OY",
    description: "Ось ∥ OY. X, Z — координаты оси, R — радиус.",
    fields: [
      { id: "X", label: "X", defaultValue: "0" },
      { id: "Z", label: "Z", defaultValue: "0" },
      { id: "R", label: "R", defaultValue: "1" },
    ],
    formatGroups: [[0], [1], [2]],
  },
  {
    key: "UCZ",
    title: "Бесконечный цилиндр OZ",
    description: "Ось ∥ OZ. X, Y — координаты оси, R — радиус.",
    fields: [
      { id: "X", label: "X", defaultValue: "0" },
      { id: "Y", label: "Y", defaultValue: "0" },
      { id: "R", label: "R", defaultValue: "1" },
    ],
    formatGroups: [[0], [1], [2]],
  },
  {
    key: "HEX",
    title: "Шестигранная призма OZ",
    description: "Центр и вектор «под ключ» + высота.",
    fields: [
      { id: "x", label: "x", defaultValue: "0" },
      { id: "y", label: "y", defaultValue: "0" },
      { id: "z", label: "z", defaultValue: "0" },
      { id: "Sx", label: "Sx", defaultValue: "1.806" },
      { id: "Hx", label: "Hx", defaultValue: "0" },
      { id: "Hy", label: "Hy", defaultValue: "100" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5]],
  },
  {
    key: "HEXX",
    title: "HEX альтернатива",
    description: "Центр, высота, размер под ключ, угол.",
    fields: [
      { id: "x", label: "x", defaultValue: "0" },
      { id: "y", label: "y", defaultValue: "0" },
      { id: "z", label: "z", defaultValue: "0" },
      { id: "H", label: "H", defaultValue: "100" },
      { id: "D", label: "D", defaultValue: "1.806" },
      { id: "f", label: "f", defaultValue: "0" },
    ],
    formatGroups: [[0, 1, 2], [3], [4], [5]],
  },
  {
    key: "HEXY",
    title: "HEX поворот 90°",
    description: "Как HEXX, угол от OY.",
    fields: [
      { id: "x", label: "x", defaultValue: "0" },
      { id: "y", label: "y", defaultValue: "0" },
      { id: "z", label: "z", defaultValue: "0" },
      { id: "H", label: "H", defaultValue: "3" },
      { id: "D", label: "D", defaultValue: "4" },
      { id: "f", label: "f", defaultValue: "0" },
    ],
    formatGroups: [[0, 1, 2], [3], [4], [5]],
  },
  {
    key: "HEXG",
    title: "Шестигранная призма (произвольная ось)",
    description: "Центр нижнего основания, вектор высоты, вектор «под ключ» на верхнем основании.",
    fields: [
      { id: "Cx", label: "Cx", defaultValue: "0" },
      { id: "Cy", label: "Cy", defaultValue: "0" },
      { id: "Cz", label: "Cz", defaultValue: "0" },
      { id: "Hx", label: "Hx", defaultValue: "0" },
      { id: "Hy", label: "Hy", defaultValue: "0" },
      { id: "Hz", label: "Hz", defaultValue: "100" },
      { id: "Vx", label: "Vx", defaultValue: "1.806" },
      { id: "Vy", label: "Vy", defaultValue: "0" },
      { id: "Vz", label: "Vz", defaultValue: "0" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5], [6, 7, 8]],
  },
  {
    key: "BOX",
    title: "Произвольный параллелепипед",
    description: "Вершина B и три вектора рёбер.",
    fields: [
      { id: "Bx", label: "Bx", defaultValue: "0" },
      { id: "By", label: "By", defaultValue: "0" },
      { id: "Bz", label: "Bz", defaultValue: "0" },
      { id: "P1x", label: "P1x", defaultValue: "1" },
      { id: "P1y", label: "P1y", defaultValue: "0" },
      { id: "P1z", label: "P1z", defaultValue: "0" },
      { id: "P2x", label: "P2x", defaultValue: "0" },
      { id: "P2y", label: "P2y", defaultValue: "1" },
      { id: "P2z", label: "P2z", defaultValue: "0" },
      { id: "P3x", label: "P3x", defaultValue: "0" },
      { id: "P3y", label: "P3y", defaultValue: "0" },
      { id: "P3z", label: "P3z", defaultValue: "1" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]],
  },
  {
    key: "WED",
    title: "Призма с треугольным основанием",
    description: "Вершина B; P1,P2 — рёбра основания, P3 — образующая.",
    fields: [
      { id: "Bx", label: "Bx", defaultValue: "0" },
      { id: "By", label: "By", defaultValue: "0" },
      { id: "Bz", label: "Bz", defaultValue: "0" },
      { id: "P1x", label: "P1x", defaultValue: "2" },
      { id: "P1y", label: "P1y", defaultValue: "0" },
      { id: "P1z", label: "P1z", defaultValue: "0" },
      { id: "P2x", label: "P2x", defaultValue: "0" },
      { id: "P2y", label: "P2y", defaultValue: "2" },
      { id: "P2z", label: "P2z", defaultValue: "0" },
      { id: "P3x", label: "P3x", defaultValue: "0" },
      { id: "P3y", label: "P3y", defaultValue: "0" },
      { id: "P3z", label: "P3z", defaultValue: "3" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]],
  },
  {
    key: "SBOX",
    title: "SBOX из начала координат",
    description: "Три вектора рёбер, вершина в (0,0,0).",
    fields: [
      { id: "P1x", label: "P1x", defaultValue: "10" },
      { id: "P1y", label: "P1y", defaultValue: "0" },
      { id: "P1z", label: "P1z", defaultValue: "0" },
      { id: "P2x", label: "P2x", defaultValue: "5" },
      { id: "P2y", label: "P2y", defaultValue: "5" },
      { id: "P2z", label: "P2z", defaultValue: "0" },
      { id: "P3x", label: "P3x", defaultValue: "0" },
      { id: "P3y", label: "P3y", defaultValue: "0" },
      { id: "P3z", label: "P3z", defaultValue: "3" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5], [6, 7, 8]],
  },
  {
    key: "SHEX",
    title: "SHEX из начала",
    description: "Шестигранник, центр в 0, ось OZ.",
    fields: [
      { id: "S", label: "S", defaultValue: "3" },
      { id: "H", label: "H", defaultValue: "4" },
      { id: "f", label: "f", defaultValue: "0" },
    ],
    formatGroups: [[0], [1], [2]],
  },
  {
    key: "PLG",
    title: "Полупространство",
    description: "(n,x) ≥ Q.",
    fields: [
      { id: "nx", label: "nx", defaultValue: "0" },
      { id: "ny", label: "ny", defaultValue: "1" },
      { id: "nz", label: "nz", defaultValue: "0" },
      { id: "Q", label: "Q", defaultValue: "0" },
    ],
    formatGroups: [[0, 1, 2], [3]],
  },
  {
    key: "PLX",
    title: "X ≥ X0",
    description: "Полупространство X≥X0.",
    fields: [{ id: "X0", label: "X0", defaultValue: "0" }],
    formatGroups: [[0]],
  },
  {
    key: "PLY",
    title: "Y ≥ Y0",
    description: "Полупространство Y≥Y0.",
    fields: [{ id: "Y0", label: "Y0", defaultValue: "0" }],
    formatGroups: [[0]],
  },
  {
    key: "PLZ",
    title: "Z ≥ Z0",
    description: "Полупространство Z≥Z0.",
    fields: [{ id: "Z0", label: "Z0", defaultValue: "0" }],
    formatGroups: [[0]],
  },
  {
    key: "SLA",
    title: "Слой между плоскостями",
    description: "C — точка на одной плоскости, P — перпендикуляр ко второй.",
    fields: [
      { id: "Cx", label: "Cx", defaultValue: "0" },
      { id: "Cy", label: "Cy", defaultValue: "0" },
      { id: "Cz", label: "Cz", defaultValue: "0" },
      { id: "Px", label: "Px", defaultValue: "0" },
      { id: "Py", label: "Py", defaultValue: "0" },
      { id: "Pz", label: "Pz", defaultValue: "1" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5]],
  },
  {
    key: "SLB",
    title: "Слой (нормаль и A,B)",
    description: "N — нормаль; A<B — знаковые расстояния от начала.",
    fields: [
      { id: "Nx", label: "Nx", defaultValue: "0" },
      { id: "Ny", label: "Ny", defaultValue: "0" },
      { id: "Nz", label: "Nz", defaultValue: "1" },
      { id: "A", label: "A", defaultValue: "0" },
      { id: "B", label: "B", defaultValue: "1" },
    ],
    formatGroups: [[0, 1, 2], [3], [4]],
  },
  {
    key: "REC",
    title: "Эллиптический цилиндр",
    description: "Центр основания, высота, большая и малая полуоси эллипса.",
    fields: [
      { id: "Cx", label: "Cx", defaultValue: "0" },
      { id: "Cy", label: "Cy", defaultValue: "0" },
      { id: "Cz", label: "Cz", defaultValue: "0" },
      { id: "Hx", label: "Hx", defaultValue: "0" },
      { id: "Hy", label: "Hy", defaultValue: "0" },
      { id: "Hz", label: "Hz", defaultValue: "10" },
      { id: "R1x", label: "R1x", defaultValue: "2" },
      { id: "R1y", label: "R1y", defaultValue: "0" },
      { id: "R1z", label: "R1z", defaultValue: "0" },
      { id: "R2x", label: "R2x", defaultValue: "0" },
      { id: "R2y", label: "R2y", defaultValue: "1" },
      { id: "R2z", label: "R2z", defaultValue: "0" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]],
  },
  {
    key: "TRC",
    title: "Усечённый круговой конус",
    description: "Центр нижнего основания, вектор высоты, радиусы R1 (низ) и R2 (верх).",
    fields: [
      { id: "Cx", label: "Cx", defaultValue: "0" },
      { id: "Cy", label: "Cy", defaultValue: "0" },
      { id: "Cz", label: "Cz", defaultValue: "0" },
      { id: "Hx", label: "Hx", defaultValue: "0" },
      { id: "Hy", label: "Hy", defaultValue: "0" },
      { id: "Hz", label: "Hz", defaultValue: "10" },
      { id: "R1", label: "R1", defaultValue: "2" },
      { id: "R2", label: "R2", defaultValue: "1" },
    ],
    formatGroups: [[0, 1, 2], [3, 4, 5], [6], [7]],
  },
  {
    key: "ARB",
    title: "Выпуклый многогранник",
    description: "Вершины x,y,z … и грани после /. В поле «хвост» — всё после имени.",
    fields: [
      {
        id: "tail",
        label: "хвост",
        defaultValue: "-1,-1,0 1,-1,0 1,1,0 -1,1,0 / 1234",
      },
    ],
    formatGroups: [[0]],
  },
  {
    key: "QUAD",
    title: "Квадратичная форма",
    description: "Коэффициенты квадратичной формы (или формат с /).",
    fields: [
      { id: "a", label: "a", defaultValue: "1" },
      { id: "b", label: "b", defaultValue: "0" },
      { id: "c", label: "c", defaultValue: "0" },
      { id: "d", label: "d", defaultValue: "1" },
      { id: "e", label: "e", defaultValue: "0" },
      { id: "f", label: "f", defaultValue: "1" },
      { id: "g", label: "g", defaultValue: "0" },
      { id: "h", label: "h", defaultValue: "0" },
      { id: "i", label: "i", defaultValue: "0" },
      { id: "j", label: "j", defaultValue: "-1" },
    ],
    formatGroups: [[0], [1], [2], [3], [4], [5], [6], [7], [8], [9]],
  },
  {
    key: "TRANSF",
    title: "Преобразование тела",
    description:
      "Копия прототипа: буква M — отражение, R — поворот. Точка симметрии (A,B,0) в OXY; f — угол к OX. Прототип не RPP/SBOX/SHEX/PLX/PLY/UCX/UCY.",
    fields: [
      { id: "proto", label: "proto", defaultValue: "C1" },
      { id: "mode", label: "M|R", defaultValue: "R" },
      { id: "A", label: "A", defaultValue: "0" },
      { id: "B", label: "B", defaultValue: "0" },
      { id: "f", label: "f°", defaultValue: "0" },
    ],
    formatGroups: [[0], [1], [2], [3], [4]],
  },
];

/**
 * Описание группы чисел в строке тела (MCU-NR UserGuide §9.1.3).
 * Индекс = formatGroups[i]. Не импортируем schema: copy-extension-assets кладёт
 * bodyGenerator.js в vendor Extension Host без schemaBridge.
 */
const PARAM_GROUP_HINTS: Record<string, string[]> = {
  SPH: ["Центр сферы", "Радиус"],
  RCC: ["Центр нижнего основания", "Вектор высоты цилиндра", "Радиус"],
  ELL: [
    "Фокус 1 (или центр, если D < 0)",
    "Фокус 2 (или вектор полуоси вращения, если D < 0)",
    "D>0 — малая полуось; D<0 — другая полуось, |D|",
  ],
  RPP: ["Границы по X (X1 < Xs)", "Границы по Y (Y1 < Ys)", "Границы по Z (Z1 < Zs)"],
  RCZ: ["Центр нижнего основания", "Высота вдоль OZ", "Радиус"],
  UCX: ["Координата оси на OYZ (Y)", "Координата оси на OYZ (Z)", "Радиус"],
  UCY: ["Координата оси (X)", "Координата оси (Z)", "Радиус"],
  UCZ: ["Координата оси (X)", "Координата оси (Y)", "Радиус"],
  HEX: [
    "Центр нижнего основания",
    "Вектор «под ключ» + высота: XY — размер и поворот, Z — высота",
  ],
  HEXX: ["Центр нижнего основания", "Высота призмы", "Размер под ключ", "Угол поворота"],
  HEXY: ["Центр нижнего основания", "Высота призмы", "Размер под ключ", "Угол от OY"],
  HEXG: [
    "Центр «нижнего» основания",
    "Вектор высоты к центру противоположного основания",
    "Вектор «под ключ» на верхнем основании (середина ребра → противоположная)",
  ],
  BOX: [
    "Радиус-вектор вершины параллелепипеда",
    "Вектор первого ребра из вершины B",
    "Вектор второго ребра из вершины B",
    "Вектор третьего ребра из вершины B",
  ],
  WED: [
    "Радиус-вектор вершины",
    "Ребро основания из B",
    "Второе ребро основания из B",
    "Образующая (ребро из B, не в основании)",
  ],
  SBOX: [
    "Вектор первого ребра (вершина в начале координат)",
    "Вектор второго ребра",
    "Вектор третьего ребра",
  ],
  SHEX: ["Размер под ключ", "Высота", "Угол поворота"],
  PLG: ["Нормаль", "Смещение: (n·x) ≥ Q"],
  PLX: ["Полупространство X ≥ X0"],
  PLY: ["Полупространство Y ≥ Y0"],
  PLZ: ["Полупространство Z ≥ Z0"],
  SLA: ["Точка на одной из плоскостей", "Перпендикуляр к ближайшей точке второй плоскости"],
  SLB: [
    "Вектор, перпендикулярный слою",
    "Знаковое расстояние до первой плоскости (A < B)",
    "Знаковое расстояние до второй плоскости",
  ],
  REC: [
    "Центр нижнего основания",
    "Вектор высоты",
    "Большая полуось эллипса",
    "Малая полуось эллипса",
  ],
  TRC: [
    "Центр нижнего основания",
    "Вектор высоты",
    "Радиус нижнего основания",
    "Радиус верхнего основания",
  ],
  ARB: ["Вершины x,y,z … и грани после /"],
  QUAD: [
    "Коэффициент axx (x²). Поверхность F=0, тело F<0",
    "Коэффициент axy (xy)",
    "Коэффициент axz (xz)",
    "Коэффициент ayy (y²)",
    "Коэффициент ayz (yz)",
    "Коэффициент azz (z²)",
    "Линейный коэффициент bx",
    "Линейный коэффициент by",
    "Линейный коэффициент bz",
    "Свободный член d",
  ],
  TRANSF: [
    "Имя тела-прототипа (не RPP, SBOX, SHEX, PLX, PLY, UCX, UCY)",
    "Буква типа: M — отражение, R — поворот (это не координата)",
    "X точки симметрии (A,B,0): через неё вертикальная плоскость (M) или ось (R)",
    "Y точки симметрии (A,B,0)",
    "f° к OX: у M наклон плоскости отражения, у R угол поворота",
  ],
};

function withFieldHints(t: BodyTypeOption): BodyTypeOption {
  const groups = PARAM_GROUP_HINTS[t.key];
  return {
    ...t,
    fields: t.fields.map((f, i) => {
      if (f.hint) return { ...f };
      if (!groups) return { ...f };
      const gi = t.formatGroups.findIndex((g) => g.includes(i));
      const hint = gi >= 0 ? groups[gi] : undefined;
      return hint ? { ...f, hint } : { ...f };
    }),
    formatGroups: t.formatGroups.map((g) => [...g]),
  };
}

export function listBodyGeneratorTypes(): BodyTypeOption[] {
  return BODY_GENERATOR_TYPES.map((t) => withFieldHints(t));
}

export function getBodyGeneratorType(key: string): BodyTypeOption | undefined {
  const found = BODY_GENERATOR_TYPES.find((t) => t.key === key.toUpperCase());
  if (!found) return undefined;
  return withFieldHints(found);
}

const BODY_SOURCE_KEYS = new Set(BODY_GENERATOR_TYPES.map((t) => t.key));

export interface ParsedBodySource {
  bodyType: string;
  name: string;
  params: string[];
}

export interface CollectedBodyStatement {
  text: string;
  startLine: number;
  endLine: number;
}

function isFullLineComment(line: string): boolean {
  if (!line.length) return false;
  if (line[0] === "*") return true;
  return line.length >= 2 && (line[0] === "C" || line[0] === "c") && line[1] === "=";
}

/** Продолжение предложения: пробел в колонке 1 (UserGuide §7.1). */
function isContinuationLine(line: string): boolean {
  return line.length > 0 && line[0] === " ";
}

/** Убрать `;комментарий` и полный комментарий строки. */
export function stripBodyLineComment(line: string): string {
  if (isFullLineComment(line)) return "";
  const semi = line.indexOf(";");
  const cut = semi >= 0 ? line.slice(0, semi) : line;
  return cut.trim();
}

/**
 * Собрать предложение с продолжениями вокруг `lineIndex` (0-based).
 * Курсор на продолжении → берём голову + хвост.
 */
export function collectContinuedStatement(
  lines: readonly string[],
  lineIndex: number
): CollectedBodyStatement | null {
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  if (!isContinuationLine(lines[lineIndex]!) && isFullLineComment(lines[lineIndex]!)) {
    return null;
  }
  let start = lineIndex;
  while (start > 0 && isContinuationLine(lines[start]!)) start--;
  if (isFullLineComment(lines[start]!)) return null;
  let end = start;
  while (end + 1 < lines.length && isContinuationLine(lines[end + 1]!)) end++;
  const parts: string[] = [];
  for (let i = start; i <= end; i++) {
    const piece = stripBodyLineComment(lines[i]!);
    if (piece) parts.push(piece);
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return { text, startLine: start, endLine: end };
}

/** Разобрать строку тела из исходника варианта (не AST). */
export function parseBodySourceStatement(text: string): ParsedBodySource | null {
  const raw = stripBodyLineComment(text).replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const head = raw.split(/[\s,]+/).filter(Boolean);
  if (!head.length) return null;
  const h0 = head[0]!.toUpperCase();
  const h1 = head[1]?.toUpperCase();

  if (h0 === "TRANSF") {
    return {
      bodyType: "TRANSF",
      name: head[1] ?? "*",
      params: mergeTrailingMultiplyOperands(head.slice(2)),
    };
  }

  let bodyType: string | undefined;
  let name: string;
  let rest: string[];
  if (BODY_SOURCE_KEYS.has(h0)) {
    bodyType = h0;
    name = head[1] ?? "*";
    rest = head.slice(2);
  } else if (h1 && BODY_SOURCE_KEYS.has(h1)) {
    bodyType = h1;
    name = head[0]!;
    rest = head.slice(2);
  } else {
    return null;
  }

  const schema = getBodyGeneratorType(bodyType);
  if (!schema) return null;
  if (schema.fields.length === 1 && schema.fields[0]?.id === "tail") {
    const tailMatch = raw.match(/^\S+\s+\S+\s+([\s\S]*)$/);
    return { bodyType, name, params: [tailMatch?.[1]?.trim() ?? rest.join(" ")] };
  }
  return { bodyType, name, params: mergeTrailingMultiplyOperands(rest) };
}

/** MCU id: буква + до 5 букв/цифр, либо `*` (автоимя). UserGuide §9. */
export const BODY_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,5}$/;

/** UserGuide §9.1.3: U — объединение зон, T — продолжение строки. */
const RESERVED_BODY_NAMES = new Set(["T", "U"]);

/** Буква автоимени по типу (как letter в BODY_TYPES). */
const BODY_AUTO_LETTER: Record<string, string> = {
  SPH: "S",
  RCC: "C",
  ELL: "E",
  RPP: "P",
  RCZ: "Z",
  UCX: "X",
  UCY: "Y",
  UCZ: "Z",
  HEX: "H",
  HEXX: "H",
  HEXY: "H",
  HEXG: "H",
  BOX: "B",
  WED: "W",
  SBOX: "X",
  SHEX: "I",
  PLG: "D",
  PLX: "X",
  PLY: "Y",
  PLZ: "Z",
  SLA: "V",
  SLB: "L",
  REC: "O",
  TRC: "T",
  ARB: "N",
  QUAD: "Q",
  TRANSF: "T",
};

export function isValidBodyName(name: string): boolean {
  if (name === "*") return true;
  if (!BODY_NAME_RE.test(name)) return false;
  return !RESERVED_BODY_NAMES.has(name.toUpperCase());
}

function nameIsFree(cand: string, used: Set<string>): boolean {
  if (!isValidBodyName(cand) || cand === "*") return false;
  return !used.has(cand.toUpperCase());
}

/**
 * Заменить `*` на свободное имя в текущем scope: буква типа, затем H1, H2, …
 * MCU принимает `*` сам, но в исходник удобнее писать явное имя (зоны ссылаются на него).
 */
export function allocateBodyName(bodyType: string, existingNames: Iterable<string>): string {
  const used = new Set<string>();
  for (const n of existingNames) {
    const u = String(n ?? "").trim().toUpperCase();
    if (u && u !== "*") used.add(u);
  }
  const rawLetter =
    BODY_AUTO_LETTER[bodyType.toUpperCase()] ??
    (bodyType.match(/[A-Za-z]/)?.[0] ?? "B");
  const letter = rawLetter.toUpperCase();
  if (nameIsFree(letter, used)) return letter;
  for (let i = 1; i < 100000; i++) {
    const cand = `${letter}${i}`;
    if (cand.length > 6) break;
    if (nameIsFree(cand, used)) return cand;
  }
  for (let i = 1; i < 100000; i++) {
    const cand = `B${i}`;
    if (cand.length > 6) break;
    if (nameIsFree(cand, used)) return cand;
  }
  return "B1";
}

/** Выкинуть пробелы, цифру в начале, лишнюю длину и прочие символы. */
export function sanitizeBodyName(raw: string): string {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (s === "*") return "*";
  let out = "";
  for (const ch of s) {
    if (out.length >= 6) break;
    if (out.length === 0) {
      if (/[A-Za-z]/.test(ch)) out += ch;
    } else if (/[A-Za-z0-9]/.test(ch)) {
      out += ch;
    }
  }
  return out;
}

export interface BodyGeneratorInput {
  bodyType: string;
  name: string;
  /** Сырые токены параметров (числа, имена EQU или выражения). */
  params: string[];
}

function formatParamGroups(params: string[], groups: number[][]): string {
  return groups
    .map((g) => g.map((i) => (params[i] ?? "").trim()).filter(Boolean).join(","))
    .filter((s) => s.length > 0)
    .join(" ");
}

/** Собрать строку тела MCU-NR. Пустой слот в середине сдвинет хвост — okToInsert=false. */
export function buildBodyStatement(input: BodyGeneratorInput): {
  text: string;
  warnings: string[];
  okToInsert: boolean;
} {
  const warnings: string[] = [];
  const typeKey = (input.bodyType || "").toUpperCase().trim();
  const schema = getBodyGeneratorType(typeKey);
  if (!schema) {
    return {
      text: "",
      warnings: [`Неизвестный тип тела: ${input.bodyType || "(пусто)"}`],
      okToInsert: false,
    };
  }

  const name = sanitizeBodyName(input.name || "");
  if (!name) warnings.push("Не задано имя тела (буква + до 5 букв/цифр, ≤6).");
  else if (!isValidBodyName(name)) {
    warnings.push(
      `Имя «${name}» недопустимо (буква + до 5 букв/цифр, без пробелов; U и T служебные).`
    );
  }

  const expected = getBodyParamCount(typeKey);
  const params = input.params.map((p) => String(p ?? "").trim());
  if (typeof expected === "number" && params.length < expected) {
    warnings.push(`Параметров меньше ожидаемых (${params.length}/${expected}).`);
  }
  if (typeof expected === "number" && params.length > expected) {
    warnings.push(`Лишние параметры (${params.length}/${expected}).`);
  }

  const emptyIdx = params.findIndex((p) => !p);
  if (emptyIdx >= 0) {
    warnings.push(
      `Пустой параметр «${schema.fields[emptyIdx]?.label ?? emptyIdx}» — следующие числа съедут, вставка запрещена.`
    );
  }

  if (typeKey === "TRANSF") {
    const mode = (params[1] ?? "").trim().toUpperCase();
    if (mode && mode !== "M" && mode !== "R") {
      warnings.push("Тип преобразования — буква M (отражение) или R (поворот), UserGuide §9.1.3.22.");
    }
  }

  const body = formatParamGroups(params, schema.formatGroups);
  // ARB: поле «хвост» уже содержит пробелы и «/» — не трогаем
  const text =
    schema.fields.length === 1 && schema.fields[0]?.id === "tail"
      ? `${typeKey} ${name} ${params[0] ?? ""}`.replace(/\s+/g, " ").replace(/\s+\//g, " /").trim() + "\n"
      : `${typeKey} ${name} ${body}`.replace(/\s+/g, " ").trim() + "\n";
  return { text, warnings, okToInsert: warnings.length === 0 && text.trim().length > 0 };
}

/**
 * Вычислить числовые параметры для превью: число, EQU или выражение.
 * Ошибка/пусто → NaN в том же слоте (индексы не съезжают).
 */
export function resolveBodyParamNumbers(
  params: string[],
  vars: Map<string, number>
): { nums: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const nums: number[] = [];
  for (let i = 0; i < params.length; i++) {
    const raw = (params[i] ?? "").trim();
    if (!raw) {
      warnings.push(`Параметр #${i + 1} пуст`);
      nums.push(Number.NaN);
      continue;
    }
    const asNum = Number(raw);
    if (raw !== "" && Number.isFinite(asNum) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) {
      nums.push(asNum);
      continue;
    }
    const v = evaluateExpression(raw, vars);
    if (v === null || !Number.isFinite(v)) {
      warnings.push(`Не удалось вычислить «${raw}»`);
      nums.push(Number.NaN);
      continue;
    }
    nums.push(v);
  }
  return { nums, warnings };
}

export interface TransfResolvedParams {
  protoName: string;
  mode: string;
  A: number;
  B: number;
  f: number;
  warnings: string[];
  ok: boolean;
}

/**
 * TRANSF: proto и M|R — идентификаторы, не выражения.
 * UserGuide §9.1.3.22: `TRANSF <новое> <прототип> M|R A B f`.
 */
export function resolveTransfParams(params: string[], vars: Map<string, number>): TransfResolvedParams {
  const warnings: string[] = [];
  const protoName = (params[0] ?? "").trim();
  const modeRaw = (params[1] ?? "").trim();
  const mode = modeRaw.toUpperCase();
  if (!protoName) warnings.push("Не задано имя тела-прототипа");
  if (mode !== "M" && mode !== "R") {
    warnings.push("Тип преобразования должен быть M (отражение) или R (поворот), UserGuide §9.1.3.22");
  }
  const rest = resolveBodyParamNumbers(params.slice(2, 5), vars);
  warnings.push(...rest.warnings);
  const A = rest.nums[0] ?? Number.NaN;
  const B = rest.nums[1] ?? Number.NaN;
  const f = rest.nums[2] ?? Number.NaN;
  const ok =
    protoName.length > 0 &&
    (mode === "M" || mode === "R") &&
    rest.nums.length >= 3 &&
    rest.nums.every(Number.isFinite);
  return { protoName, mode: modeRaw, A, B, f, warnings, ok };
}

function putVar(vars: Map<string, number>, name: string, value: number): void {
  vars.set(name, value);
  vars.set(name.toUpperCase(), value);
}

/** Карта констант из списка {name,value,expression?}: сначала готовое число, иначе выражение. */
export function constantsToVarMap(
  constants: Array<{ name: string; value?: number | null; expression?: string }>
): Map<string, number> {
  const vars = new Map<string, number>();
  for (const c of constants) {
    if (c.value != null && Number.isFinite(c.value)) {
      putVar(vars, c.name, c.value);
      continue;
    }
    const expr = (c.expression ?? "").trim();
    if (!expr) continue;
    const v = evaluateExpression(expr, vars);
    if (v !== null && Number.isFinite(v)) putVar(vars, c.name, v);
  }
  return vars;
}
