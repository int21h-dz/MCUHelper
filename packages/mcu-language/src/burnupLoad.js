"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStatementNumbers = parseStatementNumbers;
exports.parsePowePlateaus = parsePowePlateaus;
exports.parseStepPlateausCumulative = parseStepPlateausCumulative;
exports.parseDstpPlateaus = parseDstpPlateaus;
exports.isIncrementalStepTimeValues = isIncrementalStepTimeValues;
exports.parseStepPlateaus = parseStepPlateaus;
exports.powerAtTime = powerAtTime;
exports.integrateEnergyKwd = integrateEnergyKwd;
exports.collectBurnupTimeKnots = collectBurnupTimeKnots;
exports.getBurnupLoadAnalysis = getBurnupLoadAnalysis;
exports.formatEnergyOutput = formatEnergyOutput;
const expression_1 = require("./expression");
function buildVars(ast) {
    const vars = new Map();
    for (const c of ast.constants) {
        const v = (0, expression_1.evaluateExpression)(c.expression, vars);
        if (v !== null)
            vars.set(c.name, v);
    }
    return vars;
}
function parseStatementNumbers(text, vars) {
    const rest = text.trim().replace(/^\S+\s*/, "");
    const out = [];
    for (const part of rest.split(/[\s,]+/).filter(Boolean)) {
        const v = (0, expression_1.evaluateExpression)(part, vars);
        if (v !== null)
            out.push(v);
        else {
            const n = parseFloat(part);
            if (Number.isFinite(n))
                out.push(n);
        }
    }
    return out;
}
/** POWE/POWER: пары q (кВт), t (сут) — верхняя граница интервала; одно q — постоянная мощность. */
function parsePowePlateaus(values) {
    if (!values.length)
        return [];
    if (values.length === 1)
        return [{ qKw: values[0], tEndDays: Number.POSITIVE_INFINITY }];
    const plateaus = [];
    for (let i = 0; i < values.length; i += 2) {
        const qKw = values[i];
        const tEndDays = i + 1 < values.length ? values[i + 1] : Number.POSITIVE_INFINITY;
        plateaus.push({ qKw, tEndDays });
    }
    return plateaus;
}
/** STEP: пары t (сут, накопленное T), n — число шагов на отрезке Ti−1…Ti (T0=0). */
function parseStepPlateausCumulative(values) {
    if (!values.length)
        return [];
    if (values.length === 1) {
        return [{ tEndDays: values[0], stepCount: 1, dtDays: values[0] }];
    }
    const plateaus = [];
    let prevT = 0;
    for (let i = 0; i < values.length; i += 2) {
        const tEndDays = values[i];
        const stepCount = i + 1 < values.length ? Math.max(1, Math.round(values[i + 1])) : 1;
        const span = Math.max(0, tEndDays - prevT);
        plateaus.push({ tEndDays, stepCount, dtDays: span / stepCount });
        prevT = tEndDays;
    }
    return plateaus;
}
/** DSTP: пары t — длина отрезка (сут), n — число шагов на нём. */
function parseDstpPlateaus(values) {
    if (!values.length)
        return [];
    if (values.length === 1) {
        return [{ tEndDays: values[0], stepCount: 1, dtDays: values[0] }];
    }
    const plateaus = [];
    let cumulative = 0;
    for (let i = 0; i < values.length; i += 2) {
        const span = values[i];
        const stepCount = i + 1 < values.length ? Math.max(1, Math.round(values[i + 1])) : 1;
        cumulative += span;
        plateaus.push({ tEndDays: cumulative, stepCount, dtDays: span / stepCount });
    }
    return plateaus;
}
/**
 * Если границы t убывают (20, 3, 10, 2) — это длины отрезков, как DSTP, а не накопленное STEP.
 */
