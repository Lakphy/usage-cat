import Foundation

/// Remembers the widget's configured monitor and bars.
///
/// WidgetKit already persists the configuration intent, but a cold timeline
/// request can arrive with an empty configuration. This file-backed copy is the
/// fallback for that case. It deliberately avoids `UserDefaults`: the app
/// rewrites the widget's preference plist to seed the snapshot, which would
/// clobber anything the widget wrote there itself.
public enum WidgetSelectionStore: Sendable {
    public static func load() -> WidgetSelection {
        guard let file = SharedPaths.selectionFile,
              let data = try? Data(contentsOf: file),
              let stored = try? JSONDecoder().decode(WidgetSelection.self, from: data)
        else { return WidgetSelection() }
        return stored
    }

    /// Ignores an entirely empty selection so an unconfigured timeline request
    /// cannot erase what the user picked.
    public static func save(_ selection: WidgetSelection) {
        guard !selection.isEmpty else { return }
        guard let file = SharedPaths.selectionFile,
              let data = try? JSONEncoder().encode(selection)
        else { return }
        SharedPaths.write(data, to: file)
    }
}
