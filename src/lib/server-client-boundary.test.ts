import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A SERVER component (a file without "use client") may import a COMPONENT from a "use client" file -
// Next turns it into a client reference it can render. It may NOT import a plain function or constant
// from one: on the server that import is a client-reference stub, and calling it crashes at runtime
// ("Attempted to call formatDay() from the server but formatDay is on the client"). Nothing else in
// the pipeline sees this: TypeScript types the import normally, lint has no rule for it, and
// `next build` only compiles - it never runs a dynamic page's code. So this scans the source.
//
// An import is allowed only if its local name is used as a JSX tag (<Name ...>) - i.e. it is a
// component. Type-only imports are erased and always allowed.

const root = path.resolve(import.meta.dirname, "../..");
const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

const isClientFile = (code: string) => /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*["']use client["']/.test(code);

function resolveModule(fromFile: string, spec: string, srcRoot: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(srcRoot, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // a package
  for (const ext of ["", ...EXTENSIONS]) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface Violation {
  file: string;
  name: string;
  from: string;
}

// Every value import in `code` from a module `isClient` says is a client module, whose local name is
// never used as a JSX tag.
export function boundaryViolations(
  file: string,
  code: string,
  srcRoot: string,
  isClientModule: (resolved: string) => boolean,
): Violation[] {
  if (isClientFile(code)) return []; // a client file may import anything
  const out: Violation[] = [];
  const importRe = /import\s+(type\s+)?([^;'"]+?)\s+from\s+["']([^"']+)["']/g;
  for (const m of code.matchAll(importRe)) {
    if (m[1]) continue; // `import type ...`
    const resolved = resolveModule(file, m[3], srcRoot);
    if (!resolved || !isClientModule(resolved)) continue;

    const clause = m[2].trim();
    const names: string[] = [];
    const named = clause.match(/\{([\s\S]*)\}/);
    const outside = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, " ").trim();
    if (outside) names.push(outside.replace(/^\*\s+as\s+/, ""));
    if (named) {
      for (const part of named[1].split(",")) {
        const p = part.trim();
        if (!p || p.startsWith("type ")) continue;
        names.push(p.split(/\s+as\s+/).pop()!.trim());
      }
    }
    for (const name of names) {
      const usedAsComponent = new RegExp(`<${name}[\\s/>.]`).test(code);
      if (!usedAsComponent) out.push({ file, name, from: m[3] });
    }
  }
  return out;
}

const read = (p: string) => fs.readFileSync(p, "utf8");
const srcRoot = path.join(root, "src");
const isClientModule = (resolved: string) => isClientFile(read(resolved));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// The statement components: everything in components/dashboard about statements, and the pages under
// /dashboard/expenses/statements.
function statementFiles(): string[] {
  const components = walk(path.join(srcRoot, "components/dashboard")).filter((f) =>
    /statement/.test(path.basename(f)) && /\.tsx$/.test(f),
  );
  const pages = walk(path.join(srcRoot, "app/(app)/dashboard/expenses/statements")).filter((f) => /\.tsx$/.test(f));
  return [...components, ...pages];
}

test("no statement server component imports a function or constant from a 'use client' file", () => {
  const files = statementFiles();
  assert.ok(files.length >= 8, `expected the statement components, found ${files.length}`);
  const violations = files.flatMap((f) => boundaryViolations(f, read(f), srcRoot, isClientModule));
  assert.deepEqual(
    violations.map((v) => `${path.relative(root, v.file)}: imports '${v.name}' from '${v.from}' ('use client') but never renders it as a component`),
    [],
  );
});

test("the same rule holds for every server component in the app (an audit, so a new one can't slip in elsewhere)", () => {
  const files = [...walk(path.join(srcRoot, "components")), ...walk(path.join(srcRoot, "app"))].filter((f) => /\.tsx$/.test(f));
  const violations = files.flatMap((f) => boundaryViolations(f, read(f), srcRoot, isClientModule));
  assert.deepEqual(
    violations.map((v) => `${path.relative(root, v.file)}: '${v.name}' from '${v.from}'`),
    [],
  );
});

// ---- the checker itself: it must catch the real mistake and not cry wolf -----------------------------

function fixture(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-"));
  for (const [name, code] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), code);
  }
  const client = (resolved: string) => isClientFile(fs.readFileSync(resolved, "utf8"));
  const check = (name: string) => boundaryViolations(path.join(dir, name), fs.readFileSync(path.join(dir, name), "utf8"), dir, client);
  return { check, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("catches the actual bug: a server component calling a function it imported from a 'use client' file", () => {
  const f = fixture({
    "components/client.tsx": `"use client";\nexport function formatDay(d: string) { return d; }\nexport function Row() { return null; }\n`,
    "components/list.tsx": `import { formatDay } from "@/components/client";\nexport function List() { return <p>{formatDay("x")}</p>; }\n`,
  });
  try {
    assert.deepEqual(f.check("components/list.tsx").map((v) => v.name), ["formatDay"]);
  } finally {
    f.cleanup();
  }
});

test("does not flag components, type imports, a client file's own imports, or a shared pure module", () => {
  const f = fixture({
    "components/client.tsx": `"use client";\nexport function formatDay(d: string) { return d; }\nexport function Row() { return null; }\nexport type Props = { a: 1 };\n`,
    "lib/format.ts": `export function formatDay(d: string) { return d; }\n`,
    "components/ok-server.tsx": `import { Row, type Props } from "@/components/client";\nimport type { Props as P2 } from "@/components/client";\nimport { formatDay } from "@/lib/format";\nexport function Ok(_p: Props) { return <Row a={formatDay("x")} />; }\n`,
    "components/ok-client.tsx": `"use client";\nimport { formatDay } from "@/components/client";\nexport function C() { return formatDay("x"); }\n`,
    "components/aliased.tsx": `import { Row as Line } from "@/components/client";\nexport function A() { return <Line />; }\n`,
  });
  try {
    for (const name of ["components/ok-server.tsx", "components/ok-client.tsx", "components/aliased.tsx"]) {
      assert.deepEqual(f.check(name), [], name);
    }
  } finally {
    f.cleanup();
  }
});

test("catches a default import, an aliased function, a namespace import and a constant", () => {
  const f = fixture({
    "components/client.tsx": `"use client";\nexport const LIMIT = 5;\nexport function helper() { return 1; }\nexport default function Thing() { return null; }\n`,
    "components/a.tsx": `import { helper as h } from "@/components/client";\nexport const x = h();\n`,
    "components/b.tsx": `import { LIMIT } from "@/components/client";\nexport const y = LIMIT;\n`,
    "components/c.tsx": `import * as c from "@/components/client";\nexport const z = c.helper();\n`,
    "components/d.tsx": `import Thing from "@/components/client";\nexport function D() { return <Thing />; }\n`,
  });
  try {
    assert.deepEqual(f.check("components/a.tsx").map((v) => v.name), ["h"]);
    assert.deepEqual(f.check("components/b.tsx").map((v) => v.name), ["LIMIT"]);
    assert.deepEqual(f.check("components/c.tsx").map((v) => v.name), ["c"]);
    assert.deepEqual(f.check("components/d.tsx"), [], "a default-exported component is fine");
  } finally {
    f.cleanup();
  }
});

// The same class of mistake in the other direction: a server component can't hand a FUNCTION to a
// component as a prop ("Functions cannot be passed directly to Client Components") - which is what an
// event handler like onClick={...} is. Only the statement files, where server components are new.
test("no statement server component passes an event handler (onClick={...}) - those belong in client components", () => {
  const offenders: string[] = [];
  for (const file of statementFiles()) {
    const code = read(file);
    if (isClientFile(code)) continue;
    for (const m of code.matchAll(/\s(on[A-Z][A-Za-z]*)=\{/g)) offenders.push(`${path.relative(root, file)}: ${m[1]}`);
  }
  assert.deepEqual(offenders, []);
});
