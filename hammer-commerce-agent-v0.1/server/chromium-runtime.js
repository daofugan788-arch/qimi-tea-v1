import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createBrotliDecompress } from "node:zlib";
import { extract } from "tar-fs";

let extraction;

async function usable(file) {
  try {
    return (await stat(file)).size > 1024 * 1024;
  } catch {
    return false;
  }
}

async function present(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

export async function bundledChromiumExecutablePath() {
  if (extraction) return extraction;
  extraction = (async () => {
    const runtimeDirectory = path.join(tmpdir(), `hammer-commerce-agent-chromium-${process.pid}`);
    const executable = path.join(runtimeDirectory, "chromium");
    const packageEntry = fileURLToPath(import.meta.resolve("@sparticuz/chromium"));
    const packageBin = path.resolve(path.dirname(packageEntry), "../bin");
    const archive = path.join(packageBin, "chromium.br");
    await mkdir(runtimeDirectory, { recursive: true });
    const jobs = [];
    if (!await usable(executable)) {
      jobs.push(pipeline(
        createReadStream(archive),
        createBrotliDecompress({ chunkSize: 2 ** 21 }),
        createWriteStream(executable, { mode: 0o700 }),
      ));
    }
    if (!await present(path.join(runtimeDirectory, "fonts", "fonts.conf"))) {
      jobs.push(pipeline(
        createReadStream(path.join(packageBin, "fonts.tar.br")),
        createBrotliDecompress({ chunkSize: 2 ** 21 }),
        extract(runtimeDirectory, { chown: false }),
      ));
    }
    if (!await present(path.join(runtimeDirectory, "libGLESv2.so"))) {
      jobs.push(pipeline(
        createReadStream(path.join(packageBin, "swiftshader.tar.br")),
        createBrotliDecompress({ chunkSize: 2 ** 21 }),
        extract(runtimeDirectory, { chown: false }),
      ));
    }
    await Promise.all(jobs);
    await chmod(executable, 0o700);
    if (!await usable(executable)) throw new Error("Chromium 运行时解压失败");
    process.env.FONTCONFIG_PATH = path.join(runtimeDirectory, "fonts");
    process.env.XDG_CACHE_HOME = path.join(runtimeDirectory, "cache");
    return executable;
  })();
  return extraction;
}
