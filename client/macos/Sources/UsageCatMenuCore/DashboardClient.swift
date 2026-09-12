import Foundation

public struct DashboardClient: Sendable {
    public var session: URLSession
    public var timeout: TimeInterval

    public init(session: URLSession = .shared, timeout: TimeInterval = 15) {
        self.session = session
        self.timeout = timeout
    }

    public func fetch(from rawURL: String) async throws -> DashboardResponse {
        let url = try DashboardURL.resolve(rawURL)
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("UsageCatMenu/0.1", forHTTPHeaderField: "User-Agent")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            // A superseded refresh is not a failure worth showing.
            throw CancellationError()
        } catch {
            throw DashboardError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw DashboardError.transport("No HTTP response.")
        }
        if !(200 ... 299).contains(http.statusCode) {
            if let apiError = try? JSONDecoder().decode(APIErrorResponse.self, from: data),
               let message = apiError.error.message, !message.isEmpty
            {
                throw DashboardError.api(message)
            }
            throw DashboardError.httpStatus(http.statusCode)
        }
        do {
            return try JSONDecoder().decode(DashboardResponse.self, from: data)
        } catch {
            throw DashboardError.decoding
        }
    }
}
