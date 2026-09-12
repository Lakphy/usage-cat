import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let canvas = 1024
let symbolPointSize: CGFloat = 620

guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: canvas,
    pixelsHigh: canvas,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fputs("Could not create bitmap\n", stderr)
    exit(1)
}

rep.size = NSSize(width: canvas, height: canvas)
NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
    fputs("Could not create graphics context\n", stderr)
    exit(1)
}
NSGraphicsContext.current = context

NSColor.black.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: canvas, height: canvas)).fill()

let configuration = NSImage.SymbolConfiguration(pointSize: symbolPointSize, weight: .regular)
    .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
guard let symbol = NSImage(systemSymbolName: "cat.fill", accessibilityDescription: nil)?
    .withSymbolConfiguration(configuration)
else {
    fputs("Could not load cat.fill\n", stderr)
    exit(1)
}

let symbolSize = symbol.size
let origin = NSPoint(
    x: ((CGFloat(canvas) - symbolSize.width) / 2).rounded(.toNearestOrAwayFromZero),
    y: ((CGFloat(canvas) - symbolSize.height) / 2).rounded(.toNearestOrAwayFromZero) - 12
)
symbol.draw(
    in: NSRect(origin: origin, size: symbolSize),
    from: .zero,
    operation: .sourceOver,
    fraction: 1,
    respectFlipped: true,
    hints: [.interpolation: NSImageInterpolation.high]
)

NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
    fputs("Could not encode PNG\n", stderr)
    exit(1)
}

try png.write(to: output)
print("Wrote \(output.path)")
