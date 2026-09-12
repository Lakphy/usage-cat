import Foundation
import UsageCatMenuCore

/// Standalone assertions for the pure parts of the client. The app is built with
/// Command Line Tools, where XCTest and Swift Testing are unavailable, so checks
/// run as a plain executable: `swift run UsageCatMenuCheck`.
@main
struct UsageCatMenuCheck {
    static func main() {
        let check = Checker()
        checkURLResolution(check)
        checkQuotaFormatting(check)
        checkTypedWireValues(check)
        checkMetricSelection(check)
        checkWidgetSelection(check)
        checkWidgetContent(check)
        checkDecoding(check)
        check.finish()
    }

    // MARK: - URL resolution

    private static func checkURLResolution(_ check: Checker) {
        let dashboardURL = "https://usage.example.com/api/v1/public/dashboard"

        for input in ["https://usage.example.com", "https://usage.example.com/", "usage.example.com", dashboardURL] {
            check.expectNoThrow("resolve \(input)") {
                let url = try DashboardURL.resolve(input)
                check.expect(url.absoluteString == dashboardURL, "\(input) resolves to the dashboard path")
            }
        }

        check.expectNoThrow("origin round trip") {
            let url = try DashboardURL.resolve(dashboardURL)
            check.expect(
                DashboardURL.origin(from: url).absoluteString == "https://usage.example.com/",
                "origin strips the dashboard path"
            )
        }

        do {
            _ = try DashboardURL.resolve("   ")
            check.expect(false, "blank URL should throw")
        } catch DashboardError.emptyURL {
        } catch {
            check.expect(false, "blank URL threw \(error) instead of emptyURL")
        }
    }

    // MARK: - Formatting

    private static func checkQuotaFormatting(_ check: Checker) {
        let weekly = Fixtures.weekly
        check.expect(UsageFormat.hasRemainingSemantics(weekly), "quota window has remaining semantics")
        check.expect(UsageFormat.quotaRemaining(weekly) == 80, "remaining is 80")
        check.expect(UsageFormat.quotaRemainingPercentage(weekly) == 80, "remaining percent is 80")
        check.expect(UsageFormat.progressFraction(weekly) == 0.8, "bar fills to the remaining fraction")
        check.expect(UsageFormat.metricSummary(weekly).contains("80"), "summary includes remaining")
        check.expect(UsageFormat.metricSummary(weekly).contains("100"), "summary includes the limit")
        check.expect(UsageFormat.leftoverPhrase(weekly) == "80% left", "leftover reads as a percentage")
        check.expect(UsageFormat.resetPhrase(1_700_604_800) != nil, "reset phrase is present")
        check.expect(UsageFormat.resetPhrase(nil) == nil, "no reset date means no phrase")

        let cents = Fixtures.cents
        check.expect(UsageFormat.quotaRemaining(cents) == 750, "remaining derived from used and limit")
        check.expect(UsageFormat.metricValue(cents) == "$2.50", "USD cents format as dollars")
        check.expect(UsageFormat.leftoverPhrase(cents) == "75% left", "cents quota reads as a percentage")

        let balance = UsageMetric(key: "codex-credits", label: "Credits", kind: "balance", unit: "credits", value: 12.5)
        check.expect(!UsageFormat.hasRemainingSemantics(balance), "a bare balance has no quota semantics")
        check.expect(UsageFormat.metricValue(balance) == "12.5 credits", "balance value spells out the unit")
        check.expect(UsageFormat.leftoverPhrase(balance) == "12.5 left", "balance caption omits the unit")
        check.expect(UsageFormat.progressFraction(balance) == nil, "a bare balance draws no bar")

        check.expect(UsageFormat.metricLabel(weekly) == "Weekly quota", "known keys use the English label")
        check.expect(
            UsageFormat.metricLabel(UsageMetric(key: "unknown-key", label: "服务端标签", kind: "balance", unit: "x"))
                == "服务端标签",
            "unknown keys fall back to the server label"
        )
        check.expect(UsageFormat.providerTitle("kimi") == "Kimi", "known provider title")
        check.expect(UsageFormat.providerTitle("brand-new") == "brand-new", "unknown provider passes through")
        check.expect(UsageFormat.localizedPlan("Kimi Code（中国区）") == "Kimi Code (China)", "plan is translated")
        check.expect(UsageFormat.localizedPlan(nil) == nil, "missing plan stays missing")
    }

