import { showHUD } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const homebrewToggleNotchPath = "/opt/homebrew/bin/togglenotch";

export default async function Command() {
  const command = existsSync(homebrewToggleNotchPath) ? homebrewToggleNotchPath : "togglenotch";

  try {
    await execFileAsync(command);
    await showHUD("Toggled Notch");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await showHUD(`Failed to toggle notch: ${message}`);
    throw error;
  }
}
