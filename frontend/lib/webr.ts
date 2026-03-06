import type { WebR as WebRType, Shelter as ShelterType } from "webr";

let webR: WebRType | null = null;
let shelter: ShelterType | null = null;
let initPromise: Promise<void> | null = null;
let _status: "idle" | "loading" | "ready" | "error" = "idle";
let _error: string | null = null;

export type WebRStatus = "idle" | "loading" | "ready" | "error";

export function getStatus(): WebRStatus {
  return _status;
}

export function getError(): string | null {
  return _error;
}

/** Core R packages to pre-install during initialization. */
const CORE_PACKAGES = ["dplyr", "tidyr", "stringr", "lubridate", "ggplot2"];

/** Optional callback for progress updates during init. */
let _onProgress: ((msg: string) => void) | null = null;

export function setProgressCallback(cb: ((msg: string) => void) | null): void {
  _onProgress = cb;
}

export async function initWebR(): Promise<void> {
  if (webR) return;
  if (initPromise) return initPromise;

  _status = "loading";

  initPromise = (async () => {
    try {
      _onProgress?.("Starting WebR...");
      const { WebR } = await import("webr");
      webR = new WebR();
      await webR.init();
      shelter = await new webR.Shelter();

      // Install core R packages (cached by browser after first load)
      _onProgress?.("Installing R packages...");
      await webR.installPackages(CORE_PACKAGES, { quiet: true });

      // Pre-load them so library() calls are instant
      _onProgress?.("Loading R packages...");
      for (const pkg of CORE_PACKAGES) {
        await shelter.captureR(`library(${pkg})`, { captureStreams: true });
      }

      _status = "ready";
      _onProgress?.("Ready");
    } catch (err) {
      _status = "error";
      _error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  })();

  return initPromise;
}

export interface EvalResult {
  stdout: string;
  stderr: string;
  images: ImageBitmap[];
  error: string | null;
}

export async function evalR(code: string): Promise<EvalResult> {
  if (!webR || !shelter) throw new Error("WebR not initialized");

  const stdout: string[] = [];
  const stderr: string[] = [];
  const images: ImageBitmap[] = [];
  let error: string | null = null;

  try {
    const result = await shelter.captureR(code, {
      withAutoprint: true,
      captureStreams: true,
      captureConditions: false,
      captureGraphics: {
        width: 800,
        height: 600,
      },
    });

    for (const item of result.output) {
      if (item.type === "stdout") {
        stdout.push(item.data as string);
      } else if (item.type === "stderr") {
        stderr.push(item.data as string);
      }
    }

    for (const img of result.images) {
      images.push(img);
    }

    shelter.purge();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Promote R errors that landed in stderr (e.g. dplyr condition errors)
  const stderrStr = stderr.join("\n");
  if (!error && stderrStr) {
    const errorMatch = stderrStr.match(/Error(?:\s+in\s+[^:]*)?:\s*[\s\S]+/);
    if (errorMatch) {
      error = errorMatch[0];
    }
  }

  return {
    stdout: stdout.join("\n"),
    stderr: stderrStr,
    images,
    error,
  };
}

export interface REnvObject {
  name: string;
  class: string;
  isDataFrame: boolean;
  nrow?: number;
  ncol?: number;
  length?: number;
}

/**
 * List all objects in R's global environment with metadata.
 * Uses evalR (proven code path) instead of direct shelter.captureR.
 */
export async function listREnvironment(): Promise<REnvObject[]> {
  if (!webR || !shelter) return [];

  try {
    const result = await evalR(
      `local({
        objs <- ls(envir = .GlobalEnv)
        # Filter out internal/temp objects
        objs <- objs[!grepl("^(csv_out|tmp|\\\\.)$", objs)]
        if (length(objs) > 0) {
          for (nm in objs) {
            obj <- get(nm, envir = .GlobalEnv)
            # Skip functions (e.g. base R df())
            if (is.function(obj)) next
            cls <- class(obj)[1]
            isdf <- is.data.frame(obj)
            nr <- if (isdf) nrow(obj) else NA
            nc <- if (isdf) ncol(obj) else NA
            len <- if (!isdf && (is.vector(obj) || is.factor(obj))) length(obj) else NA
            cat(nm, "\\t", cls, "\\t", isdf, "\\t", nr, "\\t", nc, "\\t", len, "\\n", sep="")
          }
        }
      })`
    );

    if (result.error || !result.stdout.trim()) return [];

    return result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        return {
          name: parts[0],
          class: parts[1],
          isDataFrame: parts[2] === "TRUE",
          nrow: parts[3] !== "NA" ? parseInt(parts[3]) : undefined,
          ncol: parts[4] !== "NA" ? parseInt(parts[4]) : undefined,
          length: parts[5] !== "NA" ? parseInt(parts[5]) : undefined,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Get a text summary of an R object.
 * Uses class-aware display: summary() for models, print() for tests,
 * str() with limited depth for everything else.
 */
export async function getObjectSummary(name: string): Promise<string> {
  if (!webR || !shelter) return "";

  try {
    const result = await evalR(
      `local({
        obj <- ${name}
        if (inherits(obj, c("lm", "glm", "nls"))) {
          print(summary(obj))
        } else if (inherits(obj, "htest")) {
          print(obj)
        } else if (inherits(obj, c("anova", "aov"))) {
          print(summary(obj))
        } else if (is.list(obj) && !is.data.frame(obj)) {
          str(obj, max.level = 2)
        } else {
          str(obj)
        }
      })`
    );
    if (result.error) return `Error: ${result.error}`;
    return result.stdout || result.stderr || "";
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function getWebR(): WebRType | null {
  return webR;
}

export function isInitialized(): boolean {
  return _status === "ready";
}
