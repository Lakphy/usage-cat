import AppKit
import SwiftUI
import UsageCatMenuCore

struct MenuContent: View {
    var openSettings: () -> Void

    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var layout: MenuLayout

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 10)

            Divider().opacity(0.45)

            ScrollView {
                metricsStack
                    .background {
                        GeometryReader { geo in
                            Color.clear.preference(key: MenuBodyHeightKey.self, value: geo.size.height)
                        }
                    }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: scrollHeight, alignment: .top)
            .onPreferenceChange(MenuBodyHeightKey.self) { height in
                if abs(layout.bodyHeight - height) > 1 {
                    layout.bodyHeight = height
                }
            }

            Divider().opacity(0.45)
            actions
                .padding(.top, 6)
                .padding(.bottom, 10)
        }
        .frame(width: MenuPanelMetrics.width, alignment: .leading)
    }

    private var scrollHeight: CGFloat {
        let cap = MenuPanelMetrics.maxHeight - MenuPanelMetrics.chromeHeight
        if layout.bodyHeight <= 0 { return 120 }
        return min(layout.bodyHeight, cap)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("Usage Cat")
                .font(.headline)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            if let identity {
                Text(identity)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var metricsStack: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.isLoading, model.dashboard == nil {
                ProgressView()
                    .controlSize(.regular)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
            } else if !model.hasServerURL {
                emptyCopy(
                    "Add a server URL",
                    "Open Settings and paste your Usage Cat URL to load every monitor."
                )
            } else if let error = model.lastError, model.dashboard == nil {
                emptyCopy("Couldn’t load usage", error)
            } else if let dashboard = model.dashboard, dashboard.data.isEmpty {
                emptyCopy(
                    "No monitors yet",
                    "Add a subscription in the web dashboard first."
                )
            } else if let dashboard = model.dashboard {
                ForEach(Array(dashboard.data.enumerated()), id: \.element.id) { index, integration in
                    if index > 0 {
                        Divider().opacity(0.35)
                    }
                    MonitorSection(integration: integration)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actions: some View {
        VStack(spacing: 1) {
            actionRow("arrow.clockwise", "Refresh Now") {
                Task { await model.refresh() }
            }
            actionRow("gauge.with.dots.needle.67percent", "Usage Dashboard") {
                if let url = model.siteURL {
                    NSWorkspace.shared.open(url)
                }
            }
            .disabled(model.siteURL == nil)

            Divider().opacity(0.45).padding(.vertical, 5)

            actionRow(nil, "Settings…", action: openSettings)
            actionRow(nil, "Quit") {
                NSApp.terminate(nil)
            }
        }
    }

    private func emptyCopy(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.body.weight(.semibold))
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
    }

    private func actionRow(_ symbol: String?, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            actionLabel(symbol, title)
        }
        .buttonStyle(.plain)
    }

    private func actionLabel(_ symbol: String?, _ title: String) -> some View {
        HStack(spacing: 10) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.body)
                    .frame(width: 16)
            }
            Text(title)
                .font(.body)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var identity: String? {
        let monitors = model.dashboard?.data ?? []
        if monitors.count == 1 {
            let monitor = monitors[0]
            if let publicIdentity = monitor.publicIdentity, publicIdentity != monitor.displayName {
                return publicIdentity
            }
            return monitor.displayName
        }
        return model.siteURL?.host
    }
}

private struct MenuBodyHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}
