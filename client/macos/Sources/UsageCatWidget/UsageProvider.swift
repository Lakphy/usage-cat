import Foundation
import UsageCatIntents
import UsageCatMenuCore
import WidgetKit

struct UsageEntry: TimelineEntry {
    let date: Date
    let content: WidgetContent
    /// Set when there is nothing to draw and the reason is worth showing.
    let message: String?
}

struct UsageProvider: AppIntentTimelineProvider {
    private static let refreshInterval: TimeInterval = 15 * 60

    func placeholder(in context: Context) -> UsageEntry {
        entry(dashboard: SnapshotStore.dashboard(), selection: WidgetSelectionStore.load())
    }

    func snapshot(for configuration: UsageCatWidgetIntent, in context: Context) async -> UsageEntry {
        let selection = resolveSelection(configuration)
        return entry(dashboard: SnapshotStore.dashboard(), selection: selection, allowNetwork: false)
    }

    func timeline(for configuration: UsageCatWidgetIntent, in context: Context) async -> Timeline<UsageEntry> {
        let selection = resolveSelection(configuration)
        let dashboard = await DashboardLoader.cachedOrFetch()
        let entry = entry(dashboard: dashboard, selection: selection)
        return Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(Self.refreshInterval)))
    }

    /// Prefers what WidgetKit hands us and remembers it, falling back to the
    /// last known selection when the configuration arrives empty.
    ///
    /// This translation lives here rather than on the intent because
    /// `appintentsmetadataprocessor` cannot parse computed properties on an
    /// intent type.
    private func resolveSelection(_ configuration: UsageCatWidgetIntent) -> WidgetSelection {
        let configured = WidgetSelection(
            monitorID: configuration.monitorID,
            metricIDs: [configuration.firstUsage, configuration.secondUsage].compactMap { $0 }
        ).pruned()
        WidgetSelectionStore.save(configured)
        return configured.merged(fallback: WidgetSelectionStore.load())
    }

    private func entry(
        dashboard: DashboardResponse?,
        selection: WidgetSelection,
        allowNetwork: Bool = true
    ) -> UsageEntry {
        UsageEntry(
            date: Date(),
            content: WidgetContentResolver.resolve(dashboard: dashboard, selection: selection),
            message: dashboard == nil ? unavailableMessage(allowNetwork: allowNetwork) : nil
        )
    }

    private func unavailableMessage(allowNetwork: Bool) -> String {
        if SnapshotStore.serverURL().isEmpty {
            return "Open Usage Cat and add a server URL."
        }
        return allowNetwork ? "Couldn’t load usage." : "Waiting for Usage Cat to refresh."
    }
}
