import Foundation

public struct DashboardResponse: Codable, Sendable, Equatable {
    public var data: [PublicIntegration]
    public var generatedAt: Int

    public init(data: [PublicIntegration], generatedAt: Int) {
        self.data = data
        self.generatedAt = generatedAt
    }
}

public struct PublicIntegration: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var provider: String
    public var displayName: String
    public var publicIdentity: String?
    public var plan: String?
    public var status: String
    public var enabled: Bool
    public var intervalMinutes: Int
    public var lastSyncedAt: Int?
    public var metrics: [UsageMetric]

    public var monitorStatus: MonitorStatus {
        MonitorStatus(rawValue: status) ?? .unknown
    }

    public init(
        id: String,
        provider: String,
        displayName: String,
        publicIdentity: String? = nil,
        plan: String? = nil,
        status: String,
        enabled: Bool = true,
        intervalMinutes: Int = 15,
        lastSyncedAt: Int? = nil,
        metrics: [UsageMetric] = []
    ) {
        self.id = id
        self.provider = provider
        self.displayName = displayName
        self.publicIdentity = publicIdentity
        self.plan = plan
        self.status = status
        self.enabled = enabled
        self.intervalMinutes = intervalMinutes
        self.lastSyncedAt = lastSyncedAt
        self.metrics = metrics
    }
}

public struct UsageMetric: Codable, Sendable, Equatable, Identifiable {
    public var key: String
    public var label: String
    public var kind: String
    public var unit: String
    public var used: Double?
    public var limit: Double?
    public var remaining: Double?
    public var value: Double?
    public var percentage: Double?
    public var periodStart: Int?
    public var periodEnd: Int?
    public var resetAt: Int?

    public var id: String { key }

    public var metricKind: MetricKind {
        MetricKind(rawValue: kind) ?? .other
    }

    public var metricUnit: MetricUnit {
        MetricUnit(wire: unit)
    }

    public init(
        key: String,
        label: String,
        kind: String,
        unit: String,
        used: Double? = nil,
        limit: Double? = nil,
        remaining: Double? = nil,
        value: Double? = nil,
        percentage: Double? = nil,
        periodStart: Int? = nil,
        periodEnd: Int? = nil,
        resetAt: Int? = nil
    ) {
        self.key = key
        self.label = label
        self.kind = kind
        self.unit = unit
        self.used = used
        self.limit = limit
        self.remaining = remaining
        self.value = value
        self.percentage = percentage
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.resetAt = resetAt
    }
}

/// The wire values stay as `String` on the models so an unrecognised value from
/// a newer server survives a decode/encode round trip through the cache.
public enum MonitorStatus: String, Sendable {
    case healthy
    case pending
    case actionRequired = "action_required"
    case unknown
}

public enum MetricKind: String, Sendable {
    case quotaWindow = "quota_window"
    case balance
    case other
}

public enum MetricUnit: Equatable, Sendable {
    case percent
    case usdCents
    case other(String)

    init(wire: String) {
        switch wire {
        case "%": self = .percent
        case "USD cents": self = .usdCents
        default: self = .other(wire)
        }
    }
}

struct APIErrorBody: Codable, Sendable, Equatable {
    var code: String?
    var message: String?
}

struct APIErrorResponse: Codable, Sendable, Equatable {
    var error: APIErrorBody
}

public enum DashboardError: LocalizedError, Sendable, Equatable {
    case emptyURL
    case invalidURL(String)
    case httpStatus(Int)
    case api(String)
    case decoding
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .emptyURL:
            return "Enter a Usage Cat URL."
        case .invalidURL(let value):
            return "Invalid URL: \(value)"
        case .httpStatus(let status):
            return "Server returned HTTP \(status)."
        case .api(let message):
            return message
        case .decoding:
            return "The response was not dashboard JSON."
        case .transport(let message):
            return message
        }
    }
}
