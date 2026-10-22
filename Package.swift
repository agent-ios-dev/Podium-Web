// swift-tools-version: 6.2
import PackageDescription
let package = Package(name: "PodiumWeb", products: [.executable(name: "podium-core", targets: ["PodiumCore"])],
    dependencies: [.package(url: "https://github.com/krzyzanowskim/CryptoSwift.git", exact: "1.8.4")],
    targets: [.target(name: "BrowserHost", path: "Host"), .executableTarget(name: "PodiumCore", dependencies: ["CryptoSwift", "BrowserHost"], path: "Sources")], swiftLanguageModes: [.v5])
