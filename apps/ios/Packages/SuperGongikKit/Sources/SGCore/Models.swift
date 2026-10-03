import Foundation
import SGFoundation

// Read models decoded from the TypeScript core's JSON. They mirror the shapes
// produced by `packages/native-core` (pinned by `contracts/fixtures`), carry
// only what screens render, and use plain strings for enumerations so a new
// value added in TypeScript degrades to a generic presentation instead of
// failing to decode. Nothing here computes policy.

// MARK: Store

public struct StoreSnapshot: Decodable, Sendable {
    public let phase: String
    public let data: UserDocument?
    public let notice: LoadNotice?
    public let readOnly: Bool?
    public let lastError: String?

    public var isReady: Bool { phase == "READY" }
}

/// `LoadOutcome` other than EMPTY/LOADED (repository.ts).
public struct LoadNotice: Decodable, Sendable, Equatable {
    public let kind: String
    public let reason: String?
    public let issues: [String]?
    public let quarantineKey: String?
    public let quarantineInPlace: Bool?
    public let previousQuarantineKey: String?
    public let foundVersion: Int?
}

public struct UserDocument: Decodable, Sendable {
    public let schemaVersion: Int
    public let documentRevision: Int
    public let savedAt: String?
    public let deviceId: String
    public let profile: ServiceProfile?
    public let events: [ServiceEvent]
    public let leaveAdjustments: [LeaveAdjustment]
    public let imports: [ImportRecord]
    public let compensationSnapshots: [CompensationSnapshot]

    public var hasAnyRecord: Bool {
        profile != nil || !events.isEmpty || !leaveAdjustments.isEmpty || !imports.isEmpty
    }

    public var liveEvents: [ServiceEvent] { events.filter { $0.deletedAt == nil } }
    public var deletedEvents: [ServiceEvent] { events.filter { $0.deletedAt != nil } }
}

public struct ServiceProfile: Codable, Sendable, Equatable {
    public let id: String
    public let callUpDate: CivilDate
    public let expectedDischargeDate: CivilDate
    public let serviceCategory: String?
    public let residenceRegion: String?
    public let defaultCommuteCost: Double?
    public let defaultMealAllowanceOverride: Double?
    public let liveProgressEnabled: Bool?
    public let workdayMinutes: Int?
    public let workdayStartTime: String?
    public let workdayEndTime: String?
    public let priorServiceCredit: String?
    public let priorServiceBasis: String?
    public let priorServiceCreditedMonths: Int?
    public let priorServiceCreditHasPartialMonth: Bool?
    public let workPattern: String?
    public let workWeekdays: [Int]?

    public var period: ServicePeriod {
        ServicePeriod(callUpDate: callUpDate, expectedDischargeDate: expectedDischargeDate)
    }
}

public struct EventTiming: Codable, Sendable, Equatable {
    public let kind: String
    public let dayCount: Int?
    public let half: String?
    public let durationMinutes: Int?
    public let startTime: String?
    public let endTime: String?
}

public struct EventSource: Codable, Sendable, Equatable {
    public let kind: String
    public let batchId: String?
    public let fileName: String?
}

public struct ServiceEvent: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let eventType: String
    public let startDate: CivilDate
    public let endDate: CivilDate
    public let timing: EventTiming
    public let title: String?
    public let note: String?
    public let deletedAt: String?
    public let updatedAt: String
    public let source: EventSource
    public let sickLeaveCategory: String?

    public func covers(_ date: CivilDate) -> Bool { startDate <= date && date <= endDate }
}

public struct LeaveAdjustment: Decodable, Sendable, Identifiable {
    public let id: String
    public let kind: String
    public let creditKey: String?
    public let effectiveDate: CivilDate
    public let amountHalfDays: Int
    public let amountMinutes: Int
    public let reason: String
    public let deletedAt: String?
}

public struct ImportRecord: Decodable, Sendable, Identifiable {
    public let id: String
    public let fileName: String
    public let sourceFormat: String?
    public let status: String
    public let createdAt: String
    public let eventCount: Int
    public let snapshotCount: Int
}

public struct CompensationSnapshot: Decodable, Sendable, Identifiable {
    public let id: String
    public let month: String
    public let total: Double?
    public let generatedAt: String?
    public let deletedAt: String?
}

// MARK: Projection (`buildNativeProjection`)

