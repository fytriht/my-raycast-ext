import { Action, ActionPanel, List, showHUD, showToast, Toast } from "@raycast/api";
import { execFile } from "node:child_process";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { useEffect, useState } from "react";

const execFileAsync = promisify(execFile);
const m1ddcPath = "/opt/homebrew/bin/m1ddc";
let m1ddcQueue: Promise<void> = Promise.resolve();
const quickBrightnessLevels = ["24", "30", "36", "40", "48", "60"] as const;
const quickBrightnessShortcuts = ["1", "2", "3", "4", "5", "6"] as const;

function parseBrightness(value: string) {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Brightness must be an integer from 0 to 100.");
  }

  const brightness = Number(trimmed);

  if (brightness < 0 || brightness > 100) {
    throw new Error("Brightness must be between 0 and 100.");
  }

  return String(brightness);
}

function validateManualBrightness(value: string) {
  if (!value) {
    return undefined;
  }

  try {
    return { brightness: parseBrightness(value) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Brightness must be an integer from 0 to 100.",
    };
  }
}

function parseM1ddcBrightness(output: string) {
  const value = output.trim();

  if (!value) {
    throw new Error(`Unexpected m1ddc output: ${output}`);
  }

  return parseBrightness(value);
}

function getCommandEnv() {
  return {
    ...process.env,
    PATH: ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH].filter(Boolean).join(":"),
  };
}

async function runM1ddc(args: string[]) {
  const previousCommand = m1ddcQueue;
  let releaseCommand: () => void;
  m1ddcQueue = new Promise((resolve) => {
    releaseCommand = resolve;
  });

  try {
    await previousCommand;
    const { stdout, stderr } = await execFileAsync(m1ddcPath, args, {
      env: getCommandEnv(),
    });

    return (stdout || stderr).trim();
  } catch (error) {
    const commandError = error as Error & {
      stderr?: string;
      stdout?: string;
    };
    const output = commandError.stderr?.trim() || commandError.stdout?.trim() || commandError.message;

    throw Object.assign(new Error(`${[m1ddcPath, ...args].join(" ")} failed: ${output}`), {
      cause: error,
    });
  } finally {
    await sleep(200);
    releaseCommand!();
  }
}

async function getBrightness() {
  return parseM1ddcBrightness(await runM1ddc(["get", "luminance"]));
}

export default function Command() {
  const [currentBrightness, setCurrentBrightness] = useState<string>();
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const manualBrightness = validateManualBrightness(searchText);

  useEffect(() => {
    async function loadBrightness() {
      try {
        const value = await getBrightness();
        setCurrentBrightness(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read display brightness.";
        await showToast({
          style: Toast.Style.Failure,
          title: "m1ddc failed",
          message,
        });
      } finally {
        setIsLoading(false);
      }
    }

    loadBrightness();
  }, []);

  async function handleSetBrightness(brightness: string) {
    try {
      const nextBrightness = parseBrightness(brightness);
      await runM1ddc(["set", "luminance", nextBrightness]);
      const value = await getBrightness();
      setCurrentBrightness(value);
      await showHUD(`Display brightness set to ${nextBrightness}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to adjust display brightness.";
      await showToast({
        style: Toast.Style.Failure,
        title: "m1ddc failed",
        message,
      });
    }
  }

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Enter brightness or select a preset"
      navigationTitle="Adjust Display Brightness"
    >
      {manualBrightness?.brightness ? (
        <List.Section title="Manual Brightness">
          <List.Item
            id="manual-brightness"
            title={manualBrightness.brightness}
            accessories={[...(currentBrightness === manualBrightness.brightness ? [{ text: "Current" }] : [])]}
            actions={
              <ActionPanel>
                <Action
                  title={`Set Brightness to ${manualBrightness.brightness}`}
                  onAction={() => handleSetBrightness(manualBrightness.brightness)}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      {manualBrightness?.error ? (
        <List.Section title="Manual Brightness">
          <List.Item id="invalid-manual-brightness" title="Invalid Brightness" subtitle={manualBrightness.error} />
        </List.Section>
      ) : null}
      <List.Section title="Current Brightness" subtitle={currentBrightness}>
        {quickBrightnessLevels.map((level, index) => (
          <List.Item
            key={level}
            title={level}
            accessories={[
              ...(currentBrightness === level ? [{ tag: "Current" }] : []),
              { tag: `cmd+${quickBrightnessShortcuts[index]}` },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title={`Set Brightness to ${level}`}
                  shortcut={{
                    modifiers: ["cmd"],
                    key: quickBrightnessShortcuts[index],
                  }}
                  onAction={() => handleSetBrightness(level)}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
