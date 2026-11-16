// node tools/preview.mjs  -> serves the workspace; open the printed URL in a WebGL2 browser.
//   ?play            real-time playback (loops)      ?play&t=45  start at 45 s
//   ?f=1380          a single frame                  ?w=1920&h=804&msaa=4  render size
import { serve } from "./lib.mjs";
const { port } = await serve();
console.log(`http://127.0.0.1:${port}/index.html?play`);
