import { closeMainWindow, showHUD } from "@raycast/api";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const homebrewFishPath = "/opt/homebrew/bin/fish";
const createDocsScript =
  "set doc_url (lark-cli docs --api-version v2 +create --parent-token ZSNOwB4fKiRO80kxQVDcZgAinEh --content '<title>Untitled</title>' | jq -r '.data.document.url // .data.doc_url'); open \"$doc_url\"";

export default async function Command() {
  await closeMainWindow();

  const fishCommand = existsSync(homebrewFishPath) ? homebrewFishPath : "fish";
  const child = spawn(fishCommand, ["-c", createDocsScript], {
    detached: true,
    stdio: "ignore",
  });

  child.once("error", async (error) => {
    await showHUD(`Failed to create docs: ${error.message}`);
  });

  child.unref();
}
