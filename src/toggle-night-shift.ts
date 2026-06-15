import { Toast, closeMainWindow, showToast } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const nightshiftPath = "/usr/local/bin/nightshift";

export default async function Command() {
  if (!existsSync(nightshiftPath)) {
    const error = new Error(`${nightshiftPath} does not exist`);

    await showToast({
      style: Toast.Style.Failure,
      title: "nightshift not found",
      message: error.message,
    });

    throw error;
  }

  try {
    await execFileAsync(nightshiftPath, ["toggle"]);
    await closeMainWindow({ clearRootSearch: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to toggle Night Shift",
      message,
    });

    throw error;
  }
}
