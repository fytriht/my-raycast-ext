import {
  Color,
  Icon,
  LaunchProps,
  LaunchType,
  LocalStorage,
  MenuBarExtra,
  Toast,
  environment,
  showHUD,
  showToast,
} from "@raycast/api";
import { execFile, spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { useEffect, useState } from "react";

const execFileAsync = promisify(execFile);
const caffeinatePath = "/usr/bin/caffeinate";
const pidStorageKey = "caffeinate-pid";
const startLockPath = join(environment.supportPath, "caffeinate-start.lock");
const staleLockMs = 10_000;
let startPromise: Promise<number> | undefined;

type CaffeinateStatus = "checking" | "running" | "failed" | "inactive";

function normalizePid(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isCaffeinateCommand(command: string) {
  return command === "caffeinate" || command === caffeinatePath || command.endsWith("/caffeinate");
}

function parseProcessInfo(line: string) {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);

  if (!match) {
    return undefined;
  }

  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    command: match[3],
  };
}

async function getProcessInfo(pid: number) {
  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-p", String(pid), "-o", "pid=,ppid=,comm="]);
    return parseProcessInfo(stdout);
  } catch {
    return undefined;
  }
}

async function isCaffeinateProcess(pid: number) {
  const processInfo = await getProcessInfo(pid);
  return processInfo ? isCaffeinateCommand(processInfo.command) : false;
}

async function getStoredCaffeinatePid() {
  const storedPid = normalizePid(await LocalStorage.getItem(pidStorageKey));

  if (!storedPid) {
    return undefined;
  }

  if (await isCaffeinateProcess(storedPid)) {
    return storedPid;
  }

  await LocalStorage.removeItem(pidStorageKey);
  return undefined;
}

async function acquireStartLock() {
  await mkdir(environment.supportPath, { recursive: true });

  while (true) {
    try {
      await mkdir(startLockPath);
      return;
    } catch (error) {
      const lockError = error as NodeJS.ErrnoException;

      if (lockError.code !== "EEXIST") {
        throw error;
      }

      try {
        const lockStat = await stat(startLockPath);
        if (Date.now() - lockStat.mtimeMs > staleLockMs) {
          await rm(startLockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        const lockStatError = statError as NodeJS.ErrnoException;
        if (lockStatError.code !== "ENOENT") {
          throw statError;
        }
      }

      await sleep(100);
    }
  }
}

async function withStartLock<T>(callback: () => Promise<T>) {
  await acquireStartLock();

  try {
    return await callback();
  } finally {
    await rm(startLockPath, { recursive: true, force: true });
  }
}

async function spawnCaffeinate() {
  const child = spawn(caffeinatePath, [], {
    detached: true,
    stdio: "ignore",
  });

  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => {
      if (!child.pid) {
        reject(new Error("Failed to read caffeinate PID."));
        return;
      }

      child.unref();
      resolve(child.pid);
    });
  });
}

async function ensureCaffeinateRunning() {
  if (startPromise) {
    return startPromise;
  }

  startPromise = withStartLock(async () => {
    const runningPid = await getStoredCaffeinatePid();

    if (runningPid) {
      return runningPid;
    }

    const pid = await spawnCaffeinate();
    await LocalStorage.setItem(pidStorageKey, pid);
    return pid;
  }).finally(() => {
    startPromise = undefined;
  });

  return startPromise;
}

async function waitForProcessToStop(pid: number) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await isCaffeinateProcess(pid))) {
      return;
    }

    await sleep(50);
  }

  if (await isCaffeinateProcess(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      const killError = error as NodeJS.ErrnoException;
      if (killError.code !== "ESRCH") {
        throw error;
      }
    }
  }
}

async function stopCaffeinate(pid: number | undefined) {
  if (!pid || !(await isCaffeinateProcess(pid))) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const killError = error as NodeJS.ErrnoException;
    if (killError.code !== "ESRCH") {
      throw error;
    }
  }

  await waitForProcessToStop(pid);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function Command({ launchType }: LaunchProps) {
  const [pid, setPid] = useState<number>();
  const [status, setStatus] = useState<CaffeinateStatus>("checking");
  const [message, setMessage] = useState("Checking caffeinate status");

  useEffect(() => {
    let isMounted = true;

    async function syncCaffeinate() {
      setStatus("checking");
      setMessage("Checking caffeinate status");

      try {
        let runningPid = await getStoredCaffeinatePid();

        if (!runningPid && launchType === LaunchType.UserInitiated) {
          runningPid = await ensureCaffeinateRunning();
        }

        if (!isMounted) {
          return;
        }

        if (runningPid) {
          setPid(runningPid);
          setStatus("running");
          setMessage(`caffeinate is running with PID ${runningPid}`);
        } else {
          if (!isMounted) {
            return;
          }

          setPid(undefined);
          setStatus("inactive");
          setMessage("caffeinate is not running");
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);

        if (!isMounted) {
          return;
        }

        setStatus("failed");
        setMessage(errorMessage);
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to run caffeinate",
          message: errorMessage,
        });
      }
    }

    syncCaffeinate();

    return () => {
      isMounted = false;
    };
  }, [launchType]);

  async function handleStop() {
    try {
      await stopCaffeinate(pid ?? (await getStoredCaffeinatePid()));
      await LocalStorage.removeItem(pidStorageKey);
      setPid(undefined);
      setStatus("inactive");
      setMessage("caffeinate is not running");
      await showHUD("caffeinate stopped");
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setStatus("failed");
      setMessage(errorMessage);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to stop caffeinate",
        message: errorMessage,
      });
    }
  }

  if (status === "inactive") {
    return null;
  }

  const isFailed = status === "failed";
  const isChecking = status === "checking";

  return (
    <MenuBarExtra
      isLoading={isChecking}
      icon={{
        source: Icon.MugSteam,
        tintColor: isFailed ? Color.Red : Color.Green,
      }}
      tooltip={message}
    >
      <MenuBarExtra.Item
        title={isFailed ? "Dismiss" : "Stop Caffeinate"}
        subtitle={message}
        icon={isFailed ? Icon.XMarkCircle : Icon.Stop}
        onAction={handleStop}
      />
    </MenuBarExtra>
  );
}
