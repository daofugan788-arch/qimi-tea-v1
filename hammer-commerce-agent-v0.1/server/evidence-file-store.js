import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export class EvidenceFileStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
  }

  async prepare() {
    await mkdir(this.directory, { recursive: true });
  }

  screenshotPath(fileName) {
    const safeName = path.basename(fileName).replace(/[^a-z0-9_.-]/gi, "-");
    return path.join(this.directory, safeName);
  }

  async saveSession(runId, payload) {
    await this.prepare();
    const file = this.screenshotPath(`${runId}.json`);
    await writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
    return file;
  }
}
