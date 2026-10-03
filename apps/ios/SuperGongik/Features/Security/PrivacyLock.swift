import LocalAuthentication
import Observation
import SGDesignSystem
import SwiftUI

/// Optional app lock and app-switcher privacy cover.
///
/// - The cover hides content whenever the scene is not active, so the
///   app-switcher snapshot never shows service records (on by default).
/// - The lock asks for Face ID / Touch ID with the device passcode as
///   fallback (`.deviceOwnerAuthentication`), so changed or failed
///   biometrics can never lock the user out of their own data.
/// Preferences are per-device UI settings, not part of the synced document.
@MainActor
@Observable
final class PrivacyLock {
    private static let lockKey = "SGPrivacyLockEnabled"
    private static let coverKey = "SGPrivacyCoverEnabled"

    var lockEnabled: Bool {
        didSet { UserDefaults.standard.set(lockEnabled, forKey: Self.lockKey) }
    }

    var coverEnabled: Bool {
        didSet { UserDefaults.standard.set(coverEnabled, forKey: Self.coverKey) }
    }

    private(set) var isLocked: Bool
    private(set) var isCovered = false
    private(set) var lastError: String?
    private var authenticating = false

    init() {
        let defaults = UserDefaults.standard
        lockEnabled = defaults.bool(forKey: Self.lockKey)
        coverEnabled = defaults.object(forKey: Self.coverKey) as? Bool ?? true
        isLocked = defaults.bool(forKey: Self.lockKey)
    }

    /// Short name of what the device offers ("Face ID", "Touch ID", "암호").
    var methodName: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "기기 암호"
        }
    }

    /// Whether the device can authenticate the owner at all (passcode set).
    var isAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            isCovered = false
            if isLocked { Task { await unlock() } }
        case .inactive:
            isCovered = coverEnabled || lockEnabled
        case .background:
            isCovered = coverEnabled || lockEnabled
            if lockEnabled { isLocked = true }
        @unknown default:
            break
        }
    }

    func unlock() async {
        guard isLocked, !authenticating else { return }
        authenticating = true
        defer { authenticating = false }
        let context = LAContext()
        context.localizedFallbackTitle = "암호 입력"
        do {
            let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "슈퍼공익 기록을 열어요")
            if ok {
                isLocked = false
                lastError = nil
            }
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .appCancel, .systemCancel: lastError = nil
            case .passcodeNotSet:
                // No passcode on the device: the lock cannot work, so it is
                // released rather than trapping the user.
                lockEnabled = false
                isLocked = false
                lastError = "기기 암호가 설정되어 있지 않아 잠금을 해제했어요."
            default:
                lastError = "확인하지 못했어요. 다시 시도해 주세요."
            }
        } catch {
            lastError = "확인하지 못했어요. 다시 시도해 주세요."
        }
    }

    /// Turning the lock on requires one successful authentication, so a user
    /// cannot enable a lock they are unable to pass.
    func setLockEnabled(_ enabled: Bool) async {
        guard enabled else {
            lockEnabled = false
            return
        }
        let context = LAContext()
        do {
            if try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "앱 잠금을 켜요") {
                lockEnabled = true
                lastError = nil
            }
        } catch {
            lastError = isAvailable ? nil : "기기 암호를 먼저 설정해 주세요."
        }
    }
}

/// Covers the screen while inactive/locked. Shows nothing personal.
struct PrivacyCoverView: View {
    @Environment(PrivacyLock.self) private var lock

    var body: some View {
        ZStack {
            SGHeroBackground().ignoresSafeArea()
            VStack(spacing: SGSpacing.md) {
                Image("BrandMark").resizable().frame(width: 72, height: 72)
                    .accessibilityHidden(true)
                Text("SUPER-GONGIK")
                    .font(SGTypography.font(17, .heavy, relativeTo: .headline))
                    .foregroundStyle(.sg(SGColor.heroForeground))
                if lock.isLocked {
                    Button {
                        Task { await lock.unlock() }
                    } label: {
                        Label("\(lock.methodName)로 열기", systemImage: "lock.open")
                    }
                    .buttonStyle(SGPrimaryButtonStyle())
                    .frame(maxWidth: 280)
                    .padding(.top, SGSpacing.lg)
                    if let error = lock.lastError {
                        Text(error).font(SGTypography.caption).foregroundStyle(.sg(SGColor.heroForeground2))
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}
