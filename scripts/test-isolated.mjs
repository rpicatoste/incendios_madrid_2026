import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const testRoot = await mkdtemp(join(tmpdir(), "foco-test-"));
const projectEntries = [
  ".openai",
  "app",
  "build",
  "lib",
  "ops",
  "public",
  "tests",
  "worker",
  "Dockerfile",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "tsconfig.json",
  "vite.config.ts",
];

const run = (command, args) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: testRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          signal
            ? `${command} terminó por la señal ${signal}`
            : `${command} terminó con código ${code ?? "desconocido"}`,
        ),
      );
    });
  });

try {
  await Promise.all(
    projectEntries.map((entry) =>
      cp(join(projectRoot, entry), join(testRoot, entry), {
        recursive: true,
        preserveTimestamps: true,
      }),
    ),
  );
  await symlink(join(projectRoot, "node_modules"), join(testRoot, "node_modules"), "dir");
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
  await run(process.execPath, ["--test", "tests/rendered-html.test.mjs"]);
} finally {
  if (!basename(testRoot).startsWith("foco-test-")) {
    throw new Error("Se rechazó limpiar una ruta temporal inesperada");
  }
  await rm(testRoot, { recursive: true, force: true });
}
