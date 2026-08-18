/** Логические группы параметров тел (как в строке исходника, не по одному числу). */
export interface BodyParamGroup {
  label: string;
  documentation: string;
}

export const BODY_PARAM_GROUPS: Record<string, BodyParamGroup[]> = {
  SPH: [
    { label: "name", documentation: "Имя тела" },
    { label: "x,y,z", documentation: "Центр сферы" },
    { label: "R", documentation: "Радиус" },
  ],
  RCC: [
    { label: "name", documentation: "Имя тела" },
    { label: "x,y,z", documentation: "Центр нижнего основания" },
    { label: "dx,dy,dz", documentation: "Вектор высоты цилиндра" },
    { label: "R", documentation: "Радиус" },
  ],
  RPP: [
    { label: "name", documentation: "Имя тела" },
    { label: "X1,Xs", documentation: "Границы по X (X1 < Xs)" },
    { label: "Y1,Ys", documentation: "Границы по Y" },
    { label: "Z1,Zs", documentation: "Границы по Z" },
  ],
  RCZ: [
    { label: "name", documentation: "Имя тела" },
    { label: "x,y,z", documentation: "Центр нижнего основания" },
    { label: "H", documentation: "Высота вдоль OZ" },
    { label: "R", documentation: "Радиус" },
  ],
  HEX: [
    { label: "name", documentation: "Имя тела" },
    { label: "x,y,z", documentation: "Центр нижнего основания" },
    { label: "Sx,Hx,Hy", documentation: "Вектор: размер под ключ, высота, …" },
  ],
  HEXX: [
    { label: "name", documentation: "Имя тела" },
    { label: "x,y,z", documentation: "Центр нижнего основания" },
    { label: "H", documentation: "Высота призмы" },
    { label: "D", documentation: "Размер под ключ" },
    { label: "f", documentation: "Угол поворота" },
  ],
  HEXY: [
    { label: "name", documentation: "Имя тела" },
    { label: "x,y,z", documentation: "Центр нижнего основания" },
    { label: "H", documentation: "Высота призмы" },
    { label: "D", documentation: "Размер под ключ" },
    { label: "f", documentation: "Угол от OY" },
  ],
  HEXG: [
    { label: "name", documentation: "Имя тела" },
    { label: "C (x,y,z)", documentation: "Центр «нижнего» основания" },
    { label: "H (x,y,z)", documentation: "Вектор высоты к центру противоположного основания" },
    { label: "V (x,y,z)", documentation: "Вектор «под ключ» на верхнем основании (середина ребра → противоположная)" },
  ],
  BOX: [
    { label: "name", documentation: "Имя тела" },
    { label: "B (x,y,z)", documentation: "Радиус-вектор вершины параллелепипеда" },
    { label: "P1 (x,y,z)", documentation: "Вектор первого ребра из вершины B (направление и длина)" },
    { label: "P2 (x,y,z)", documentation: "Вектор второго ребра из вершины B" },
    { label: "P3 (x,y,z)", documentation: "Вектор третьего ребра из вершины B" },
  ],
  ELL: [
    { label: "name", documentation: "Имя тела" },
    { label: "C1 (x,y,z)", documentation: "Фокус 1 (или центр, если D < 0)" },
    { label: "C2 (x,y,z)", documentation: "Фокус 2 (или вектор полуоси вращения, если D < 0)" },
    { label: "D", documentation: "D>0 — малая полуось; D<0 — другая полуось, |D|" },
  ],
  WED: [
    { label: "name", documentation: "Имя тела" },
    { label: "B (x,y,z)", documentation: "Радиус-вектор вершины" },
    { label: "P1 (x,y,z)", documentation: "Ребро основания из B" },
    { label: "P2 (x,y,z)", documentation: "Второе ребро основания из B" },
    { label: "P3 (x,y,z)", documentation: "Образующая (ребро из B, не в основании)" },
  ],
  UCX: [
    { label: "name", documentation: "Имя тела" },
    { label: "Y", documentation: "Координата оси на OYZ" },
    { label: "Z", documentation: "Координата оси на OYZ" },
    { label: "R", documentation: "Радиус" },
  ],
  UCY: [
    { label: "name", documentation: "Имя тела" },
    { label: "X", documentation: "Координата оси" },
    { label: "Z", documentation: "Координата оси" },
    { label: "R", documentation: "Радиус" },
  ],
  UCZ: [
    { label: "name", documentation: "Имя тела" },
    { label: "X", documentation: "Координата оси" },
    { label: "Y", documentation: "Координата оси" },
    { label: "R", documentation: "Радиус" },
  ],
  SLA: [
    { label: "name", documentation: "Имя тела" },
    { label: "C (x,y,z)", documentation: "Точка на одной из плоскостей" },
    { label: "P (x,y,z)", documentation: "Перпендикуляр к ближайшей точке второй плоскости" },
  ],
  SLB: [
    { label: "name", documentation: "Имя тела" },
    { label: "N (x,y,z)", documentation: "Вектор, перпендикулярный слою" },
    { label: "A", documentation: "Знаковое расстояние до первой плоскости (A < B)" },
    { label: "B", documentation: "Знаковое расстояние до второй плоскости" },
  ],
  REC: [
    { label: "name", documentation: "Имя тела" },
    { label: "C (x,y,z)", documentation: "Центр нижнего основания" },
    { label: "H (x,y,z)", documentation: "Вектор высоты" },
    { label: "R1 (x,y,z)", documentation: "Большая полуось эллипса" },
    { label: "R2 (x,y,z)", documentation: "Малая полуось эллипса" },
  ],
  TRC: [
    { label: "name", documentation: "Имя тела" },
    { label: "C (x,y,z)", documentation: "Центр нижнего основания" },
    { label: "H (x,y,z)", documentation: "Вектор высоты" },
    { label: "R1", documentation: "Радиус нижнего основания" },
    { label: "R2", documentation: "Радиус верхнего основания" },
  ],
  PLG: [
    { label: "id", documentation: "Номер полуплоскости" },
    { label: "nx,ny,nz", documentation: "Нормаль" },
    { label: "Q", documentation: "Смещение (n·x) ≥ Q" },
  ],
  PLX: [
    { label: "name", documentation: "Имя полуплоскости" },
    { label: "X0", documentation: "Полупространство X ≥ X0" },
  ],
  PLY: [
    { label: "name", documentation: "Имя полуплоскости" },
    { label: "Y0", documentation: "Полупространство Y ≥ Y0" },
  ],
  PLZ: [
    { label: "name", documentation: "Имя полуплоскости" },
    { label: "Z0", documentation: "Полупространство Z ≥ Z0" },
  ],
  SBOX: [
    { label: "name", documentation: "Имя тела" },
    { label: "P1 (x,y,z)", documentation: "Вектор первого ребра (вершина в начале координат)" },
    { label: "P2 (x,y,z)", documentation: "Вектор второго ребра" },
    { label: "P3 (x,y,z)", documentation: "Вектор третьего ребра" },
  ],
  SHEX: [
    { label: "name", documentation: "Имя тела" },
    { label: "S", documentation: "Размер под ключ" },
    { label: "H", documentation: "Высота" },
    { label: "f", documentation: "Угол поворота" },
  ],
  ARB: [
    { label: "name", documentation: "Имя тела" },
    { label: "vertices", documentation: "Вершины x,y,z …" },
    { label: "/ faces", documentation: "Грани после /" },
  ],
  QUAD: [
    { label: "name", documentation: "Имя тела" },
    { label: "a…f", documentation: "Коэффициенты квадратичной формы" },
    { label: "/ или cx,cy,cz,d", documentation: "Альтернативный формат после /" },
  ],
  TRANSF: [
    { label: "newName", documentation: "Имя нового тела" },
    { label: "protoName", documentation: "Имя тела-прототипа" },
    { label: "M|R", documentation: "Буква типа: M — отражение от вертикальной плоскости, R — поворот вокруг вертикали. Не координата." },
    { label: "A B f", documentation: "Точка симметрии (A,B,0) в OXY (через неё плоскость M или ось R) и угол f° к OX (у M наклон плоскости, у R угол поворота)" },
  ],
  UPOLY: [
    { label: "name", documentation: "Имя кривой" },
    { label: "p1", documentation: "Параметр 1" },
    { label: "p2", documentation: "Параметр 2" },
  ],
};

export function getBodyParamGroups(bodyKey: string): BodyParamGroup[] | undefined {
  return BODY_PARAM_GROUPS[bodyKey.toUpperCase()];
}
