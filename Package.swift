// swift-tools-version: 5.9
// Root SwiftPM manifest so the Pulse Swift library can be consumed as a remote
// git dependency (SwiftPM requires Package.swift at the repository root for URL-
// based deps). The library sources live under packages/pulse/swift/ alongside
// the standalone package manifest used for local `swift build`/`swift test`.
// This root manifest points at those same sources — there is no code duplication.
import PackageDescription

let package = Package(
    name: "Pulse",
    platforms: [
        .macOS(.v12), .iOS(.v15),
    ],
    products: [
        .library(name: "Pulse", targets: ["Pulse"]),
    ],
    targets: [
        .target(
            name: "Pulse",
            path: "packages/pulse/swift/Sources/Pulse"
        ),
        .testTarget(
            name: "PulseTests",
            dependencies: ["Pulse"],
            path: "packages/pulse/swift/Tests/PulseTests",
            resources: [
                // The byte-exact wire fixtures shared with the TS suite.
                .copy("wire.json"),
            ]
        ),
    ]
)
