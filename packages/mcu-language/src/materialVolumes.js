"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMaterialVolumes = parseMaterialVolumes;
exports.materialVolumeCm3 = materialVolumeCm3;
exports.buildMaterialMassRows = buildMaterialMassRows;
exports.totalMaterialMassG = totalMaterialMassG;
exports.formatMassG = formatMassG;
exports.specificBurnupMwdPerKg = specificBurnupMwdPerKg;
exports.formatSpecificBurnupMwdPerKg = formatSpecificBurnupMwdPerKg;
exports.formatMaterialMassTable = formatMaterialMassTable;
exports.formatVolCardHover = formatVolCardHover;
const expression_1 = require("./expression");
const bodyVolume_1 = require("./bodyVolume");
const materialDensity_1 = require("./materialDensity");
const burnupLoad_1 = require("./burnupLoad");
function findVolStatement(ast) {
    let last = null;
    for (const stmt of ast.statements) {
        if (stmt.label.toUpperCase() === "VOL")
            last = stmt.text;
    }
    return last;
}
/** Объёмы материалов (см³) по порядку номеров MATR: V1 → материал 1, … */
function parseMaterialVolumes(ast) {
    const text = findVolStatement(ast);
    if (!text)
        return null;
    const vars = new Map();
    for (const c of ast.constants) {
        const v = (0, expression_1.evaluateExpression)(c.expression, vars);
        if (v !== null)
            vars.set(c.name, v);
    }
    const values = (0, burnupLoad_1.parseStatementNumbers)(text, vars);
    return values.length ? values : null;
}
function materialVolumeCm3(volumes, materialNumber) {
    if (!volumes?.length || materialNumber < 1)
        return null;
    const idx = materialNumber - 1;
    if (idx >= volumes.length)
        return null;
    const v = volumes[idx];
    return Number.isFinite(v) && v > 0 ? v : null;
}
function buildMaterialMassRows(ast) {
    const volumes = parseMaterialVolumes(ast);
    const maxVolSlot = volumes?.length ?? 0;
    const maxMatNum = ast.materials.length ? Math.max(...ast.materials.map((m) => m.number)) : 0;
    const limit = Math.max(maxVolSlot, maxMatNum);
    const rows = [];
    for (let n = 1; n <= limit; n++) {
        const mat = ast.materials.find((m) => m.number === n);
        const volumeCm3 = materialVolumeCm3(volumes, n);
        const massDensityGcm3 = mat ? (0, materialDensity_1.computeMaterialMassDensityGcm3)(mat) : null;
        const massG = volumeCm3 != null && massDensityGcm3 != null && massDensityGcm3 > 0
            ? volumeCm3 * massDensityGcm3
            : null;
        if (mat || volumeCm3 != null) {
            rows.push({ number: n, volumeCm3, massDensityGcm3, massG });
        }
    }
    return rows;
}
function totalMaterialMassG(rows) {
    return rows.reduce((s, r) => s + (r.massG ?? 0), 0);
}
function fmtNum(n, digits = 4) {
    if (!Number.isFinite(n))
        return "—";
    if (Math.abs(n) >= 1e4 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3))
        return n.toPrecision(digits);
    return n.toPrecision(digits).replace(/\.?0+$/, "");
}
function formatMassG(massG) {
    if (!Number.isFinite(massG) || massG <= 0)
        return "—";
    if (massG >= 1000)
        return `${fmtNum(massG / 1000)} кг`;
    return `${fmtNum(massG)} г`;
}
/** Удельная энерговыработка: МВт·сут/кг (MW·d/kg). */
function specificBurnupMwdPerKg(energyKwd, totalMassG) {
    if (!Number.isFinite(energyKwd) || energyKwd <= 0)
        return null;
    if (!Number.isFinite(totalMassG) || totalMassG <= 0)
        return null;
    return energyKwd / totalMassG;
}
function formatSpecificBurnupMwdPerKg(energyKwd, totalMassG) {
    const v = specificBurnupMwdPerKg(energyKwd, totalMassG);
    if (v == null)
        return null;
    return `**${fmtNum(v)} МВт·сут/кг** (MW·d/kg)`;
}
function formatMaterialMassTable(rows) {
    if (!rows.length)
        return "";
    const tableRows = rows.map((r) => {
        const vol = r.volumeCm3 != null ? (0, bodyVolume_1.formatBodyVolumeCm3)(r.volumeCm3).replace(" см³", "") : "—";
        const rho = r.massDensityGcm3 != null ? (0, materialDensity_1.formatMassDensityGcm3)(r.massDensityGcm3).replace(" г/см³", "") : "—";
        const mass = r.massG != null ? formatMassG(r.massG) : "—";
        return `| ${r.number} | ${vol} | ${rho} | ${mass} |`;
    });
    const totalG = totalMaterialMassG(rows);
    const lines = [
        "",
        "| MATR | V, см³ | ρ, г/см³ | m |",
        "| --- | --- | --- | --- |",
        ...tableRows,
    ];
    if (totalG > 0) {
        lines.push("", `**Σm:** ${formatMassG(totalG)}`);
    }
    return lines.join("\n");
}
function formatVolCardHover(ast) {
    const volumes = parseMaterialVolumes(ast);
    if (!volumes?.length)
        return "\n\n*Карта VOL не найдена в варианте.*";
    const rows = buildMaterialMassRows(ast);
    const lines = [
        "",
        "---",
        "### Объёмы и массы материалов (VOL)",
        "",
        `Задано **${volumes.length}** объём(ов) (см³) по порядку номеров MATR.`,
        formatMaterialMassTable(rows),
    ];
    return lines.join("\n");
}
//# sourceMappingURL=materialVolumes.js.map