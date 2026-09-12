import AppKit
import Combine
import SwiftUI

/// Owns the status item and the panel it toggles.
@MainActor
final class MenuBarController: NSObject, NSWindowDelegate {
    private let model: AppModel
    private let layout = MenuLayout()
    private let statusItem: NSStatusItem
    private let hosting: NSHostingView<AnyView>
    private let panel: MenuPanel
    private let dismissMonitor = PanelDismissMonitor()
    private var cancellables = Set<AnyCancellable>()

    init(model: AppModel, onOpenSettings: @escaping () -> Void) {
        self.model = model
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        hosting = NSHostingView(
            rootView: AnyView(
                MenuContent(openSettings: onOpenSettings)
                    .environmentObject(model)
                    .environmentObject(layout)
            )
        )
        hosting.sizingOptions = .intrinsicContentSize
        hosting.safeAreaRegions = []
        panel = MenuPanel(content: hosting)

        super.init()
        dismissMonitor.delegate = self
        panel.delegate = self
        configureStatusItem()
        observeContentChanges()
    }

    @objc func togglePanel(_ sender: Any?) {
        if panel.isVisible {
            hide()
        } else {
            show()
        }
    }

    func show() {
        resizePanelToContent()
        if let button = statusItem.button {
            panel.position(below: button)
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        statusItem.button?.isHighlighted = true
        dismissMonitor.start()
    }

    func hide() {
        dismissMonitor.stop()
        panel.orderOut(nil)
        statusItem.button?.isHighlighted = false
    }

    /// Keeps the panel open while a submenu or picker of ours takes key window.
    func windowDidResignKey(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.panel.isVisible else { return }
            if let key = NSApp.keyWindow {
                if key === self.panel { return }
                let name = String(describing: type(of: key))
                if key.level == .popUpMenu || name.contains("Menu") { return }
            }
            self.hide()
        }
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }
        button.toolTip = "Usage Cat"
        button.target = self
        button.action = #selector(togglePanel(_:))
        button.sendAction(on: [.leftMouseUp])
        updateStatusImage()
    }

    private func observeContentChanges() {
        for publisher in [model.objectWillChange, layout.objectWillChange] {
            publisher
                .receive(on: DispatchQueue.main)
                .sink { [weak self] _ in self?.contentDidChange() }
                .store(in: &cancellables)
        }
    }

    private func contentDidChange() {
        updateStatusImage()
        guard panel.isVisible else { return }
        // The published change has not been rendered yet, so measure next turn.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.resizePanelToContent()
            if let button = self.statusItem.button {
                self.panel.position(below: button)
            }
        }
    }

    private func resizePanelToContent() {
        hosting.invalidateIntrinsicContentSize()
        hosting.layoutSubtreeIfNeeded()
        var size = hosting.fittingSize
        if size.width < 10 || size.height < 10 {
            size = hosting.intrinsicContentSize
        }
        size.width = MenuPanelMetrics.width
        if size.height < MenuPanelMetrics.minimumHeight {
            size.height = MenuPanelMetrics.fallbackHeight
        }
        size.height = min(size.height, MenuPanelMetrics.maxHeight)
        panel.setContentSize(size)
        panel.invalidateShadow()
    }

    private func updateStatusImage() {
        let symbol: String
        switch model.worstStatus {
        case .actionRequired: symbol = "exclamationmark.triangle.fill"
        case .pending: symbol = "clock.fill"
        case .healthy, .unknown: symbol = "cat.fill"
        }
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Usage Cat")
        image?.isTemplate = true
        statusItem.button?.image = image
    }

}

extension MenuBarController: PanelDismissMonitorDelegate {
    func panelContains(_ screenPoint: NSPoint) -> Bool {
        if panel.frame.contains(screenPoint) { return true }
        guard let button = statusItem.button, let window = button.window else { return false }
        let anchor = window.convertToScreen(button.convert(button.bounds, to: nil))
        return anchor.contains(screenPoint)
    }

    func dismissPanel() {
        hide()
    }
}