    /// Wire values stay `String` on the models, so unknown ones must degrade
    /// rather than break decoding.
    private static func checkTypedWireValues(_ check: Checker) {
        check.expect(Fixtures.monitor.monitorStatus == .healthy, "known status maps to a case")
        check.expect(
            PublicIntegration(id: "x", provider: "kimi", displayName: "Kimi", status: "teleporting")
                .monitorStatus == .unknown,
            "unknown status degrades to .unknown"
        )
        check.expect(Fixtures.weekly.metricKind == .quotaWindow, "quota_window maps to a case")
        check.expect(Fixtures.cents.metricUnit == .usdCents, "USD cents maps to a case")
        check.expect(Fixtures.weekly.metricUnit == .other("credits"), "other units keep their wire name")
    }

    // MARK: - Widget selection

    private static func checkMetricSelection(_ check: Checker) {
        let id = MetricSelection.identifier(monitorID: "monitor-1", metricKey: "kimi-weekly")
        check.expect(id == "monitor-1::kimi-weekly", "identifier joins with the separator")
        let parsed = MetricSelection.parse(id)
        check.expect(parsed?.monitorID == "monitor-1", "parse recovers the monitor")
        check.expect(parsed?.metricKey == "kimi-weekly", "parse recovers the metric key")
        for bad in ["", "monitor-1", "::kimi-weekly", "monitor-1::"] {
            check.expect(MetricSelection.parse(bad) == nil, "\"\(bad)\" is not a selection")
        }
        check.expect(
            MetricSelection.parse("a::b::c")?.metricKey == "b::c",
            "only the first separator splits, so keys may contain one"
        )
    }

    private static func checkWidgetSelection(_ check: Checker) {
        check.expect(WidgetSelection().isEmpty, "a fresh selection is empty")
        check.expect(WidgetSelection(monitorID: "").monitorID == nil, "a blank monitor id normalises to nil")
        check.expect(!WidgetSelection(metricIDs: ["a::b"]).isEmpty, "bars alone are a selection")

        let mixed = WidgetSelection(
            monitorID: "monitor-1",
            metricIDs: ["monitor-1::kimi-weekly", "monitor-2::other", "legacy-key"]
        )
        check.expect(
            mixed.pruned().metricIDs == ["monitor-1::kimi-weekly", "legacy-key"],
            "pruning drops bars from another monitor and keeps unscoped ones"
        )

        let stored = WidgetSelection(monitorID: "monitor-9", metricIDs: ["monitor-9::a"])
        check.expect(
            WidgetSelection().merged(fallback: stored) == stored,
            "an empty configuration falls back to what was stored"
        )
        check.expect(
            WidgetSelection(monitorID: "monitor-1").merged(fallback: stored).monitorID == "monitor-1",
            "a configured monitor wins over the stored one"
        )
        check.expect(
            WidgetSelection(monitorID: "monitor-1").merged(fallback: stored).metricIDs == ["monitor-9::a"],
            "each half falls back independently"
        )
    }

    private static func checkWidgetContent(_ check: Checker) {
        let dashboard = Fixtures.dashboard
        check.expect(
            WidgetContentResolver.resolve(dashboard: nil, selection: WidgetSelection()) == .noData,
            "no dashboard means no data"
        )
        check.expect(
            WidgetContentResolver.resolve(
                dashboard: DashboardResponse(data: [], generatedAt: 0),
                selection: WidgetSelection()
            ) == .noData,
            "an empty dashboard means no data"
        )
        check.expect(
            WidgetContentResolver.resolve(dashboard: dashboard, selection: WidgetSelection(monitorID: "gone"))
                == .monitorUnavailable,
            "a configured monitor that vanished is reported, not silently swapped"
        )

        guard case .monitor(let firstMonitor, let defaults) = WidgetContentResolver.resolve(
            dashboard: dashboard,
            selection: WidgetSelection()
        ) else {
            return check.expect(false, "an unconfigured widget shows the first monitor")
        }
        check.expect(firstMonitor.id == Fixtures.monitor.id, "unconfigured picks the first monitor")
        check.expect(defaults.map(\.key) == ["kimi-weekly", "kimi-booster-balance"], "defaults to the leading bars")

        let reordered = WidgetSelection(
            monitorID: Fixtures.monitor.id,
            metricIDs: [
                MetricSelection.identifier(monitorID: Fixtures.monitor.id, metricKey: "kimi-platform-cash-balance"),
                MetricSelection.identifier(monitorID: Fixtures.monitor.id, metricKey: "kimi-weekly"),
                MetricSelection.identifier(monitorID: Fixtures.monitor.id, metricKey: "kimi-weekly"),
            ]
        )
        guard case .monitor(_, let picked) = WidgetContentResolver.resolve(dashboard: dashboard, selection: reordered)
        else {
            return check.expect(false, "a configured widget shows its monitor")
        }
        check.expect(
            picked.map(\.key) == ["kimi-platform-cash-balance", "kimi-weekly"],
            "bars keep the chosen order and duplicates collapse"
        )

        let unknownBars = WidgetSelection(
            monitorID: Fixtures.monitor.id,
            metricIDs: [MetricSelection.identifier(monitorID: Fixtures.monitor.id, metricKey: "retired-metric")]
        )
        guard case .monitor(_, let fallback) = WidgetContentResolver.resolve(
            dashboard: dashboard,
            selection: unknownBars
        ) else {
            return check.expect(false, "a stale bar still shows the monitor")
        }
        check.expect(
            fallback.map(\.key) == ["kimi-weekly", "kimi-booster-balance"],
            "bars that no longer exist fall back to the leading ones"
        )

        guard case .monitor(_, let capped) = WidgetContentResolver.resolve(
            dashboard: dashboard,
            selection: WidgetSelection(),
            limit: 1
        ) else {
            return check.expect(false, "limit applies to the default bars")
        }
        check.expect(capped.count == 1, "the limit caps how many bars are returned")
    }

