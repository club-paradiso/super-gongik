"use client";

import {
  CalendarDays,
  Home,
  LockKeyhole,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  dateOnlyInTimeZone,
  type ServiceProfile,
  type UserData,
  type UserDataStore,
} from "@super-gongik/domain";

import { CalendarTab, type CalendarView } from "@/components/calendar-tab";
import { HomeTab, serviceStateLabel } from "@/components/home-tab";
import { MoneyTab } from "@/components/money-tab";
import { Onboarding } from "@/components/onboarding";
import { ProfileTab } from "@/components/profile-tab";
import { StorageNotice } from "@/components/storage-notice";
import { useAppData } from "@/hooks/use-app-data";
import { buildAppProjection } from "@/lib/projections";

type AppTab = "home" | "calendar" | "money" | "profile";

const tabCopy: Record<AppTab, { title: string; description: string }> = {
  home: { title: "홈", description: "오늘의 복무 현황을 확인해요." },
  calendar: {
    title: "캘린더",
    description: "한 번 기록하면 휴가 원장과 홈에 함께 반영돼요.",
  },
  money: {
    title: "보수",
    description: "확인된 기준과 계산에 필요한 조건을 함께 보여드려요.",
  },
  profile: {
    title: "내 정보",
    description: "이 기기에 저장한 복무 설정과 기록을 관리해요.",
  },
};

const TABS: Array<{ key: AppTab; label: string; icon: typeof Home }> = [
  { key: "home", label: "홈", icon: Home },
  { key: "calendar", label: "캘린더", icon: CalendarDays },
  { key: "money", label: "보수", icon: WalletCards },
  { key: "profile", label: "내 정보", icon: UserRound },
];

export function ServiceApp() {
  const { snapshot, store } = useAppData();

  if (snapshot.phase === "LOADING") {
    return (
      <main className="onboarding-shell" aria-busy="true">
        <p className="loading-line" role="status">
          기기에 저장된 기록을 불러오는 중…
        </p>
      </main>
    );
  }

  const notice = (
    <StorageNotice
      lastError={snapshot.lastError}
      notice={snapshot.notice}
      store={store}
    />
  );

  if (!snapshot.data.profile) {
    return (
      <>
        {notice}
        <Onboarding data={snapshot.data} store={store} />
      </>
    );
  }

  return (
    <Dashboard
      data={snapshot.data}
      notice={notice}
      profile={snapshot.data.profile}
      store={store}
    />
  );
}

function Dashboard({
  data,
  profile,
  store,
  notice,
}: {
  data: UserData;
  profile: ServiceProfile;
  store: UserDataStore;
  notice: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const today = dateOnlyInTimeZone(new Date());
  const projection = useMemo(
    () => buildAppProjection(data, profile, today),
    [data, profile, today],
  );
  const activeCopy = tabCopy[activeTab];

  function openCalendar(view: CalendarView) {
    setCalendarView(view);
    setActiveTab("calendar");
  }

  const navigation = (label: string, className: string) => (
    <nav aria-label={label} className={className}>
      {TABS.map((tab) => (
        <TabButton
          active={activeTab === tab.key}
          icon={tab.icon}
          key={tab.key}
          label={tab.label}
          onClick={() => setActiveTab(tab.key)}
        />
      ))}
    </nav>
  );

  return (
    <main className="app-shell">
      <aside className="desktop-rail">
        <p className="rail-wordmark">
          SUPER
          <br />
          GONGIK
        </p>
        <span className="status-chip">
          {serviceStateLabel(projection.progress.state)}
        </span>
        {navigation("데스크톱 주요 메뉴", "desktop-nav")}
        <button
          className="rail-profile"
          onClick={() => setActiveTab("profile")}
          type="button"
        >
          <UserRound aria-hidden="true" size={19} />
          <span>{profile.serviceCategory ?? "사회복무요원"}</span>
        </button>
        <p className="rail-privacy">
          <LockKeyhole aria-hidden="true" size={18} />
          정보는 이 기기에만 저장해요.
        </p>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <p className="wordmark mobile-wordmark">SUPER GONGIK</p>
          <div className="page-heading">
            <h1>{activeCopy.title}</h1>
            <p>{activeCopy.description}</p>
          </div>
        </header>

        <div className="tab-notice">{notice}</div>

        <section className="tab-content">
          {activeTab === "home" ? (
            <HomeTab
              onOpenCalendar={() => openCalendar("month")}
              onOpenLedger={() => openCalendar("ledger")}
              onOpenMoney={() => setActiveTab("money")}
              profile={profile}
              projection={projection}
            />
          ) : null}
          {activeTab === "calendar" ? (
            <CalendarTab
              data={data}
              onViewChange={setCalendarView}
              profile={profile}
              projection={projection}
              store={store}
              today={today}
              view={calendarView}
            />
          ) : null}
          {activeTab === "money" ? (
            <MoneyTab
              data={data}
              onOpenProfile={() => setActiveTab("profile")}
              profile={profile}
              store={store}
              today={today}
            />
          ) : null}
          {activeTab === "profile" ? (
            <ProfileTab
              data={data}
              ledger={projection.ledger}
              profile={profile}
              store={store}
            />
          ) : null}
        </section>
      </div>

      {navigation("주요 메뉴", "tab-bar")}
    </main>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Home;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={active ? "tab-button tab-button--active" : "tab-button"}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={24} />
      <span>{label}</span>
    </button>
  );
}
