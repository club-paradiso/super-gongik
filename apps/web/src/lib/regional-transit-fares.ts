export const RESIDENCE_REGIONS = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
] as const;

export type RegionalFareSuggestion = {
  oneWayCashFare: number;
  dailyRoundTripFare: number;
  basis: string;
  sourceUrl: string;
  verifiedAt: string;
};

/**
 * Conservative suggestions only. A region is enabled after an official
 * current fare source has been verified. Missing regions stay manual rather
 * than receiving a guessed fare.
 */
const VERIFIED_FARES: Partial<Record<(typeof RESIDENCE_REGIONS)[number], RegionalFareSuggestion>> = {
  서울특별시: {
    oneWayCashFare: 1500,
    dailyRoundTripFare: 3000,
    basis: "서울 간·지선 시내버스 일반 현금 기본요금",
    sourceUrl: "https://news.seoul.go.kr/traffic/archives/1706",
    verifiedAt: "2026-09-26",
  },
  제주특별자치도: {
    oneWayCashFare: 1200,
    dailyRoundTripFare: 2400,
    basis: "제주 간·지선버스 일반 현금 단일요금",
    sourceUrl: "https://bus.jeju.go.kr/mobile/schedule/busfare",
    verifiedAt: "2026-09-26",
  },
};

export function regionalFareSuggestion(region: string | null) {
  if (!region) return null;
  return VERIFIED_FARES[region as keyof typeof VERIFIED_FARES] ?? null;
}
