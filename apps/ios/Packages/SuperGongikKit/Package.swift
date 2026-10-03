// swift-tools-version: 6.0
import PackageDescription

// SuperGongikKit holds everything that is not app-target glue: the pure-Swift
// date/progress slice, the JavaScriptCore bridge to the TypeScript reference
// core, file persistence and the HORIZON design system. It builds and tests on
// macOS with `swift test`, so domain conformance runs without a simulator.
let package = Package(
    name: "SuperGongikKit",
    defaultLocalization: "ko",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "SGFoundation", targets: ["SGFoundation"]),
        .library(name: "SGCore", targets: ["SGCore"]),
        .library(name: "SGPersistence", targets: ["SGPersistence"]),
        .library(name: "SGDesignSystem", targets: ["SGDesignSystem"]),
    ],
    targets: [
        .target(name: "SGFoundation"),
        .target(
            name: "SGPersistence",
            dependencies: ["SGFoundation"]
        ),
        .target(
            name: "SGCore",
            dependencies: ["SGFoundation", "SGPersistence"],
            resources: [.copy("Resources/sg-core.js"), .copy("Resources/sg-shims.js")]
        ),
        .target(
            name: "SGDesignSystem",
            dependencies: ["SGFoundation"]
        ),
        // Fixture loading shared by the package tests and the app's tests.
        .target(name: "SGTestSupport", dependencies: ["SGFoundation"], path: "Sources/SGTestSupport"),
        .testTarget(name: "SGFoundationTests", dependencies: ["SGFoundation", "SGTestSupport"]),
        .testTarget(name: "SGPersistenceTests", dependencies: ["SGPersistence"]),
        .testTarget(name: "SGDesignSystemTests", dependencies: ["SGDesignSystem"]),
        .testTarget(
            name: "SGCoreTests",
            dependencies: ["SGCore", "SGFoundation", "SGPersistence", "SGTestSupport"]),
    ],
    swiftLanguageModes: [.v6]
)
