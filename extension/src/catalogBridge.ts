import * as fs from "fs";
import * as path from "path";

export interface CatalogModulePayload {
  id: string;
  title: string;
  marker: string;
  template: string;
  cardGroups: Array<{
    title: string;
    items: Array<{
      label: string;
      title: string;
      syntax: string;
      description: string;
      example?: string;
      insertText: string;
      insertFormat: "snippet" | "plain";
    }>;
  }>;
}

type SchemaModule = {
  buildCatalogPayload: () => CatalogModulePayload[];
};

function loadSchemaModule(): SchemaModule {
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-schema", "index.js"),
    path.join(__dirname, "..", "..", "packages", "mcu-schema", "dist", "index.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(p) as SchemaModule;
    }
  }
  throw new Error("mcu-schema не найден. Выполните npm run build в корне проекта.");
}

let cached: CatalogModulePayload[] | undefined;

export function buildCatalogPayload(): CatalogModulePayload[] {
  if (!cached) {
    cached = loadSchemaModule().buildCatalogPayload();
  }
  return cached;
}
