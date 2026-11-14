// node tools/probe.mjs out.jpg frame "js to run before render (has __dbg)"
import fs from "node:fs";
import { serve, openFilm, grab, dataToBuf } from "./lib.mjs";
const [out, f, js] = process.argv.slice(2);
const { server, port } = await serve();
const { browser, page, logs } = await openFilm(port, {
  w: 640,
  h: 268,
  msaa: 0,
});
if (js) console.log(await page.evaluate(js));
const r = await grab(page, +f, { jpeg: true });
fs.writeFileSync(out, dataToBuf(r.data));
console.log(
  logs
    .filter((l) => /error|warn/i.test(l))
    .slice(0, 8)
    .join("\n"),
);
await browser.close();
server.close();
