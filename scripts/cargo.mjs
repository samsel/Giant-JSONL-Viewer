import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cargoName = process.platform === "win32" ? "cargo.exe" : "cargo";
const candidates = [
  process.env.CARGO,
  cargoName,
  path.join(os.homedir(), ".cargo", "bin", cargoName),
  "/opt/homebrew/opt/rustup/bin/cargo",
  "/usr/local/bin/cargo",
].filter(Boolean);

function canRun(command) {
  if (command.includes(path.sep) && !existsSync(command)) return false;
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

const cargo = candidates.find(canRun);

if (!cargo) {
  console.error("Could not find cargo. Install Rust, then run:");
  console.error("  rustup target add wasm32-unknown-unknown");
  process.exit(127);
}

const cargoDir = cargo.includes(path.sep) ? path.dirname(cargo) : "";
const cargoHomeBin = path.join(os.homedir(), ".cargo", "bin");
const pathParts = [cargoDir, cargoHomeBin, process.env.PATH].filter(Boolean);
const env = { ...process.env, PATH: pathParts.join(path.delimiter) };
const result = spawnSync(cargo, process.argv.slice(2), { stdio: "inherit", env });
process.exit(result.status ?? 1);
