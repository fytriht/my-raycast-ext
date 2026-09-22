import { Clipboard, Toast, showToast } from "@raycast/api";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Some applications only publish RTF/HTML, without a plain text representation.
const readRichTextScript = `
ObjC.import("AppKit");
function run() {
  const pasteboard = $.NSPasteboard.generalPasteboard;
  const htmlOptions = $.NSMutableDictionary.alloc.init;
  htmlOptions.setObjectForKey($(Number($.NSUTF8StringEncoding)), $.NSCharacterEncodingDocumentAttribute);
  for (const format of ["RTF", "HTML"]) {
    const type = format === "RTF" ? $.NSPasteboardTypeRTF : $.NSPasteboardTypeHTML;
    const data = pasteboard.dataForType(type);
    if (!data || data.isNil()) continue;
    const attributed = format === "RTF"
      ? $.NSAttributedString.alloc.initWithRTFDocumentAttributes(data, null)
      : $.NSAttributedString.alloc.initWithHTMLOptionsDocumentAttributes(
          data, htmlOptions, null);
    if (attributed && !attributed.isNil()) {
      return JSON.stringify(ObjC.unwrap(attributed.string));
    }
  }
  return "null";
}
`;

export default async function Command() {
  let directory: string | undefined;

  try {
    let text = await Clipboard.readText();
    if (text === undefined || text.length === 0) {
      const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", readRichTextScript], {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 15_000,
      });
      text = (JSON.parse(stdout) as string | null) ?? undefined;
    }

    if (text === undefined || text.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No text in clipboard",
        message: "Copy plain text or rich text first.",
      });
      return;
    }

    directory = await mkdtemp(join(tmpdir(), "raycast-appendix-"));
    const file = join(directory, "appendix.txt");
    await writeFile(file, text, { encoding: "utf8", mode: 0o600 });
    // Keep the file available for applications that read pasted attachments later.
    await Clipboard.paste({ file });
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to paste clipboard as file",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
