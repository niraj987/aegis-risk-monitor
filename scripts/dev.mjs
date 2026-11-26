import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

for (const dir of ["server", "web"]) {
  if (!existsSync(path.join(root, dir, "node_modules"))) {
    console.error(`\n  Missing dependencies in ${dir}/. Run \`npm run setup\` first.\n`);
    process.exit(1);
  }
}

// Some shells export PORT=0 (meaning "any free port"), which would break the
// Next.js proxy. Treat it as unset and pin the documented defaults.
const configuredPort = Number(process.env.PORT);
const apiPort = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4000;

const env = {
  ...process.env,
  PORT: String(apiPort),
  API_URL: process.env.API_URL || `http://127.0.0.1:${apiPort}`,
};

const services = [
  { name: "api", color: "\x1b[36m", cwd: path.join(root, "server"), args: ["run", "dev"] },
  { name: "web", color: "\x1b[35m", cwd: path.join(root, "web"), args: ["run", "dev"] },
];

const children = [];
let shuttingDown = false;

function prefixStream(stream, name, color, target) {
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) target.write(`${color}[${name}]\x1b[0m ${line}\n`);
    }
  });
}

function stop(child) {
  if (!child || child.killed) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach(stop);
  setTimeout(() => process.exit(code), 600);
}

for (const service of services) {
  const child = spawn(npm, service.args, {
    cwd: service.cwd,
    env,
    shell: isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  prefixStream(child.stdout, service.name, service.color, process.stdout);
  prefixStream(child.stderr, service.name, service.color, process.stderr);

  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`\n  ${service.name} stopped (exit ${code ?? 0}); shutting the stack down.\n`);
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("\n  Aegis dev stack");
console.log("  dashboard  http://127.0.0.1:3000");
console.log(`  api        http://127.0.0.1:${apiPort}/api/health\n`);
