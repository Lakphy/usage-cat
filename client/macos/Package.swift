// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "UsageCatMenu",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "UsageCatMenuCore", targets: ["UsageCatMenuCore"]),
        .library(name: "UsageCatIntents", targets: ["UsageCatIntents"]),
        .executable(name: "UsageCatMenu", targets: ["UsageCatMenu"]),
        .executable(name: "UsageCatWidget", targets: ["UsageCatWidget"]),
    ],
    targets: [
        .target(name: "UsageCatMenuCore"),
        .target(
            name: "UsageCatIntents",
            dependencies: ["UsageCatMenuCore"]
        ),
        .executableTarget(
            name: "UsageCatMenu",
            dependencies: ["UsageCatMenuCore", "UsageCatIntents"]
        ),
        .executableTarget(
            name: "UsageCatWidget",
            dependencies: ["UsageCatMenuCore", "UsageCatIntents"],
            swiftSettings: [
                .unsafeFlags(["-application-extension"])
            ],
            linkerSettings: [
                .linkedLibrary("extension"),
                .unsafeFlags(["-Xlinker", "-e", "-Xlinker", "_NSExtensionMain"])
            ]
        ),
        .executableTarget(
            name: "UsageCatMenuCheck",
            dependencies: ["UsageCatMenuCore"]
        ),
    ]
)
