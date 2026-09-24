import { ExternalLink } from "lucide-react";

import type { MonthlyCompensationEvaluation } from "@super-gongik/rules";

const currency = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const STATUS_LABELS = {
  CALCULATED: "계산됨",
  SUGGESTED_ONLY: "제안값",
  NEEDS_INPUT: "입력 필요",
  GATED: "검증 대기",
  UNSUPPORTED: "미지원",
} as const;

export function MoneyTab({
  compensation,
  onOpenProfile,
}: {
  compensation: MonthlyCompensationEvaluation;
  onOpenProfile: () => void;
}) {
  return (
    <section className="money-page" aria-label="이번 달 보수 기준">
      <p className="money-headline">{compensation.headline}</p>

      {compensation.components.length ? (
        <div className="money-list">
          {compensation.components.map((component) => (
            <article key={component.key}>
              <div className="money-list__title">
                <span>{component.label}</span>
                <span
                  className={`badge badge--${component.status.toLowerCase()}`}
                >
                  {STATUS_LABELS[component.status]}
                </span>
              </div>
              <strong>
                {component.monthlyAmount !== null
                  ? currency.format(component.monthlyAmount)
                  : component.dailyRate !== null
                    ? `${currency.format(component.dailyRate)} / 일`
                    : "—"}
              </strong>
              <p>{component.explanation}</p>
            </article>
          ))}
        </div>
      ) : null}

      <p className="field-hint">
        합계는 중식비·교통비의 실제 출근일 수를 계산할 수 있을 때까지 보여주지
        않아요. 확정 지급액은 복무기관에서 확인하세요.
      </p>

      {compensation.status === "NEEDS_PROFILE" ? (
        <button className="dashboard-row" onClick={onOpenProfile} type="button">
          <div>
            <h2>이전 복무 경력 알려 주기</h2>
            <p>내 정보에서 한 번만 답하면 기본 보수를 보여드려요.</p>
          </div>
        </button>
      ) : null}

      <aside className="rule-note">
        <h2>계산 기준</h2>
        {compensation.rule ? (
          <dl>
            <div>
              <dt>적용 규칙</dt>
              <dd>
                {compensation.rule.id} v{compensation.rule.version}
              </dd>
            </div>
            <div>
              <dt>검증일</dt>
              <dd>{compensation.rule.verifiedAt}</dd>
            </div>
            <div>
              <dt>기준일</dt>
              <dd>{compensation.asOfDate}</dd>
            </div>
          </dl>
        ) : (
          <p>적용할 수 있는 검증된 규칙이 없어요.</p>
        )}
        {compensation.assumptions.length ? (
          <ul className="plain-list">
            {compensation.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {compensation.rule ? (
          <details>
            <summary>출처 {compensation.rule.sources.length}건</summary>
            <ul className="source-list">
              {compensation.rule.sources.map((source) => (
                <li key={`${source.title}-${source.url}`}>
                  <a href={source.url} rel="noreferrer" target="_blank">
                    {source.title}
                    <ExternalLink aria-hidden="true" size={13} />
                  </a>
                  <small>{source.authority}</small>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>
    </section>
  );
}