public struct Projection: Decodable, Sendable {
    public let today: CivilDate
    public let profile: ServiceProfile?
    public let progress: ServiceProgress?
    public let home: HomeModel?
    public let ledger: LeaveLedger?
    public let leaveText: LeaveText?
    public let compensation: MonthlyCompensation?
    public let payBands: PayBandSchedule?
    public let payStepOrdinal: Int?
    public let liveEvents: [ServiceEvent]?
    public let todayEvents: [ServiceEvent]?
    public let nextEvent: ServiceEvent?
    public let eventDisplay: [String: EventDisplay]?
}

public struct EventDisplay: Decodable, Sendable, Equatable {
    public let category: String
    public let categoryLabel: String
    public let label: String
    public let timing: String
}

/// `HomeModel` from `apps/web/src/lib/home-model.ts`.
public struct HomeModel: Decodable, Sendable {
    public struct Milestone: Decodable, Sendable, Equatable {
        public let label: String
        public let date: CivilDate
        public let daysUntil: Int
        public let detail: String?
        public let source: String
    }

    public struct Hero: Decodable, Sendable {
        public let phase: String
        public let eyebrow: String
        public let headline: String
        public let headlineSpoken: String
        public let dateLine: String
        public let stateLabel: String
        public let percent: Double
        public let percentLabel: String
        public let elapsedDays: Int
        public let remainingDays: Int
        public let totalServiceDays: Int
        public let live: Bool
        public let next: Milestone?
        public let reachedToday: String?
    }

    public struct Leave: Decodable, Sendable {
        public let kind: String
        public let caption: String
        public let remaining: String?
        public let attendance: String?
    }

    public struct Pay: Decodable, Sendable {
        public let kind: String
        public let caption: String
        public let amount: Double?
        public let band: String?
    }

    public struct AgendaItem: Decodable, Sendable, Identifiable {
        public let event: ServiceEvent
        public let daysUntil: Int
        public let isToday: Bool
        public var id: String { event.id }
    }

    public let hero: Hero
    public let leave: Leave
    public let pay: Pay
    public let today: [AgendaItem]
    public let upcoming: [AgendaItem]
    public let completed: Bool
}

public struct LeaveQuantity: Codable, Sendable, Equatable {
    public let halfDays: Int
    public let minutes: Int
}

public struct LeaveLedger: Decodable, Sendable {
    public struct Credit: Decodable, Sendable, Identifiable {
        public let key: String
        public let label: String
        public let grantDate: CivilDate
        public let status: String
        public let days: Double?
        public let referenceDays: Double?
        public let ruleVersion: String?
        public let explanation: String
        public let granted: Bool
        public let state: String
        public let confirmation: Confirmation?
        public var id: String { key }

        public struct Confirmation: Decodable, Sendable {
            public let amountHalfDays: Int
        }
    }

    public struct Balance: Decodable, Sendable {
        public let asOf: CivilDate
        public let status: String
        public let unresolvedEventIds: [String]
        public let pendingCreditKeys: [String]
    }

    public struct Entry: Decodable, Sendable {
        public let date: CivilDate
        public let kind: String
        public let label: String
        public let referenceId: String?
        public let scheduled: Bool
    }

    public struct TypeUsage: Decodable, Sendable {
        public let eventType: String
        public let label: String
        public let count: Int
        public let unresolvedCount: Int
    }

    public struct Reconciliation: Decodable, Sendable {
        public let status: String
        public let comparedAt: CivilDate?
        public let reason: String?
        public let difference: LeaveQuantity?
        public let assumptions: [String]?
    }

    public let credits: [Credit]
    public let balance: Balance
    public let entries: [Entry]
    public let byType: [TypeUsage]
    public let attendanceMinutes: [String: Int]
    public let reconciliation: Reconciliation
    public let workdayMinutes: Int?
    public let assumptions: [String]
    public let warnings: [String]
}

/// Display strings formatted by the core exactly as the web ledger panel does.
public struct LeaveText: Decodable, Sendable {
    public struct Balance: Decodable, Sendable {
        public let granted: String
        public let upcomingCredits: String
        public let corrections: String
        public let used: String
        public let scheduled: String
        public let available: String
        public let remainingAfterScheduled: String
    }

    public struct Entry: Decodable, Sendable {
        public let delta: String
        public let running: String
    }

    public struct Credit: Decodable, Sendable {
        public let amount: String
        public let explanation: String
    }

    public struct Reconciliation: Decodable, Sendable {
        public let institutionRemaining: String
        public let appRemaining: String
        public let difference: String
    }

