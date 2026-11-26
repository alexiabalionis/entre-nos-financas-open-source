import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Spec 7.4 item 8: nenhum consumidor lê ou escreve as tabelas antigas de entrada.
// Só os scripts de migração (src/server/income-migration*.ts) citam os nomes.
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : files(path);
    return /\.(ts|tsx|css|sql|mjs|js)$/.test(e.name) ? [path] : [];
  });
}

test("src e app não citam income_rules nem income_occurrences, exceto a migração", () => {
  const offenders = [...files("src"), ...files("app")].filter(
    (f) => !/^src[\\/]server[\\/]income-migration[^\\/]*\.ts$/.test(f) && /income_rules|income_occurrences/.test(readFileSync(f, "utf8")),
  );
  assert.deepEqual(offenders, []);
});
