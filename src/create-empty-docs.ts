import { Toast, closeMainWindow, showToast } from "@raycast/api";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const homebrewFishPath = "/opt/homebrew/bin/fish";
const createDocsScript =
  "set doc_url (lark-cli docs --api-version v2 +create --parent-token ZSNOwB4fKiRO80kxQVDcZgAinEh --content '<title>Untitled</title>' | jq -r '.data.document.url // .data.doc_url'); open \"$doc_url\"";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Creating document..." });

  try {
    const fishCommand = existsSync(homebrewFishPath) ? homebrewFishPath : "fish";

    await new Promise<void>((resolve, reject) => {
      const child = spawn(fishCommand, ["-c", createDocsScript], {
        stdio: "ignore",
      });

      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Process exited with code ${code}`));
      });
    });

    toast.style = Toast.Style.Success;
    toast.title = "Document created!";
    await closeMainWindow({ clearRootSearch: true });
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Failed to create document";
    toast.message = error instanceof Error ? error.message : String(error);
  }
}
