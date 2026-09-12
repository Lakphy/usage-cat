import Foundation

/// Cache-first dashboard access for processes without their own refresh loop,
/// such as the widget extension and the intent option providers.
public enum DashboardLoader: Sendable {
    public static func cachedOrFetch() async -> DashboardResponse? {
        let cached = SnapshotStore.dashboard()
        let url = SnapshotStore.serverURL()
        guard !url.isEmpty, let live = try? await DashboardClient().fetch(from: url) else {
            return cached
        }
        SnapshotStore.saveDashboard(live)
        return live
    }
}
