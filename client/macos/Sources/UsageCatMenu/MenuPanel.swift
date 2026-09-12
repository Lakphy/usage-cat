import AppKit
import SwiftUI

enum MenuPanelMetrics {
    /// Compact Tahoe-style continuous radius.
    static let cornerRadius: CGFloat = 24
    static let width: CGFloat = 300
    static let maxHeight: CGFloat = 560
    /// Header, dividers and the action rows, i.e. everything but the scroll area.
    static let chromeHeight: CGFloat = 200
    static let fallbackHeight: CGFloat = 240
    static let minimumHeight: CGFloat = 80
    static let screenMargin: CGFloat = 8
    static let menuBarGap: CGFloat = 6
}

/// Carries the measured height of the scrolling body so the panel can size
/// itself to its content. `@State` is unavailable here, so the measurement is
/// published from a shared object instead.
@MainActor
final class MenuLayout: ObservableObject {
    @Published var bodyHeight: CGFloat = 0
}

final class MenuPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    convenience init(content: NSView) {
        self.init(
            contentRect: NSRect(x: 0, y: 0, width: MenuPanelMetrics.width, height: 320),
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .statusBar
        isFloatingPanel = true
        hidesOnDeactivate = false
        isMovable = false
        isMovableByWindowBackground = false
        animationBehavior = .utilityWindow
        collectionBehavior = [.transient, .canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        contentView = GlassBackdrop.wrap(content)
    }

    /// Anchors the panel under the status item, nudged to stay on screen.
    func position(below button: NSStatusBarButton) {
        guard let buttonWindow = button.window else { return }
        let anchor = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
        let size = frame.size
        var origin = NSPoint(
            x: anchor.midX - size.width / 2,
            y: anchor.minY - size.height - MenuPanelMetrics.menuBarGap
        )
        if let screen = buttonWindow.screen ?? NSScreen.main {
            let visible = screen.visibleFrame
            origin.x = min(
                max(origin.x, visible.minX + MenuPanelMetrics.screenMargin),
                visible.maxX - size.width - MenuPanelMetrics.screenMargin
            )
            if origin.y < visible.minY {
                origin.y = anchor.maxY + MenuPanelMetrics.menuBarGap
            }
        }
        setFrameOrigin(origin)
    }
}

enum GlassBackdrop {
    @MainActor
    static func wrap(_ content: NSView) -> NSView {
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.cornerRadius = MenuPanelMetrics.cornerRadius
            glass.style = .regular
            glass.clipsToBounds = true
            glass.contentView = content
            if #available(macOS 27.0, *) {
                glass.effectIsInteractive = true
            }
            return glass
        }
        return visualEffectFallback(content)
    }

    @MainActor
    private static func visualEffectFallback(_ content: NSView) -> NSView {
        let effect = NSVisualEffectView()
        effect.material = .popover
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = MenuPanelMetrics.cornerRadius
        effect.layer?.cornerCurve = .continuous
        effect.layer?.masksToBounds = true
        content.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            content.topAnchor.constraint(equalTo: effect.topAnchor),
            content.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
        ])
        return effect
    }
}
