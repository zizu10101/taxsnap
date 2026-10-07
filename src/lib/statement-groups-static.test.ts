import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Structural guarantees that no behaviour test can give: the gate is on every new entry point, nothing
// reaches the accountant portal, and the temporary "retry without the new columns" fallbacks are gone.

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

test("every new statement API route is behind STATEMENT_IMPORT_USER_IDS (requireStatementUser)", () => {
  for (const route of [
    "src/app/api/statements/[id]/delete/route.ts",
    "src/app/api/statements/for-receipt/[receiptId]/route.ts",
    "src/app/api/statements/route.ts",
  ]) {
    assert.match(read(route), /requireStatementUser\(\)/, route);
  }
});

test("the Statements pages are behind the same allowlist (getStatementPageCtx -> 404)", () => {
  for (const page of [
    "src/app/(app)/dashboard/expenses/statements/page.tsx",
    "src/app/(app)/dashboard/expenses/statements/[id]/page.tsx",
  ]) {
    const src = read(page);
    assert.match(src, /getStatementPageCtx\(\)/, page);
    assert.match(src, /notFound\(\)/, page);
  }
});

test("nothing from statement grouping reaches the accountant portal", () => {
  const scoped = read("src/lib/scoped-reader.ts");
  assert.doesNotMatch(scoped, /statement_(imports|lines|chunks)/, "statement tables are not in the portal's allowlist");
  for (const dir of ["src/app/accountant", "src/app/api/accountant-portal", "src/components/accountant-portal"]) {
    const walk = (d: string): string[] =>
      fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
      );
    for (const file of walk(dir)) {
      assert.doesNotMatch(read(file), /statement-groups|statement-routes|StatementsList|statement-detail/, file);
    }
  }
});

test("the temporary 'retry without the new columns' fallbacks are gone", () => {
  const walk = (d: string): string[] =>
    fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
    );
  for (const file of walk("src")) {
    if (!/\.(ts|tsx)$/.test(file) || /\.test\.ts$/.test(file)) continue;
    assert.doesNotMatch(read(file), /42703|isMissingColumn/, `${file} still special-cases a missing column`);
  }
});

test("links to statements and expenses are built in one place (statement-routes)", () => {
  for (const file of [
    "src/components/dashboard/statements-list.tsx",
    "src/components/dashboard/statement-detail.tsx",
    "src/components/dashboard/statement-link.tsx",
    "src/components/dashboard/delete-statement-dialog.tsx",
  ]) {
    assert.doesNotMatch(read(file), /["'`]\/dashboard\/expenses\/statements/, `${file} hardcodes a statements path`);
  }
});
