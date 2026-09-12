import Foundation

/// Presentation strings for usage metrics. The client is English-only, so every
/// formatter is pinned to `en-US` rather than the user's locale.
public enum UsageFormat {
    private static let locale = Locale(identifier: "en-US")

    private static let englishMetricLabels: [String: String] = [
        "codex-credits": "Credits balance",
        "codex-spend-control": "Workspace quota",
        "cursor-api-usage": "API model usage",
        "cursor-auto-usage": "Auto model usage",
        "cursor-grok-bot-weekly": "Grok Bot weekly quota",
        "cursor-models": "Cursor Models",
        "cursor-other-models": "Other Models",
        "cursor-plan-usage": "Included billing-cycle quota",
        "cursor-plan-usage-percent": "Included billing-cycle quota",
        "cursor-usage-based": "On-Demand usage",
        "grok-included-credits": "Included credits quota",
        "grok-included-legacy": "Included credits quota (compatibility)",
        "grok-on-demand": "On-Demand usage",
        "grok-prepaid-balance": "Prepaid credits balance",
        "kimi-booster-balance": "Booster balance",
        "kimi-booster-monthly": "Booster monthly usage",
        "kimi-platform-available-balance": "Available balance",
        "kimi-platform-cash-balance": "Cash balance",
        "kimi-platform-voucher-balance": "Voucher balance",
        "kimi-weekly": "Weekly quota",
        "zenmux-5h": "5-hour Flow quota",
        "zenmux-7d": "7-day Flow quota",
        "zenmux-monthly-cap": "Monthly Flow cap",
    ]

    /// Labels that read as a quota rather than raw consumption once a limit exists.
    private static let quotaLabelOverrides: [String: String] = [
        "cursor-auto-usage": "Auto model quota",
        "cursor-api-usage": "API model quota",
        "cursor-usage-based": "On-Demand quota",
        "grok-on-demand": "On-Demand quota",
        "kimi-booster-monthly": "Booster monthly quota",
    ]

    private static let planTranslations: [String: String] = [
        "Kimi Code（中国区）": "Kimi Code (China)",
        "Kimi Code（海外区）": "Kimi Code (Global)",
        "Kimi 开放平台（中国区）": "Kimi Platform (China)",
        "Kimi API Platform（海外区）": "Kimi API Platform (Global)",
    ]

    private static let providerTitles: [String: String] = [
        "codex": "Codex",
        "cursor": "Cursor",
        "grok": "Grok",
        "kimi": "Kimi",
        "zenmux": "ZenMux",
    ]

    // MARK: - Quota math

    public static func hasRemainingSemantics(_ metric: UsageMetric) -> Bool {
        if metric.metricKind == .quotaWindow { return true }
        if let limit = metric.limit, limit > 0, metric.remaining != nil || metric.used != nil {
            return true
        }
        return false
    }

    public static func quotaRemaining(_ metric: UsageMetric) -> Double? {
        guard hasRemainingSemantics(metric) else { return nil }
        if let remaining = metric.remaining { return remaining }
        if let limit = metric.limit, let used = metric.used {
            return max(0, limit - used)
        }
        if let percentage = metric.percentage {
            return max(0, 100 - percentage)
        }
        return nil
    }

    public static func quotaRemainingPercentage(_ metric: UsageMetric) -> Double? {
        guard hasRemainingSemantics(metric) else { return nil }
        if let remaining = quotaRemaining(metric), let limit = metric.limit, limit > 0 {
            return min(100, max(0, (remaining / limit) * 100))
        }
        if let percentage = metric.percentage {
            return min(100, max(0, 100 - percentage))
        }
        return nil
    }

    /// Bars show headroom for quotas and raw progress for everything else.
    public static func progressValue(_ metric: UsageMetric) -> Double? {
        hasRemainingSemantics(metric) ? quotaRemainingPercentage(metric) : metric.percentage
    }

    public static func progressFraction(_ metric: UsageMetric) -> Double? {
        progressValue(metric).map { min(max($0 / 100, 0), 1) }
    }

    // MARK: - Labels

    public static func metricLabel(_ metric: UsageMetric) -> String {
        guard let known = englishMetricLabels[metric.key] else { return metric.label }
        if metric.limit != nil, let quotaLabel = quotaLabelOverrides[metric.key] {
            return quotaLabel
        }
        return known
    }

    public static func localizedPlan(_ plan: String?) -> String? {
        guard let plan else { return nil }
        return planTranslations[plan] ?? plan
    }

    public static func providerTitle(_ provider: String) -> String {
        providerTitles[provider] ?? provider
    }

    // MARK: - Values

    public static func metricValue(_ metric: UsageMetric) -> String {
        let amount = metric.metricKind == .balance ? (metric.value ?? metric.used) : metric.used
        guard let amount else { return "—" }
        return qualifiedAmount(amount, unit: metric.metricUnit)
    }

    public static func metricSummary(_ metric: UsageMetric) -> String {
        if hasRemainingSemantics(metric), let remaining = quotaRemaining(metric) {
            if metric.metricUnit == .percent {
                return "Remaining \(formatNumber(remaining))%"
            }
            if let limit = metric.limit {
                return "Remaining \(formatNumber(remaining)) / \(formatNumber(limit)) \(metric.unit)"
            }
            return "Remaining \(formatNumber(remaining)) \(metric.unit)"
        }
        if let percentage = metric.percentage {
            return "\(compactPercent(percentage))%"
        }
        return metricValue(metric)
    }

    public static func leftoverPhrase(_ metric: UsageMetric) -> String {
        if let percent = quotaRemainingPercentage(metric) {
            return "\(compactPercent(percent))% left"
        }
        if let remaining = quotaRemaining(metric) {
            return "\(bareAmount(remaining, unit: metric.metricUnit)) left"
        }
        if let value = metric.value ?? metric.used {
            return "\(bareAmount(value, unit: metric.metricUnit)) left"
        }
        return metricSummary(metric)
    }

    public static func resetPhrase(_ epoch: Int?) -> String? {
        guard let epoch else { return nil }
        let date = Date(timeIntervalSince1970: TimeInterval(epoch))
        let calendar = Calendar.current
        let time = formatted(date, format: "H:mm")
        if calendar.isDateInToday(date) {
            return "Resets \(time)"
        }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: Date())
        return "Resets \(formatted(date, format: sameYear ? "MMMM d" : "MMMM d, yyyy")) at \(time)"
    }

    // MARK: - Primitives

    static func formatNumber(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    static func compactPercent(_ value: Double) -> String {
        let text = String(format: "%.1f", value)
        return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
    }

    /// Spells the unit out, for standalone values.
    private static func qualifiedAmount(_ value: Double, unit: MetricUnit) -> String {
        switch unit {
        case .percent:
            return "\(compactPercent(value))%"
        case .usdCents:
            return String(format: "$%.2f", value / 100)
        case .other(let name):
            return "\(formatNumber(value)) \(name)"
        }
    }

    /// Drops the unit name, for captions that already sit under a labelled bar.
    private static func bareAmount(_ value: Double, unit: MetricUnit) -> String {
        switch unit {
        case .percent:
            return "\(formatNumber(value))%"
        case .usdCents:
            return String(format: "$%.2f", value / 100)
        case .other:
            return formatNumber(value)
        }
    }

    private static func formatted(_ date: Date, format: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateFormat = format
        return formatter.string(from: date)
    }
}
