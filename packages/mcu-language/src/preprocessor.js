"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandIncludes = expandIncludes;
exports.expandRepeats = expandRepeats;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function expandIncludes(text, baseDir) {
    const includes = [];
    const errors = [];
    const includeRe = /^#include\s+<([^>]+)>/im;
    const lines = text.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
        const m = line.match(includeRe);
        if (m && line.trimStart().startsWith("#")) {
            const incPath = m[1];
            includes.push(incPath);
            const full = path.isAbsolute(incPath) ? incPath : path.join(baseDir, incPath);
            try {
                if (!fs.existsSync(full)) {
                    errors.push(`Файл include не найден: ${incPath}`);
                    out.push(line);
                    continue;
                }
                const incText = fs.readFileSync(full, "utf8");
                if (/#include\s+</i.test(incText)) {
                    errors.push(`Вложенный #include запрещён: ${incPath}`);
                }
                out.push(`* --- included from ${incPath} ---`);
                out.push(incText);
                out.push(`* --- end include ${incPath} ---`);
            }
            catch (e) {
                errors.push(`Ошибка чтения include ${incPath}: ${e}`);
                out.push(line);
            }
        }
        else {
            out.push(line);
        }
    }
    return { text: out.join("\n"), includes, errors };
}
function expandRepeats(text) {
    return text.replace(/\[(\d+)\|([^\]]*)\]/g, (_, n, val) => {
        const count = parseInt(n, 10);
        if (count <= 0)
            return "";
        return val.repeat(count);
    });
}
//# sourceMappingURL=preprocessor.js.map