    public let credits: [Credit]
    public let balance: Balance
    public let entries: [Entry]
    public let byType: [String]
    public let attendanceTotal: String
    public let reconciliation: Reconciliation?
}

public struct MonthlyCompensation: Decodable, Sendable {
    public struct Component: Decodable, Sendable, Identifiable {
        public let key: String
        public let label: String
        public let status: String
        public let monthlyAmount: Double?
        public let dailyRate: Double?
        public let eligibleDays: Double?
        public let rateSource: String?
        public let basis: String
        public let explanation: String
        public var id: String { key }
    }

    public struct Rule: Decodable, Sendable {
        public struct Source: Decodable, Sendable, Identifiable {
            public let title: String
            public let authority: String?
            public let url: String?
            public var id: String { title }
        }

        public let id: String
        public let version: String
        public let effectiveFrom: String?
        public let effectiveUntil: String?
        public let verifiedAt: String?
        public let sources: [Source]
    }

    public let status: String
    public let month: String
    public let asOfDate: CivilDate
    public let serviceMonthOrdinal: Int?
    public let equivalentRank: String?
    public let components: [Component]
    /// Present only when every component is calculated (safety gate).
    public let total: Double?
    public let rule: Rule?
    public let headline: String
    public let unresolved: [String]
    public let assumptions: [String]?
    public let warnings: [String]?
}

public struct PayBandSchedule: Decodable, Sendable {
    public struct Step: Decodable, Sendable, Identifiable {
        public let equivalentRank: String
        public let label: String
        public let fromServiceMonthOrdinal: Int
        public let startDate: CivilDate
        public let monthlyAmount: Double?
        public let amountRuleVersion: String?
        public var id: String { equivalentRank }
    }

    public let status: String
    public let reason: String?
    public let creditedMonths: Int?
    public let current: Step?
    public let next: Step?
    public let steps: [Step]?
}

/// `eventTaxonomy` (web lib/event-display.ts + domain labels).
public struct EventTaxonomy: Decodable, Sendable {
    public struct Group: Decodable, Sendable, Identifiable {
        public let label: String
        public let types: [String]
        public var id: String { label }
    }

    public let typeLabels: [String: String]
    public let categoryOfType: [String: String]
    public let categoryLabels: [String: String]
    public let typeGroups: [Group]

    public func label(_ type: String) -> String { typeLabels[type] ?? type }
    public func category(_ type: String) -> String { categoryOfType[type] ?? "note" }
}

/// `FormState` of the shared event editor model (web lib/event-form.ts).
public struct EventFormState: Codable, Sendable, Equatable {
    public var eventType: String
    public var mode: String
    public var startDate: String
    public var endDate: String
    public var dayCount: String
    public var dayCountTouched: Bool
    public var half: String
    public var startTime: String
    public var endTime: String
    public var hours: String
    public var minutes: String
    public var durationTouched: Bool
    public var sickLeaveCategory: String
    public var title: String
    public var note: String
}

/// `eventFormEvaluate`: what the editor shows for the current form.
public struct EventFormEvaluation: Decodable, Sendable {
    public struct Validation: Decodable, Sendable {
        public let errors: [EventIssue]
        public let warnings: [EventIssue]
    }

    public struct Classification: Decodable, Sendable {
        public let kind: String
        public let label: String
        public let reason: String
        public let automatic: Bool
    }

    public let draft: JSONValue
    public let validation: Validation
    public let classification: Classification?
    public let isLeave: Bool
    public let isAnnualCharge: Bool
    public let isNonPayable: Bool
}

/// `evaluateMoneyMonth` (web lib/money-model.ts).
public struct MoneyMonth: Decodable, Sendable {
    public let asOfDate: CivilDate
    public let compensation: MonthlyCompensation
    public let schedule: PayBandSchedule
}

// MARK: Results

public struct EventIssue: Decodable, Sendable, Equatable, Hashable {
    public let code: String
    public let message: String
    public let field: String?

    public init(code: String, message: String, field: String?) {
        self.code = code
        self.message = message
        self.field = field
    }
}

/// `RunResult<T>` without the value (screens re-read the snapshot).
public struct RunOutcome: Decodable, Sendable {
    public let ok: Bool
    public let errors: [EventIssue]?
}

/// `{ ok, value | error }` envelope of `SGCore.call`.
public struct PureEnvelope<Value: Decodable & Sendable>: Decodable, Sendable {
    public struct Failure: Decodable, Sendable {
        public let name: String
        public let message: String
    }

    public let ok: Bool
    public let value: Value?
    public let error: Failure?
}
