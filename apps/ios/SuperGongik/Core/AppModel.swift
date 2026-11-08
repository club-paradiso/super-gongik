import Foundation
import Observation
import SGCore
import SGFoundation
import SGPersistence

/// The app's single source of truth for presentation: the latest store
/// snapshot and the projection for today, both produced by the shared core.
///
/// It owns no business logic. Every change goes through a whitelisted core
/// command; every number on screen comes from `projection` (or from the
/// Swift-native progress slice for the live readout). Screens hold only their
/// own presentation state.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        case ready
        /// The core could not start. Local data is untouched on disk.
        case failed(String)
    }

    private(set) var phase: Phase = .launching
    private(set) var snapshot: StoreSnapshot?
    private(set) var projection: Projection?
    private(set) var taxonomy: EventTaxonomy?
    private(set) var today: CivilDate = AppClock.today()
    /// Last write failure, as Korean copy. Cleared on the next success or
    /// when the user dismisses it.
    private(set) var lastWriteError: String?
    /// True when the core could not build today's projection. The screens
    /// keep the last good projection (if any) and offer a retry instead of an
    /// endless spinner.
    private(set) var projectionFailed = false

    @ObservationIgnored private var runtime: CoreRuntime?
    @ObservationIgnored private var storage: FileKeyValueStore?
    @ObservationIgnored private var midnightTask: Task<Void, Never>?
    @ObservationIgnored let config = AppConfig.current
    let reminders = ReminderScheduler()
    let cloud = CloudModel(config: AppConfig.current)

    var document: UserDocument? { snapshot?.data }
    var profile: ServiceProfile? { document?.profile }
    var isReadOnly: Bool { snapshot?.readOnly == true }
    var core: CoreRuntime? { runtime }

    // MARK: Lifecycle

    func start() async {
        guard runtime == nil else { return }
        do {
            // JavaScriptCore and file I/O start off the main thread.
            let services = cloud.services
            let (runtime, storage) = try await Task.detached(priority: .userInitiated) {
                let storage = try FileKeyValueStore.applicationStore()
                #if DEBUG
                // UI tests: `-SGResetStore YES` starts from an empty store so
                // each test seeds its own fixture. Never compiled into release.
                if UserDefaults.standard.bool(forKey: "SGResetStore") {
                    for key in try storage.keys() { try storage.remove(key) }
                }
                #endif
                return (try CoreRuntime(storage: storage, cloud: services), storage)
            }.value
            self.runtime = runtime
            self.storage = storage
            let snapshot = try await runtime.open()
            taxonomy = try await runtime.pure("eventTaxonomy", [], as: EventTaxonomy.self)
            await publish(snapshot)
            #if DEBUG
            await DebugSeed.runIfRequested(self)
            #endif
            phase = .ready
            scheduleMidnightRefresh()
            cloud.onStoreChange = { [weak self] in await self?.reloadAfterExternalWrite() }
            await cloud.attach(runtime)
        } catch {
            AppLog.error("core start failed: \(error)")
            phase = .failed(ErrorCopy.startup)
        }
    }

    /// Re-evaluates "today" (Asia/Seoul) when the app returns to the
    /// foreground; a day may have passed.
    func sceneBecameActive() async {
        await cloud.foreground()
        let now = AppClock.today()
        if now != today {
            today = now
            await reproject()
        }
        scheduleMidnightRefresh()
    }

    func sceneEnteredBackground() {
        midnightTask?.cancel()
        midnightTask = nil
    }

    private func scheduleMidnightRefresh() {
        midnightTask?.cancel()
        let next = SeoulClock.nextMidnight(after: .now)
        midnightTask = Task { [weak self] in
            let delay = max(1, next.timeIntervalSinceNow)
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.sceneBecameActive()
        }
    }

    // MARK: Store

    private func publish(_ snapshot: StoreSnapshot) async {
        self.snapshot = snapshot
        await reproject()
    }

    func reproject() async {
        guard let runtime, snapshot?.isReady == true else { return }
        do {
            projection = try await runtime.project(today: today)
            projectionFailed = false
        } catch {
            // Keep the last good projection on screen; a nil projection made
            // 홈 and 연가 내역 spin forever with no message or retry.
            AppLog.error("projection failed: \(error)")
            projectionFailed = true
        }
        WidgetSnapshotWriter.write(projection: projection, today: today)
        await reminders.reschedule(projection: projection)
        if !projectionFailed {
            await DutyActivityController.refresh(profile: projection?.profile, hero: projection?.home?.hero)
        }
    }

    /// Runs a store command. Returns the validation issues the core reported
    /// (empty on success) so forms can show them inline.
    @discardableResult
    func run(_ command: String, _ arguments: [JSONValue]) async -> [EventIssue] {
        guard let runtime else { return [EventIssue(code: "UNAVAILABLE", message: ErrorCopy.startup, field: nil)] }
        let outcome: RunOutcome
        do {
            outcome = try await runtime.run(command, arguments)
        } catch {
            AppLog.error("command \(command) failed: \(error)")
            lastWriteError = ErrorCopy.saveFailed
            return [EventIssue(code: "CORE", message: ErrorCopy.saveFailed, field: nil)]
        }
        // The command has finished (committed or refused). A failure to read
        // the new snapshot must not be reported as a failed save: the record
        // is stored, and "저장하지 못했어요" made users save it a second time.
        await refreshSnapshot()
        if outcome.ok {
            lastWriteError = nil
            return []
        }
        return outcome.errors ?? [EventIssue(code: "UNKNOWN", message: ErrorCopy.saveFailed, field: nil)]
    }

    /// Re-reads the store after a write. On failure the previous snapshot
    /// stays and the projection is marked failed so the screens offer a retry.
    private func refreshSnapshot() async {
        guard let runtime else { return }
        do {
            await publish(try await runtime.snapshot())
        } catch {
            AppLog.error("snapshot after write failed: \(error)")
            projectionFailed = true
        }
    }

    /// Retry after `projectionFailed`: re-read the store and project again.
    func retryProjection() async {
        await refreshSnapshot()
    }

    func dismissWriteError() { lastWriteError = nil }

    /// Patch profile fields; fields the app does not model are kept.
    @discardableResult
    func editProfile(_ patch: [String: JSONValue]) async -> [EventIssue] {
        guard let runtime else { return [EventIssue(code: "UNAVAILABLE", message: ErrorCopy.startup, field: nil)] }
        do {
            let outcome = try await runtime.editProfile(patch)
            await publish(try await runtime.snapshot())
            return outcome.ok ? [] : (outcome.errors ?? [])
        } catch {
            AppLog.error("edit profile failed: \(error)")
            return [EventIssue(code: "CORE", message: ErrorCopy.saveFailed, field: nil)]
        }
    }

    /// Re-read the store after a write that did not go through `run`
    /// (restore).
    func reloadAfterExternalWrite() async {
        guard let runtime, let snapshot = try? await runtime.snapshot() else { return }
        await publish(snapshot)
    }

    func dismissNotice() async {
        guard let runtime, let snapshot = try? await runtime.dismissNotice() else { return }
        await publish(snapshot)
    }

    /// "이 기기의 모든 데이터 지우기": records and every recovery copy.
    func wipeAllLocalData() async -> Bool {
        guard let runtime else { return false }
        do {
            let outcome = try await runtime.wipeAll()
            await publish(try await runtime.snapshot())
            WidgetSnapshotWriter.clear()
            await DutyActivityController.end()
            await cloud.afterLocalWipe()
            return outcome.ok
        } catch {
            AppLog.error("wipe failed: \(error)")
            return false
        }
    }

    func readRaw(key: String) async -> String? {
        try? await runtime?.readRaw(key: key)
    }

    // MARK: Pure helpers

    func pure<Value: Decodable & Sendable>(_ name: String, _ arguments: [JSONValue], as type: Value.Type) async -> Value? {
        guard let runtime else { return nil }
        do {
            return try await runtime.pure(name, arguments, as: type)
        } catch {
            AppLog.error("pure \(name) failed: \(error)")
            return nil
        }
    }

    func label(for eventType: String) -> String { taxonomy?.label(eventType) ?? eventType }
}