function isIncrementalStepTimeValues(values) {
    for (let i = 2; i < values.length; i += 2) {
        if (values[i] < values[i - 2])
            return true;
    }
    return false;
}
function parseStepPlateaus(values, incremental) {
    const useIncremental = incremental ?? isIncrementalStepTimeValues(values);
    return useIncremental ? parseDstpPlateaus(values) : parseStepPlateausCumulative(values);
}
function powerAtTime(plateaus, tDays) {
    if (!plateaus.length)
        return 0;
    for (const p of plateaus) {
        if (tDays <= p.tEndDays)
            return p.qKw;
    }
    return plateaus[plateaus.length - 1].qKw;
}
function integrateEnergyKwd(plateaus, tMaxDays) {
    if (tMaxDays <= 0 || !plateaus.length)
        return 0;
    const bounds = new Set([0, tMaxDays]);
    for (const p of plateaus) {
        if (p.tEndDays > 0 && p.tEndDays < tMaxDays)
            bounds.add(p.tEndDays);
    }
    const sorted = Array.from(bounds).sort((a, b) => a - b);
    let energy = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
        const t0 = sorted[i];
        const t1 = sorted[i + 1];
        const q = powerAtTime(plateaus, t0 + 1e-9);
        energy += q * (t1 - t0);
    }
    return energy;
}
/** Узлы времени: границы мощности, шагов и подшагов. */
function collectBurnupTimeKnots(analysis) {
    const knots = new Set([0, analysis.totalTimeDays]);
    for (const p of analysis.powerPlateaus) {
        if (Number.isFinite(p.tEndDays) && p.tEndDays > 0 && p.tEndDays < analysis.totalTimeDays) {
            knots.add(p.tEndDays);
        }
    }
    let t0 = 0;
    for (const seg of analysis.stepPlateaus) {
        for (let k = 1; k < seg.stepCount; k++) {
            knots.add(t0 + k * seg.dtDays);
        }
        knots.add(seg.tEndDays);
        t0 = seg.tEndDays;
    }
    return Array.from(knots)
        .filter((t) => t >= 0 && t <= analysis.totalTimeDays + 1e-9)
        .sort((a, b) => a - b);
}
function findStatement(ast, labels) {
    const set = new Set(labels.map((l) => l.toUpperCase()));
    let last = null;
    for (const stmt of ast.statements) {
        if (set.has(stmt.label.toUpperCase())) {
            last = { label: stmt.label.toUpperCase(), text: stmt.text };
        }
    }
    return last;
}
function getBurnupLoadAnalysis(ast) {
    const vars = buildVars(ast);
    const powerText = findStatement(ast, ["POWER", "POWE"])?.text ?? null;
    const stepStmt = findStatement(ast, ["STEP", "DSTP"]);
    const stepText = stepStmt?.text ?? null;
    if (!powerText && !stepText)
        return null;
    const powerPlateaus = powerText ? parsePowePlateaus(parseStatementNumbers(powerText, vars)) : [];
    const stepValues = stepText ? parseStatementNumbers(stepText, vars) : [];
    const stepIncremental = stepStmt?.label === "DSTP" || (stepValues.length > 0 && isIncrementalStepTimeValues(stepValues));
    const stepPlateaus = stepValues.length ? parseStepPlateaus(stepValues, stepIncremental) : [];
    const totalTimeDays = stepPlateaus.length ? stepPlateaus[stepPlateaus.length - 1].tEndDays : 0;
    const totalSteps = stepPlateaus.reduce((s, p) => s + p.stepCount, 0);
    if (!powerPlateaus.length && !stepPlateaus.length)
        return null;
    const effectivePlateaus = powerPlateaus.length > 0
        ? powerPlateaus
        : [{ qKw: 0, tEndDays: totalTimeDays > 0 ? totalTimeDays : Number.POSITIVE_INFINITY }];
    const tMax = totalTimeDays > 0
        ? totalTimeDays
        : effectivePlateaus.some((p) => Number.isFinite(p.tEndDays))
            ? Math.max(...effectivePlateaus.filter((p) => Number.isFinite(p.tEndDays)).map((p) => p.tEndDays))
            : 0;
    const totalEnergyKwd = tMax > 0 ? integrateEnergyKwd(effectivePlateaus, tMax) : 0;
    return {
        powerPlateaus: effectivePlateaus,
        stepPlateaus,
        stepIncremental,
        totalTimeDays: tMax,
        totalSteps,
        totalEnergyKwd,
    };
}
function fmtNum(n, digits = 4) {
    if (!Number.isFinite(n))
        return "∞";
    if (Math.abs(n) >= 1e4 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3))
        return n.toPrecision(digits);
    const s = n.toPrecision(digits).replace(/\.?0+$/, "");
    return s;
}
function formatEnergyOutput(kwd) {
    const kwh = kwd * 24;
    const mwh = kwh / 1000;
    if (mwh >= 0.01) {
        return `**${fmtNum(kwd)} кВт·сут** (${fmtNum(kwh)} кВт·ч ≈ ${fmtNum(mwh)} МВт·ч)`;
    }
    return `**${fmtNum(kwd)} кВт·сут** (${fmtNum(kwh)} кВт·ч)`;
}
//# sourceMappingURL=burnupLoad.js.map