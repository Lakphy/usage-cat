import AppKit

@MainActor
protocol PanelDismissMonitorDelegate: AnyObject {
    /// True when the point is on the panel or its status item.
    func panelContains(_ screenPoint: NSPoint) -> Bool
    func dismissPanel()
}

/// Watches for the gestures that should close the menu panel: a click anywhere
/// outside it, or Escape. A borderless panel gets no such handling for free.
@MainActor
final class PanelDismissMonitor {
    private enum Key {
        static let escape: UInt16 = 53
    }

    weak var delegate: PanelDismissMonitorDelegate?

    private var monitors: [Any] = []

    func start() {
        stop()
        let mouseEvents: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown]

        // Clicks in another app, which never reach a local monitor.
        let global = NSEvent.addGlobalMonitorForEvents(
            matching: mouseEvents,
            handler: { [weak self] _ in
                Task { @MainActor in self?.dismissIfOutside() }
            }
        )

        let localMouse = NSEvent.addLocalMonitorForEvents(
            matching: mouseEvents,
            handler: { [weak self] event in
                Task { @MainActor in self?.dismissIfOutside() }
                return event
            }
        )

        let localKey = NSEvent.addLocalMonitorForEvents(
            matching: .keyDown,
            handler: { [weak self] event in
                guard event.keyCode == Key.escape else { return event }
                Task { @MainActor in self?.delegate?.dismissPanel() }
                return nil
            }
        )

        monitors = [global, localMouse, localKey].compactMap { $0 }
    }

    func stop() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
    }

    private func dismissIfOutside() {
        guard let delegate, !delegate.panelContains(NSEvent.mouseLocation) else { return }
        delegate.dismissPanel()
    }
}
