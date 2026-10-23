// Downloads Korean public holidays (관공서 공휴일, including 대체·임시공휴일)
// from 한국천문연구원 특일 정보 (data.go.kr 15012690, getRestDeInfo) and writes
// packages/rules/holidays/kr-public-holidays.json.
//
//   node scripts/fetch-kasi-holidays.cjs [fromYear] [toYear]
//
// Defaults to this year through three years ahead. The data.go.kr service key
// comes from DATA_GO_KR_KEY, else ~/.config/data-go-kr.key, else a hidden
// prompt. It is sent only to apis.data.go.kr and never printed or saved.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const ENDPOINT =
  "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const outFile = path.join(
  __dirname,
  "../packages/rules/holidays/kr-public-holidays.json",
);
const thisYear = new Date().getFullYear();
const fromYear = Number(process.argv[2] ?? thisYear);
const toYear = Number(process.argv[3] ?? thisYear + 3);

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

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? match[1].trim() : null;
}

async function fetchYear(key, year) {
  // An "Encoding" key is already percent-encoded; a "Decoding" key is not.
  const serviceKey = key.includes("%") ? key : encodeURIComponent(key);
  const url = `${ENDPOINT}?ServiceKey=${serviceKey}&solYear=${year}&numOfRows=100&pageNo=1`;
  const response = await fetch(url);
  const xml = await response.text();
  const code = tag(xml, "resultCode") ?? tag(xml, "returnReasonCode");
  if (code !== "00") {
    const message =
      tag(xml, "resultMsg") ?? tag(xml, "returnAuthMsg") ?? "no message";
    throw new Error(
      `${year}: HTTP ${response.status}, code ${code}: ${message}`,
    );
  }
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, body]) => ({
      locdate: tag(body, "locdate"),
      name: tag(body, "dateName"),
      isHoliday: tag(body, "isHoliday"),
    }))
    .filter((item) => item.isHoliday === "Y" && /^\d{8}$/.test(item.locdate))
    .map((item) => ({
      date: `${item.locdate.slice(0, 4)}-${item.locdate.slice(4, 6)}-${item.locdate.slice(6)}`,
      name: item.name,
    }));
}

async function main() {
  const key = await readKey();
  if (!key) throw new Error("No service key.");
  const years = {};
  for (let year = fromYear; year <= toYear; year += 1) {
    const holidays = await fetchYear(key, year);
    // The API returns an empty year until the government announces it.
    if (holidays.length === 0) {
      console.log(`${year}: not published yet, skipped`);
      continue;
    }
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    years[year] = holidays;
    console.log(`${year}: ${holidays.length} holidays`);
  }
  if (Object.keys(years).length === 0) throw new Error("No holidays fetched.");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    `${JSON.stringify(
      {
        source: {
          title: "한국천문연구원_특일 정보 (공휴일 정보 조회)",
          authority: "한국천문연구원",
          url: "https://www.data.go.kr/data/15012690/openapi.do",
          endpoint: ENDPOINT,
          fetchedAt: new Date().toISOString().slice(0, 10),
        },
        years,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`saved ${outFile}`);
}

main().catch((error) => {
  console.error(`failed: ${error.message}`);
  process.exit(1);
});
