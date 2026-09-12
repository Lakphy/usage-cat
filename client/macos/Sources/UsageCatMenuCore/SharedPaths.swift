import Darwin
import Foundation

/// File locations shared between the menu bar app and the widget extension.
///
/// The widget is sandboxed and may only touch its own container, so the app
/// writes a copy of every shared file into the widget container as well.
/// Reading the real home directory from inside the widget would trip TCC, so
/// the widget-container paths are only resolved in the app process.
enum SharedPaths {
    static let widgetBundleID = "me.lakphy.usage-cat.menu.widget"

    private static let directoryName = "Usage Cat"
    private static let snapshotFileName = "shared-store.json"
    private static let selectionFileName = "widget-selection.json"

    static var isWidgetProcess: Bool {
        Bundle.main.bundleIdentifier == widgetBundleID
            || Bundle.main.bundlePath.hasSuffix(".appex")
    }

    /// Application Support for the current process: the real home for the app,
    /// the sandbox container for the widget.
    private static var localDirectory: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    private static var widgetDirectory: URL? {
        guard !isWidgetProcess, let home = realUserHome else { return nil }
        return home.appendingPathComponent(
            "Library/Containers/\(widgetBundleID)/Data/Library/Application Support/\(directoryName)",
            isDirectory: true
        )
    }

    /// Every location the snapshot should be written to, app copy first.
    static var snapshotFiles: [URL] {
        [localDirectory, widgetDirectory]
            .compactMap { $0?.appendingPathComponent(snapshotFileName) }
    }

    /// The widget owns its selection, so it lives in a single per-process file.
    static var selectionFile: URL? {
        localDirectory?.appendingPathComponent(selectionFileName)
    }

    static var widgetPreferencesFile: URL? {
        guard let home = realUserHome else { return nil }
        return home.appendingPathComponent(
            "Library/Containers/\(widgetBundleID)/Data/Library/Preferences/\(widgetBundleID).plist"
        )
    }

    /// `NSHomeDirectory()` is container-relative under the sandbox.
    private static var realUserHome: URL? {
        guard let pw = getpwuid(getuid()) else { return nil }
        return URL(fileURLWithPath: String(cString: pw.pointee.pw_dir), isDirectory: true)
    }

    static func write(_ data: Data, to file: URL) {
        try? FileManager.default.createDirectory(
            at: file.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: file, options: .atomic)
    }
}
