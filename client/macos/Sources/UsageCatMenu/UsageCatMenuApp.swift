import AppKit
import SwiftUI
import UsageCatIntents
import WidgetKit

@main
struct UsageCatMenuApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // `App` requires a scene, but every window here is AppKit-owned: the menu
        // panel and the settings window. This one never opens.
        Window("Usage Cat", id: "placeholder") {
            EmptyView()
        }
        .defaultLaunchBehavior(.suppressed)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = AppModel()
    private var menuBar: MenuBarController?
    private var settings: SettingsWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        // Forces UsageCatIntents to be linked into the app binary so the system
        // can resolve the widget's configuration intent from this process.
        _ = MonitorOptions()

        let settings = SettingsWindowController(model: model)
        self.settings = settings
        menuBar = MenuBarController(model: model, onOpenSettings: { settings.show() })
        model.start()
        WidgetCenter.shared.reloadAllTimelines()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
