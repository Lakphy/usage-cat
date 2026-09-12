import SwiftUI
import UsageCatMenuCore
import WidgetKit

struct UsageCatWidgetView: View {
    var entry: UsageEntry

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(12)
            .containerBackground(for: .widget) {
                Color.primary.opacity(0.04)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch entry.content {
        case .monitor(let integration, let metrics):
            MonitorBlock(integration: integration, metrics: metrics)
        case .monitorUnavailable:
            placeholder("That AI app is gone. Pick another in the widget editor.")
        case .noData:
            placeholder(entry.message ?? "Usage Cat")
        }
    }

    private func placeholder(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "cat.fill")
                .font(.title2)
            Text(text)
                .font(.subheadline.weight(.semibold))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct MonitorBlock: View {
    var integration: PublicIntegration
    var metrics: [UsageMetric]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(UsageFormat.providerTitle(integration.provider))
                    .font(.headline)
                    .lineLimit(1)
                if let plan = UsageFormat.localizedPlan(integration.plan) {
                    Text(plan)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            if metrics.isEmpty {
                Text("Waiting for the first snapshot")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(metrics) { metric in
                    MetricBarRow(metric: metric)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MetricBarRow: View {
    var metric: UsageMetric

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(UsageFormat.metricLabel(metric))
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            if let fraction = UsageFormat.progressFraction(metric) {
                ProgressView(value: fraction)
                    .progressViewStyle(.linear)
                    .tint(Color.primary.opacity(0.8))
            }
            Text(UsageFormat.leftoverPhrase(metric))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}
