import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultFixturesDir } from "../paths.js";
import { pulsoEditionSchema } from "../schema.js";
import { writeEditionCover } from "./render.js";

/**
 * Regenerates the cover of every tracked sample edition (`fixtures/editions/<date>/<slot>.json`)
 * and `latest.json`, after a change to the cover design. `npm run cover:fixtures`.
 */
const dir = defaultFixturesDir();
const editionFiles = readdirSync(dir)
  .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && statSync(path.join(dir, name)).isDirectory())
  .flatMap((date) =>
    readdirSync(path.join(dir, date))
      .filter((name) => /^(manha|meio-dia|tarde)\.json$/.test(name))
      .map((name) => path.join(date, name))
  );

for (const relative of ["latest.json", ...editionFiles]) {
  const filePath = path.join(dir, relative);
  const edition = pulsoEditionSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  edition.cover = writeEditionCover(edition, dir);
  writeFileSync(filePath, `${JSON.stringify(edition, null, 2)}\n`);
}
