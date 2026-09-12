import AppIntents
import Foundation
import UsageCatMenuCore

/// Widget configuration.
///
/// The pickers are plain `String` parameters backed by dynamic options rather
/// than `AppEntity` parameters: entity selections did not survive the round trip
/// back into the timeline provider, so the widget always fell back to defaults.
///
/// Keep this type free of computed properties that call functions.
/// `appintentsmetadataprocessor` cannot parse the constant values the compiler
/// emits for them and silently drops the whole intent from the widget metadata.
public struct UsageCatWidgetIntent: WidgetConfigurationIntent {
    public static let title: LocalizedStringResource = "Usage Cat"
    public static let description = IntentDescription("Choose an AI app and which usage bars to show.")
    public static let isDiscoverable = false

    public static var parameterSummary: some ParameterSummary {
        Summary("\(\.$monitorID) \(\.$firstUsage) \(\.$secondUsage)")
    }

    @Parameter(title: "AI App", optionsProvider: MonitorOptions())
    public var monitorID: String?

    @Parameter(title: "Usage", optionsProvider: MetricOptions())
    public var firstUsage: String?

    @Parameter(title: "Second usage", optionsProvider: MetricOptions())
    public var secondUsage: String?

    public init() {}

    public init(monitorID: String?, firstUsage: String? = nil, secondUsage: String? = nil) {
        self.monitorID = monitorID
        self.firstUsage = firstUsage
        self.secondUsage = secondUsage
    }
}

public struct MonitorOptions: DynamicOptionsProvider {
    public init() {}

    public func results() async throws -> IntentItemCollection<String> {
        IntentItemCollection(sections: [IntentItemSection(items: await WidgetCatalog.monitors())])
    }
}

/// Bars are scoped to the app chosen in the same editor, so switching apps
/// refreshes this list.
public struct MetricOptions: DynamicOptionsProvider {
    public init() {}

    @IntentParameterDependency<UsageCatWidgetIntent>(\.$monitorID)
    var configuration

    public func results() async throws -> IntentItemCollection<String> {
        let items = await WidgetCatalog.metrics(for: configuration?.monitorID)
        return IntentItemCollection(sections: [IntentItemSection(items: items)])
    }
}

enum WidgetCatalog {
    static func monitors() async -> [IntentItem<String>] {
        guard let dashboard = await DashboardLoader.cachedOrFetch() else { return [] }
        return dashboard.data.map { integration in
            IntentItem(integration.id, title: LocalizedStringResource(stringLiteral: title(of: integration)))
        }
    }

    static func metrics(for monitorID: String?) async -> [IntentItem<String>] {
        guard let dashboard = await DashboardLoader.cachedOrFetch() else { return [] }
        let monitors = dashboard.data.filter { monitorID == nil || $0.id == monitorID }
        return monitors.flatMap { integration in
            integration.metrics.map { metric in
                IntentItem(
                    MetricSelection.identifier(monitorID: integration.id, metricKey: metric.key),
                    title: LocalizedStringResource(stringLiteral: UsageFormat.metricLabel(metric))
                )
            }
        }
    }

    private static func title(of integration: PublicIntegration) -> String {
        let software = UsageFormat.providerTitle(integration.provider)
        let name = integration.displayName
        return name.caseInsensitiveCompare(software) == .orderedSame ? software : "\(software) · \(name)"
    }
}
