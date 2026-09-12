import AppKit
import SwiftUI

/// A real `NSWindow` rather than a SwiftUI `Settings` scene: an accessory app
/// gets no menu bar, so nothing would open that scene.
@MainActor
final class SettingsWindowController: NSObject, NSWindowDelegate {
    private static let contentSize = NSSize(width: 480, height: 360)

    private let model: AppModel
    private var window: NSWindow?

    init(model: AppModel) {
        self.model = model
        super.init()
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        if window == nil {
            window = makeWindow()
        }
        window?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        window?.orderOut(nil)
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.contentSize),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Settings"
        window.isReleasedWhenClosed = false
        window.delegate = self
        let hosting = NSHostingView(rootView: SettingsView().environmentObject(model))
        hosting.sizingOptions = .intrinsicContentSize
        window.contentView = hosting
        window.setContentSize(Self.contentSize)
        window.center()
        return window
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Form {
            Section {
                TextField("Server URL", text: $model.serverURL, prompt: Text("https://usage.example.com"))
                    .onSubmit { save() }
                Toggle("Open at Login", isOn: loginBinding)
            } header: {
                Text("Dashboard")
            } footer: {
                Text("Paste the site origin or the public dashboard URL. One request loads every monitor.")
            }

            if let error = model.lastError {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
            }

            Section {
                Button("Save", action: save)
            }
        }
        .formStyle(.grouped)
        .frame(width: 480, height: 320)
    }

    private func save() {
        Task { await model.saveURLAndRefresh() }
    }

    private var loginBinding: Binding<Bool> {
        Binding(
            get: { model.launchAtLogin },
            set: { model.setLaunchAtLogin($0) }
        )
    }
}
