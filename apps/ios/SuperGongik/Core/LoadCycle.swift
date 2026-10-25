import Foundation
import SGCore

/// One screen's load cycle: idle → loading → loaded or failed, with the last
/// good value kept across a later failure so the screen can keep showing it
/// under a notice instead of a spinner. Kept out of the view so a failure can
/// be injected and the recovery pinned by SuperGongikTests (급여 once showed
/// an endless spinner on any load error, because loading and failure were both
/// "no value").
///
/// Every request gets an attempt number; a result that arrives for an older
/// attempt, or after the task was cancelled (the month changed, the sheet
/// closed), is dropped rather than mistaken for the current state.
struct LoadCycle<Value> {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(Failure)
    }

    struct Failure: Equatable {
        /// User-facing copy (ErrorCopy): what happened and that records are safe.
        let message: String
        /// For 내 정보 › 문의 or a screenshot: the request and the error's kind,
        /// never its text (a core message could quote record content).
        let diagnosis: String
    }

    private(set) var phase: Phase = .idle
    private(set) var value: Value?
    /// The request the kept value answered, e.g. the month.
    private(set) var valueKey: String?
    private(set) var attempt = 0

    /// Starts a request. The returned attempt number identifies its result.
    mutating func begin() -> Int {
        attempt += 1
        phase = .loading
        return attempt
    }

    /// Nothing to load (no profile yet): back to idle, keeping any value.
    mutating func idle() {
        phase = .idle
    }

    mutating func succeed(_ attempt: Int, key: String, _ value: Value) {
        guard attempt == self.attempt else { return }
        self.value = value
        valueKey = key
        phase = .loaded
    }

    /// A cancelled request is not a failure: the attempt that replaced it owns
    /// the phase. Any other error ends this attempt in `.failed`.
    mutating func fail(_ attempt: Int, key: String, error: any Error, message: String) {
        guard attempt == self.attempt, !(error is CancellationError) else { return }
        phase = .failed(Failure(message: message, diagnosis: Self.diagnosis(key: key, error: error)))
    }

    /// The kept value, only when it answers `key` (a stale month is not shown).
    func value(for key: String) -> Value? {
        valueKey == key ? value : nil
    }

    static func diagnosis(key: String, error: any Error) -> String {
        let kind: String
        switch error {
        case let core as CoreError:
            switch core {
            case .javaScript: kind = "JavaScript 오류"
            case .decoding: kind = "결과 형식 오류"
            case .notJSON: kind = "결과 없음"
            case .bundleMissing, .incompatibleBundle: kind = "코어 번들 오류"
            }
        default:
            kind = String(describing: type(of: error))
        }
        return "\(key) · \(kind)"
    }
}