    // MARK: - Decoding

    private static func checkDecoding(_ check: Checker) {
        let json = Data(
            """
            {"data":[{"id":"8f2c1a6e-4b91-4d0e-9c3a-1e7b5d2f0a44","provider":"kimi","displayName":"Kimi",\
            "publicIdentity":"user@example.com","plan":"Kimi Code","status":"healthy","enabled":true,\
            "intervalMinutes":15,"lastSyncedAt":1700000000,"metrics":[{"key":"kimi-weekly","label":"每周额度",\
            "kind":"quota_window","unit":"credits","used":20,"limit":100,"remaining":80,"percentage":20,\
            "resetAt":1700604800}]}],"generatedAt":1700000000}
            """.utf8
        )
        check.expectNoThrow("dashboard decode") {
            let response = try JSONDecoder().decode(DashboardResponse.self, from: json)
            check.expect(response.data.count == 1, "one monitor")
            check.expect(response.data[0].displayName == "Kimi", "display name")
            check.expect(response.data[0].metrics[0].key == "kimi-weekly", "metric key")
            check.expect(response.generatedAt == 1_700_000_000, "generatedAt")

            let round = try JSONDecoder().decode(
                DashboardResponse.self,
                from: try JSONEncoder().encode(response)
            )
            check.expect(round == response, "the cached snapshot survives a round trip")
        }
    }
}

private enum Fixtures {
    static let weekly = UsageMetric(
        key: "kimi-weekly",
        label: "每周额度",
        kind: "quota_window",
        unit: "credits",
        used: 20,
        limit: 100,
        remaining: 80,
        percentage: 20,
        resetAt: 1_700_604_800
    )

    static let cents = UsageMetric(
        key: "cursor-models",
        label: "Cursor Models",
        kind: "quota_window",
        unit: "USD cents",
        used: 250,
        limit: 1000
    )

    static let balance = UsageMetric(
        key: "kimi-booster-balance",
        label: "Booster",
        kind: "balance",
        unit: "credits",
        value: 42
    )

    static let cash = UsageMetric(
        key: "kimi-platform-cash-balance",
        label: "Cash",
        kind: "balance",
        unit: "USD cents",
        value: 900
    )

    static let monitor = PublicIntegration(
        id: "monitor-1",
        provider: "kimi",
        displayName: "Kimi",
        plan: "Kimi Code",
        status: "healthy",
        metrics: [weekly, balance, cash]
    )

    static let dashboard = DashboardResponse(
        data: [monitor, PublicIntegration(id: "monitor-2", provider: "codex", displayName: "Codex", status: "pending")],
        generatedAt: 1_700_000_000
    )
}

private final class Checker {
    private var failures = 0

    func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard !condition() else { return }
        fputs("FAIL \(message)\n", stderr)
        failures += 1
    }

    func expectNoThrow(_ label: String, _ body: () throws -> Void) {
        do {
            try body()
        } catch {
            expect(false, "\(label) threw \(error)")
        }
    }

    func finish() -> Never {
        if failures == 0 {
            print("UsageCatMenuCheck passed")
            exit(0)
        }
        fputs("UsageCatMenuCheck failed with \(failures) failure(s)\n", stderr)
        exit(1)
    }
}
