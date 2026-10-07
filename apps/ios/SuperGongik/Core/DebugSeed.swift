#if DEBUG
import Foundation
import SGCore
import SGFoundation

/// DEBUG-only screenshot fixture: `-SGSeedDemo YES` on an empty store creates a
/// realistic document through the same core commands the UI uses (profile,
/// prior-service answer, a few annual-leave records), so screenshot QA
/// (`apps/ios/scripts/screenshot-qa.sh`) is deterministic without tapping.
/// Compiled out of release builds; it holds no rule, only input values.
enum DebugSeed {
    @MainActor
    static func runIfRequested(_ model: AppModel) async {
        guard UserDefaults.standard.bool(forKey: "SGSeedDemo"), model.profile == nil else { return }
        let today = model.today
        let callUp = today.adding(days: -300)
        guard let discharge = await model.pure(
            "calculateExpectedDischargeDate", [.string(callUp.description)], as: CivilDate.self) else { return }
        var issues = await model.run("createProfile", [.object([
            "callUpDate": .string(callUp.description),
            "expectedDischargeDate": .string(discharge.description),
            "serviceCategory": .null,
            "workplaceType": .null,
            "defaultCommuteCost": .null,
            "defaultMealAllowanceOverride": .null,
            "timezone": .string("Asia/Seoul"),
        ])])
        issues += await model.editProfile(["priorServiceCredit": .string("NONE")])
        for (offset, days) in [(-40, 1), (6, 1), (20, 2)] {
            let start = today.adding(days: offset)
            issues += await model.run("createServiceEvent", [.object([
                "eventType": .string("ANNUAL_LEAVE"),
                "startDate": .string(start.description),
                "endDate": .string(start.adding(days: days - 1).description),
                "timing": .object(["kind": .string("ALL_DAY"), "dayCount": .number(Double(days))]),
                "title": .null,
                "note": .null,
            ])])
        }
        if !issues.isEmpty { AppLog.error("demo seed: \(issues.map(\.code))") }
    }
}
#endif
