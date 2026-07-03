"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_MCU_LABELS = exports.MCU_LABEL_ALIASES = exports.MCU_LABELS_BY_FRAGMENT = void 0;
exports.normalizeMcuLabel = normalizeMcuLabel;
exports.detectFragmentFromLabel = detectFragmentFromLabel;
exports.isKnownMcuLabel = isKnownMcuLabel;
exports.listAllMcuLabels = listAllMcuLabels;
/** Канонические имена карт MCU-NR (как в UserGuide 220519) + распространённые варианты из RUNTEST */
exports.MCU_LABELS_BY_FRAGMENT = {
    shared: [
        "FINISH",
        "END",
        "STOP",
        "SHOW",
        "V01",
        "VOL",
        "STEP",
        "LIST",
        "TYPE",
        "LATT",
        "BOUN",
        "ROOT",
        "NORM",
        "FUNC",
        "ENDL",
        "ENDXCL",
        "LISTEL",
        "PARM",
        "TRANSF",
    ],
    physical: [
        "PIN",
        "MATR",
        "DEF",
        "TEMPR",
        "NEUT",
        "DELN",
        "EGRC",
        "SINOT",
        "SIDEN",
        "SI",
        "ICE",
        "ICENOT",
        "CPM",
        "CPMEND",
        "PSIN",
        "PSGR",
        "MATFIL",
        "MATPRN",
        "SIPRN",
        "DEFPRN",
        "MATWGT",
        "MATREP",
        "ACEPT",
        "ACERR",
        "PHOT",
        "WPHO",
        "IWPHN",
        "EGPH",
        "ELEC",
        "EGEL",
        "EMES",
        "EPRO",
        "EDIS",
        "ECUP",
    ],
    geometry: [
        "HEAD",
        "CONT",
        "MIR",
        "CNTAND",
        "EQU",
        "SET",
        "CELL",
        "NET",
        "LCELL",
        "LISTEL",
        "PARM",
        "V01",
    ],
    source: [
        "SRCD",
        "SRC",
        "SPNT",
        "ENSO",
        "ESET",
        "SPEC",
        "NPS",
        "PROB",
        "ANGLEN",
        "MDIS",
        "EDIS",
        "MMES",
        "MPRO",
        "EMES",
        "EPRO",
        "SNAM",
        "REPER",
        "NOBJ",
        "LOBJ",
        "WOBJ",
        "ELEM",
        "HGRI",
        "HPC",
        "RGRI",
        "RPC",
        "RCZD",
        "PRISOU",
        "BOUN",
        "ROOT",
        "NORM",
        "FUNC",
    ],
    registration: [
        "REGD",
        "REG",
        "RGS",
        "KEFF",
        "LIFE",
        "BAL",
        "MOM4",
        "BUCL",
        "BCRIT",
        "EABS",
        "MNEN",
        "ZNEN",
        "ONEN",
        "MPHEN",
        "ZPHEN",
        "OPHEN",
        "MELEN",
        "ZELEN",
        "OELEN",
        "NUCOFF",
        "PERC",
        "FIXED",
        "NRET",
        "NREG",
        "PTYPE",
        "TTYPE",
        "MSMT",
        "OSMT",
        "ENERG",
        "ENERGY",
        "SPECTR",
        "SFLUX",
        "DPNT",
        "DRING",
        "NENRG",
        "NFUNC",
        "PENRG",
        "PFUNC",
        "DOS",
        "MDOS",
        "ZDOS",
        "ODOS",
        "MCUR",
        "ZCUR",
        "OCUR",
        "MFLU",
        "ZFLU",
        "OFLU",
        "MRCT",
        "ZRCT",
        "ORCT",
        "RCT",
        "REACT",
        "GROU",
        "GRBL",
        "GRBU",
        "GRIN",
        "GZAZI",
        "GZAZO",
        "CNTU",
        "CROD",
        "ZELCH",
        "ZPOCH",
        "ZPOEN",
        "ZSMT",
        "ZRTB",
    ],
    burnupRegistration: ["BRGD", "BRG", "BURALL", "BMAX", "BUCL", "VOL"],
    trajectory: [
        "TRJD",
        "TRJ",
        "ISTR",
        "NTOT",
        "NBAT",
        "NBATCH",
        "NSKI",
        "WTOB",
        "MIXG",
        "WWEN",
        "INPE",
        "INPO",
        "XYZ0",
        "RADS",
        "INPM",
        "SANG",
        "INRA",
        "SETT",
    ],
    calculationControl: [
        "CALD",
        "CAL",
        "NAMV",
        "NAMVAR",
        "MAXS",
        "MAXSER",
        "DTZM",
        "DTZML",
        "NPRI",
        "NPRINT",
        "NPRIN",
        "BETA",
        "NRAN",
        "ECUT",
        "ECUP",
        "ECEL",
        "ECPO",
        "SERIES",
        "WWEN",
        "INPE",
        "INPO",
        "SETT",
    ],
    burnup: [
        "BURD",
        "BURN",
        "BURNUP",
        "PBUR",
        "CODE",
        "FISZ",
        "FISZON",
        "ABSZ",
        "POWZ",
        "POWE",
        "POWER",
        "DPOW",
        "FLUX",
        "DSTP",
        "COLI",
        "EPSM",
        "EOPT",
        "CLEZ",
        "CLEF",
        "ADDZ",
        "ADDF",
        "TIMP",
        "TSEC",
        "TMIN",
        "THOU",
        "TDAY",
        "TYEA",
        "GLIB",
        "ZONP",
        "ZONPRI",
        "SUMZ",
        "SUMZON",
        "CONT",
        "CONTEN",
        "ACTI",
        "FISP",
        "PARA",
        "SIZI",
        "LIST",
        "FINAL",
        "DELAY",
        "FINTAB",
        "DELTAB",
        "FINDEN",
        "SOURCE",
        "SHORT",
    ],
};
/** Длинные/альтернативные имена из реальных вариантов → канон из UserGuide */
exports.MCU_LABEL_ALIASES = {
    NAMVAR: "NAMV",
    MAXSER: "MAXS",
    DTZML: "DTZM",
    NPRINT: "NPRI",
    NPRIN: "NPRI",
    ENERG: "ENERGY",
    FISZON: "FISZ",
    POWER: "POWE",
    ZONPRI: "ZONP",
    SUMZON: "SUMZ",
    // CONTEN — отдельная карта выгорания, не путать с геом. CONT
    NBAT: "NBATCH",
    REG: "REGD",
    SRC: "SRCD",
    TRJ: "TRJD",
    CAL: "CALD",
    BURD: "BURN",
    BURNUP: "BURN",
    BRGD: "BRG",
};
const _all = new Set();
for (const group of Object.values(exports.MCU_LABELS_BY_FRAGMENT)) {
    for (const label of group) {
        _all.add(label.toUpperCase());
    }
}
for (const alias of Object.keys(exports.MCU_LABEL_ALIASES)) {
    _all.add(alias.toUpperCase());
}
/** Все известные метки карт (верхний регистр), не считаются именами геометрических зон */
exports.ALL_MCU_LABELS = _all;
function normalizeMcuLabel(label) {
    const u = label.toUpperCase();
    return exports.MCU_LABEL_ALIASES[u] ?? u;
}
const FRAGMENT_LABEL_MAP = [
    { id: "physical", labels: exports.MCU_LABELS_BY_FRAGMENT.physical },
    { id: "geometry", labels: exports.MCU_LABELS_BY_FRAGMENT.geometry },
    { id: "source", labels: exports.MCU_LABELS_BY_FRAGMENT.source },
    { id: "registration", labels: exports.MCU_LABELS_BY_FRAGMENT.registration },
    { id: "burnupRegistration", labels: exports.MCU_LABELS_BY_FRAGMENT.burnupRegistration },
    { id: "trajectory", labels: exports.MCU_LABELS_BY_FRAGMENT.trajectory },
    { id: "calculationControl", labels: exports.MCU_LABELS_BY_FRAGMENT.calculationControl },
    { id: "burnup", labels: exports.MCU_LABELS_BY_FRAGMENT.burnup },
];
const _fragmentByLabel = new Map();
for (const { id, labels } of FRAGMENT_LABEL_MAP) {
    for (const raw of labels) {
        const u = raw.toUpperCase();
        _fragmentByLabel.set(u, id);
        const canon = exports.MCU_LABEL_ALIASES[u];
        if (canon)
            _fragmentByLabel.set(canon, id);
    }
}
for (const [alias, canon] of Object.entries(exports.MCU_LABEL_ALIASES)) {
    const frag = _fragmentByLabel.get(canon);
    if (frag)
        _fragmentByLabel.set(alias.toUpperCase(), frag);
}
/** Явные маркеры начала фрагмента (приоритетные) */
const FRAGMENT_STARTERS = {
    PIN: "physical",
    HEAD: "geometry",
    CONT: "geometry",
    MIR: "geometry",
    SRCD: "source",
    SRC: "source",
    SPNT: "source",
    RGS: "registration",
    REGD: "registration",
    REG: "registration",
    BRG: "burnupRegistration",
    BRGD: "burnupRegistration",
    TRJD: "trajectory",
    TRJ: "trajectory",
    NTOT: "trajectory",
    NAMV: "calculationControl",
    NAMVAR: "calculationControl",
    CALD: "calculationControl",
    CAL: "calculationControl",
    BURN: "burnup",
    BURD: "burnup",
    BURNUP: "burnup",
};
function detectFragmentFromLabel(label, current) {
    const u = label.toUpperCase();
    if (FRAGMENT_STARTERS[u])
        return FRAGMENT_STARTERS[u];
    const mapped = _fragmentByLabel.get(u);
    if (mapped)
        return mapped;
    if (u.startsWith("BUR") || u === "FINAL" || u === "DELAY")
        return "burnup";
    return current;
}
function isKnownMcuLabel(label) {
    return exports.ALL_MCU_LABELS.has(label.toUpperCase());
}
/** Для подсветки и cSpell: отсортированный список */
function listAllMcuLabels() {
    return [...exports.ALL_MCU_LABELS].sort();
}
//# sourceMappingURL=keywords.js.map