/// Build-time configuration from Info.plist (set through xcconfig).
struct AppConfig: Sendable {
    let supabaseURL: URL?
    let supabaseAnonKey: String?
    /// "Apple로 로그인" is offered only when the build says the Apple
    /// provider is configured (SG_SIGN_IN_WITH_APPLE).
    let signInWithApple: Bool
    /// Email code sign-in (SG_SIGN_IN_EMAIL) and NAVER (SG_SIGN_IN_NAVER) are
    /// offered only once Supabase can serve them; see Base.xcconfig.
    let signInWithEmail: Bool
    let signInWithNaver: Bool

    /// Cloud features appear only when both values are configured, exactly
    /// like the web's NEXT_PUBLIC_SUPABASE_* rule.
    var isCloudConfigured: Bool { supabaseURL != nil && supabaseAnonKey != nil }

    static let current: AppConfig = {
        let info = Bundle.main.infoDictionary ?? [:]
        func value(_ key: String) -> String? {
            guard let text = info[key] as? String else { return nil }
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            return trimmed.isEmpty || trimmed.hasPrefix("$(") ? nil : trimmed
        }
        let url = value("SGSupabaseURL").flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }
        return AppConfig(
            supabaseURL: url, supabaseAnonKey: value("SGSupabaseAnonKey"),
            signInWithApple: value("SGSignInWithApple")?.uppercased() == "YES",
            signInWithEmail: value("SGSignInEmail")?.uppercased() == "YES",
            signInWithNaver: value("SGSignInNaver")?.uppercased() == "YES")
    }()
}
