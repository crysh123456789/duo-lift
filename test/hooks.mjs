import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const abs = path.join(src, `${specifier.slice(2)}.ts`);
    return nextResolve(pathToFileURL(abs).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
