import type { BurnupLoadAnalysis } from "./burnupLoad";
import type { DocumentAst } from "./ast";
/** SVG: мощность (ступени), сетка шагов/подшагов, накопленная энерговыработка. */
export declare function renderBurnupLoadSvg(analysis: BurnupLoadAnalysis): string;
export declare function burnupLoadSvgDataUri(svg: string): string;
export declare function formatBurnupLoadHover(analysis: BurnupLoadAnalysis, ast?: DocumentAst): string;
