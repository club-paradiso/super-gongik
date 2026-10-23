// Downloads 병무청's full list of 사회복무요원 복무기관 (data.go.kr 3066757,
// "병무청_사회복무요원 복무기관") and writes it as JSON for the institution
// coverage census.
//
//   node scripts/fetch-mma-service-institutions.cjs [outDir]
//
// The data.go.kr service key comes from DATA_GO_KR_KEY, else from
// ~/.config/data-go-kr.key, else a hidden prompt. It is sent only to
// apis.data.go.kr and is never printed or written to the output.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const ENDPOINT = "https://apis.data.go.kr/1300000/bmggJeongBo/list";
const PAGE_SIZE = 1000;
const FIELDS = [
  "bmgigwanCd",
  "bokmuGgm",
  "dpBokmuGgm",
  "ssggdaeBr",
  "gtcdNm",
  "ghjbcCd",
  "Bjdsgg",
  "bjdsggjusoCd",
  "drmJuso",
  "jeonhwaNo",
  "sbjjehanYn",
  "sbjhjilbyeong",
];
const outDir = path.resolve(
  process.argv[2] || path.join(__dirname, "../docs/sources/mma-roster"),
);

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) rl.output.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function readKey() {
  if (process.env.DATA_GO_KR_KEY) return process.env.DATA_GO_KR_KEY.trim();
  const file = path.join(os.homedir(), ".config/data-go-kr.key");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return askHidden("data.go.kr 서비스 키 (화면에 표시되지 않음): ");
}

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]) : null;
}

async function fetchPage(key, pageNo) {
  // An "Encoding" key is already percent-encoded; a "Decoding" key is not.
  const serviceKey = key.includes("%") ? key : encodeURIComponent(key);
  const url = `${ENDPOINT}?serviceKey=${serviceKey}&numOfRows=${PAGE_SIZE}&pageNo=${pageNo}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url);
      const xml = await response.text();
      const code = tag(xml, "resultCode") ?? tag(xml, "returnReasonCode");
      if (code !== "00") {
        const message =
          tag(xml, "resultMsg") ?? tag(xml, "returnAuthMsg") ?? "no message";
        throw new Error(`HTTP ${response.status}, code ${code}: ${message}`);
      }
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(
        ([, body]) => Object.fromEntries(FIELDS.map((f) => [f, tag(body, f)])),
      );
      return { total: Number(tag(xml, "totalCount")), items };
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function main() {
  const key = await readKey();
  if (!key) throw new Error("No service key.");
  const first = await fetchPage(key, 1);
  const pages = Math.ceil(first.total / PAGE_SIZE);
  const records = [...first.items];
  for (let page = 2; page <= pages; page += 1) {
    records.push(...(await fetchPage(key, page)).items);
    process.stdout.write(`\r${records.length}/${first.total}`);
  }
  process.stdout.write("\n");
  if (records.length !== first.total) {
    throw new Error(`Got ${records.length} records, expected ${first.total}.`);
  }
  records.sort((a, b) => String(a.bmgigwanCd).localeCompare(b.bmgigwanCd));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "roster.json"),
    `${JSON.stringify(records, null, 1)}\n`,
  );
  const byOffice = {};
  for (const r of records) byOffice[r.gtcdNm] = (byOffice[r.gtcdNm] ?? 0) + 1;
  fs.writeFileSync(
    path.join(outDir, "meta.json"),
    `${JSON.stringify(
      {
        dataset: "병무청_사회복무요원 복무기관 (data.go.kr 3066757)",
        endpoint: ENDPOINT,
        fetchedAt: new Date().toISOString(),
        totalCount: first.total,
        byRegionalOffice: byOffice,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`saved ${records.length} 복무기관 to ${outDir}`);
}

main().catch((error) => {
  console.error(`failed: ${error.message}`);
  process.exit(1);
});
