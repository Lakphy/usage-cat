import Foundation

public enum DashboardURL {
    public static let dashboardPath = "/api/v1/public/dashboard"

    public static func resolve(_ raw: String) throws -> URL {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { throw DashboardError.emptyURL }
        if !trimmed.contains("://") {
            trimmed = "https://\(trimmed)"
        }
        guard var components = URLComponents(string: trimmed), components.host != nil else {
            throw DashboardError.invalidURL(raw)
        }
        if components.scheme == nil {
            components.scheme = "https"
        }
        let path = components.path
        if path.isEmpty || path == "/" {
            components.path = Self.dashboardPath
        } else if path.hasSuffix("/") {
            components.path = String(path.dropLast())
        }
        guard let url = components.url else {
            throw DashboardError.invalidURL(raw)
        }
        return url
    }

    public static func origin(from dashboardURL: URL) -> URL {
        var components = URLComponents(url: dashboardURL, resolvingAgainstBaseURL: false)
        if let path = components?.path, path.hasSuffix(dashboardPath) {
            let prefix = String(path.dropLast(dashboardPath.count))
            components?.path = prefix.isEmpty ? "/" : prefix
        }
        components?.query = nil
        components?.fragment = nil
        return components?.url ?? dashboardURL
    }
}
