"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BODY_PARAM_GROUPS = void 0;
exports.getBodyParamGroups = getBodyParamGroups;
exports.BODY_PARAM_GROUPS = {
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
    BOX: [
        { label: "name", documentation: "Имя тела" },
        { label: "x,y,z", documentation: "Вершина параллелепипеда" },
        { label: "e1", documentation: "Первое ребро" },
        { label: "e2", documentation: "Второе ребро" },
        { label: "e3", documentation: "Третье ребро" },
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
        { label: "e1", documentation: "Первое ребро (вершина в 0)" },
        { label: "e2", documentation: "Второе ребро" },
        { label: "e3", documentation: "Третье ребро" },
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
        { label: "M|R", documentation: "Тип: M — сдвиг, R — поворот" },
        { label: "A B f", documentation: "Параметры преобразования" },
    ],
    UPOLY: [
        { label: "name", documentation: "Имя кривой" },
        { label: "p1", documentation: "Параметр 1" },
        { label: "p2", documentation: "Параметр 2" },
    ],
};
function getBodyParamGroups(bodyKey) {
    return exports.BODY_PARAM_GROUPS[bodyKey.toUpperCase()];
}
//# sourceMappingURL=bodyParamGroups.js.map