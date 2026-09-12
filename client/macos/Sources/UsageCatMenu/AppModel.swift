import Foundation
import UsageCatMenuCore
import WidgetKit

@MainActor
final class AppModel: ObservableObject {
    @Published var serverURL: String
    @Published var dashboard: DashboardResponse?
    @Published var lastError: String?
    @Published var isLoading = false
    @Published var launchAtLogin: Bool

    static let refreshInterval: Duration = .seconds(300)

    private let client: DashboardClient
    private let loginItem: LoginItemControlling
    private var pollTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?

    init(
        client: DashboardClient = DashboardClient(),
        loginItem: LoginItemControlling = LoginItem()
    ) {
        self.client = client
        self.loginItem = loginItem
        serverURL = SnapshotStore.serverURL()
        launchAtLogin = loginItem.isEnabled
    }

    var resolvedURL: URL? {
        try? DashboardURL.resolve(serverURL)
    }

    var siteURL: URL? {
        resolvedURL.map(DashboardURL.origin(from:))
    }

    var hasServerURL: Bool {
        !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Drives the menu bar icon: the most attention-worthy status across monitors.
    var worstStatus: MonitorStatus {
        let statuses = dashboard?.data.map(\.monitorStatus) ?? []
        for candidate: MonitorStatus in [.actionRequired, .pending, .healthy] {
            if statuses.contains(candidate) { return candidate }
        }
        return .unknown
    }

    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                try? await Task.sleep(for: Self.refreshInterval)
            }
        }
    }

    func saveURLAndRefresh() async {
        let trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        serverURL = trimmed
        SnapshotStore.saveServerURL(trimmed)
        do {
            _ = try DashboardURL.resolve(trimmed)
            await refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Only one fetch runs at a time; a newer request supersedes the one in flight
    /// and owns the loading state from then on.
    func refresh() async {
        guard hasServerURL else { return }
        refreshTask?.cancel()
        let task = Task { [weak self] in
            guard let self else { return }
            await self.performRefresh()
        }
        refreshTask = task
        await task.value
    }

    private func performRefresh() async {
        isLoading = true
        lastError = nil
        do {
            let response = try await client.fetch(from: serverURL)
            guard !Task.isCancelled else { return }
            dashboard = response
            SnapshotStore.saveDashboard(response)
            WidgetCenter.shared.reloadAllTimelines()
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            lastError = error.localizedDescription
        }
        isLoading = false
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            try loginItem.setEnabled(enabled)
        } catch {
            lastError = error.localizedDescription
        }
        launchAtLogin = loginItem.isEnabled
    }
}
