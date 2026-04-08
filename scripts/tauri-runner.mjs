import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliEntrypoint = path.resolve(__dirname, "../node_modules/@tauri-apps/cli/tauri.js");
const [, , ...args] = process.argv;
const finalArgs = args.length > 0 ? args : ["dev"];

const child = spawn(process.execPath, [cliEntrypoint, ...finalArgs], {
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_APP_PATH: "desktop"
  }
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
