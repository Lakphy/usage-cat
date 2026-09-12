import Foundation

/// Caches the server URL and the last dashboard response so the widget can
/// render before its first network call.
public enum SnapshotStore: Sendable {
    public static let urlKey = "usageCat.serverURL"
    public static let snapshotKey = "usageCat.dashboardJSON"

    public static func serverURL() -> String {
        if let stored = readSnapshot()?.serverURL, !stored.isEmpty {
            return stored
        }
        return UserDefaults.standard.string(forKey: urlKey) ?? ""
    }

    public static func saveServerURL(_ url: String) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(trimmed, forKey: urlKey)
        write(url: trimmed, dashboard: dashboard())
    }

    public static func dashboard() -> DashboardResponse? {
        newest(of: [
            readSnapshot()?.dashboard,
            decode(UserDefaults.standard.data(forKey: snapshotKey)),
        ])
    }

    public static func saveDashboard(_ dashboard: DashboardResponse) {
        if let data = try? JSONEncoder().encode(dashboard) {
            UserDefaults.standard.set(data, forKey: snapshotKey)
        }
        write(url: serverURL(), dashboard: dashboard)
    }

    private struct Snapshot: Codable {
        var serverURL: String
        var dashboard: DashboardResponse?
    }

    private static func write(url: String, dashboard: DashboardResponse?) {
        guard let data = try? JSONEncoder().encode(Snapshot(serverURL: url, dashboard: dashboard))
        else { return }
        for file in SharedPaths.snapshotFiles {
            SharedPaths.write(data, to: file)
        }
        if !SharedPaths.isWidgetProcess {
            writeWidgetPreferences(url: url, dashboard: dashboard)
        }
    }

    private static func readSnapshot() -> Snapshot? {
        for file in SharedPaths.snapshotFiles {
            if let data = try? Data(contentsOf: file),
               let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data)
            {
                return snapshot
            }
        }
        return nil
    }

    /// Seeds the widget's `UserDefaults` so a cold widget launch has data even
    /// before it can read its container files. Existing keys are preserved.
    private static func writeWidgetPreferences(url: String, dashboard: DashboardResponse?) {
        guard let file = SharedPaths.widgetPreferencesFile else { return }
        var values = (NSDictionary(contentsOf: file) as? [String: Any]) ?? [:]
        values[urlKey] = url
        if let dashboard, let data = try? JSONEncoder().encode(dashboard) {
            values[snapshotKey] = data
        }
        try? FileManager.default.createDirectory(
            at: file.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        (values as NSDictionary).write(to: file, atomically: true)
    }

    private static func decode(_ data: Data?) -> DashboardResponse? {
        guard let data else { return nil }
        return try? JSONDecoder().decode(DashboardResponse.self, from: data)
    }

    private static func newest(of candidates: [DashboardResponse?]) -> DashboardResponse? {
        candidates.compactMap { $0 }.max { $0.generatedAt < $1.generatedAt }
    }
}
