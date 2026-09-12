import Foundation

/// What the user picked in the widget editor: one monitor and the bars to show.
public struct WidgetSelection: Codable, Equatable, Sendable {
    public var monitorID: String?
    public var metricIDs: [String]

    public init(monitorID: String? = nil, metricIDs: [String] = []) {
        self.monitorID = monitorID?.isEmpty == true ? nil : monitorID
        self.metricIDs = metricIDs
    }

    public var isEmpty: Bool {
        monitorID == nil && metricIDs.isEmpty
    }

    /// Drops bars that belong to a different monitor, which is what the stored
    /// configuration looks like right after the user switches apps.
    public func pruned() -> WidgetSelection {
        guard let monitorID else { return self }
        let kept = metricIDs.filter { id in
            // An id without a monitor prefix predates scoping; keep it.
            guard let parsed = MetricSelection.parse(id) else { return true }
            return parsed.monitorID == monitorID
        }
        return WidgetSelection(monitorID: monitorID, metricIDs: kept)
    }

    /// Falls back to `other` for whichever half is missing.
    public func merged(fallback other: WidgetSelection) -> WidgetSelection {
        WidgetSelection(
            monitorID: monitorID ?? other.monitorID,
            metricIDs: metricIDs.isEmpty ? other.metricIDs : metricIDs
        )
    }
}

/// Encodes a bar as `<monitor id>::<metric key>` so the widget configuration
/// can round-trip it as a plain string.
public enum MetricSelection {
    private static let separator = "::"

    public static func identifier(monitorID: String, metricKey: String) -> String {
        "\(monitorID)\(separator)\(metricKey)"
    }

    public static func parse(_ id: String) -> (monitorID: String, metricKey: String)? {
        guard let range = id.range(of: separator) else { return nil }
        let monitorID = String(id[..<range.lowerBound])
        let metricKey = String(id[range.upperBound...])
        guard !monitorID.isEmpty, !metricKey.isEmpty else { return nil }
        return (monitorID, metricKey)
    }
}

/// What the widget should draw for a given dashboard and selection.
public enum WidgetContent: Equatable, Sendable {
    case noData
    case monitorUnavailable
    case monitor(PublicIntegration, metrics: [UsageMetric])
}

public enum WidgetContentResolver {
    public static let metricLimit = 2

    public static func resolve(
        dashboard: DashboardResponse?,
        selection: WidgetSelection,
        limit: Int = metricLimit
    ) -> WidgetContent {
        guard let monitors = dashboard?.data, !monitors.isEmpty else { return .noData }

        let monitor: PublicIntegration
        if let id = selection.monitorID {
            guard let match = monitors.first(where: { $0.id == id }) else {
                return .monitorUnavailable
            }
            monitor = match
        } else {
            monitor = monitors[0]
        }

        return .monitor(monitor, metrics: metrics(of: monitor, selection: selection, limit: limit))
    }

    /// Selected bars in the order the user chose them, falling back to the
    /// monitor's leading bars when nothing applies.
    private static func metrics(
        of monitor: PublicIntegration,
        selection: WidgetSelection,
        limit: Int
    ) -> [UsageMetric] {
        var seen = Set<String>()
        let chosen = selection.metricIDs.compactMap { id -> UsageMetric? in
            guard let parsed = MetricSelection.parse(id), parsed.monitorID == monitor.id,
                  seen.insert(parsed.metricKey).inserted,
                  let metric = monitor.metrics.first(where: { $0.key == parsed.metricKey })
            else { return nil }
            return metric
        }
        let resolved = chosen.isEmpty ? monitor.metrics : chosen
        return Array(resolved.prefix(limit))
    }
}
