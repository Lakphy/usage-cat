import SwiftUI
import UsageCatMenuCore

/// One AI app in the menu: its name, plan and every metric it reports.
struct MonitorSection: View {
    var integration: PublicIntegration

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 8) {
                Text(softwareName)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                if let plan = UsageFormat.localizedPlan(integration.plan) {
                    Text(plan)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                if let accountName {
                    Text(accountName)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if integration.metrics.isEmpty {
                Text("Waiting for the first snapshot")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(integration.metrics) { metric in
                    MetricRow(metric: metric)
                }
            }
        }
    }

    private var softwareName: String {
        UsageFormat.providerTitle(integration.provider)
    }

    /// Only worth showing when it adds something beyond the software name.
    private var accountName: String? {
        let name = integration.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.caseInsensitiveCompare(softwareName) != .orderedSame else {
            return integration.publicIdentity
        }
        return name
    }
}

private struct MetricRow: View {
    var metric: UsageMetric

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(UsageFormat.metricLabel(metric))
                .font(.subheadline.weight(.semibold))
            if let fraction = UsageFormat.progressFraction(metric) {
                LeftoverBar(fraction: fraction)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(UsageFormat.leftoverPhrase(metric))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let reset = UsageFormat.resetPhrase(metric.resetAt) {
                    Text(reset)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
        }
    }
}

private struct LeftoverBar: View {
    var fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                Capsule()
                    .fill(Color.primary.opacity(0.72))
                    .frame(width: max(6, geo.size.width * fraction))
            }
        }
        .frame(height: 3)
    }
}
