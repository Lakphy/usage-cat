import SwiftUI
import UsageCatIntents
import WidgetKit

@main
struct UsageCatWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: "me.lakphy.usage-cat.widget",
            intent: UsageCatWidgetIntent.self,
            provider: UsageProvider()
        ) { entry in
            UsageCatWidgetView(entry: entry)
        }
        .configurationDisplayName("Usage Cat")
        .description("Shows one AI app. Pick which usage bars to display.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
