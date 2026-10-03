import Foundation
import os

/// Developer diagnostics from the core. Messages are short, content-free
/// strings (phases, counts, error categories); the core never passes record
/// content here. They are still logged as `.private` so that nothing reaches
/// sysdiagnose in clear text if that rule is ever broken.
enum CoreLog {
    private static let logger = Logger(subsystem: "app.supergongik", category: "core")

    static func log(level: String, message: String) {
        switch level {
        case "error": logger.error("\(message, privacy: .private)")
        case "info": logger.info("\(message, privacy: .private)")
        default: logger.debug("\(message, privacy: .private)")
        }
    }
}
