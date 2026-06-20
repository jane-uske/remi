import WidgetKit
import SwiftUI

/// Watch-face complication for Remi. Static (no dynamic data in the MVP) — its job
/// is to put Remi one tap away on the watch face. Tapping the complication launches
/// the RemiWatch app. Supports the accessory families a watch face exposes.
struct RemiComplicationEntry: TimelineEntry {
    let date: Date
}

struct RemiComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> RemiComplicationEntry {
        RemiComplicationEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (RemiComplicationEntry) -> Void) {
        completion(RemiComplicationEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RemiComplicationEntry>) -> Void) {
        completion(Timeline(entries: [RemiComplicationEntry(date: .now)], policy: .never))
    }
}

struct RemiComplicationView: View {
    @Environment(\.widgetFamily) private var family
    var entry: RemiComplicationProvider.Entry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                ComplicationBlobView()
            }
        case .accessoryInline:
            Label("Remi", systemImage: "message.fill")
        case .accessoryRectangular:
            HStack(spacing: 6) {
                Image(systemName: "message.fill")
                    .font(.title3)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Remi").font(.headline)
                    Text("Tap to chat").font(.caption2).foregroundStyle(.secondary)
                }
            }
        case .accessoryCorner:
            ComplicationBlobView()
                .widgetLabel("Remi")
        default:
            Image(systemName: "message.fill")
        }
    }
}

struct RemiComplication: Widget {
    static let kind = "run.remi.watch.complication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: RemiComplicationProvider()) { entry in
            RemiComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Remi")
        .description("Open Remi to chat.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryInline,
            .accessoryRectangular,
            .accessoryCorner,
        ])
    }
}

/// Miniature gradient blob for watch-face complications (表盘 · Complication).
private struct ComplicationBlobView: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 15.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let breathe = 1.0 + 0.06 * sin(t * 2 * .pi / 3.4)
            let morph = CGFloat((t / 6.0).truncatingRemainder(dividingBy: 1.0))
            ComplicationBlobShape(phase: morph)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 1, green: 0.89, blue: 0.78),
                            Color(red: 1, green: 0.69, blue: 0.49),
                            Color(red: 0.88, green: 0.48, blue: 0.78),
                            Color(red: 0.36, green: 0.47, blue: 0.89),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .scaleEffect(breathe)
                .padding(4)
        }
    }
}

private struct ComplicationBlobShape: Shape {
    var phase: CGFloat
    var animatableData: CGFloat {
        get { phase }
        set { phase = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height)
        let tl = (0.42 + 0.2 * sin(phase * 2 * .pi)) * s
        let tr = (0.58 - 0.2 * sin(phase * 2 * .pi)) * s
        let br = (0.56 + 0.1 * cos(phase * 2 * .pi)) * s
        let bl = (0.44 - 0.1 * cos(phase * 2 * .pi)) * s
        return UnevenRoundedRectangle(
            topLeadingRadius: tl,
            bottomLeadingRadius: bl,
            bottomTrailingRadius: br,
            topTrailingRadius: tr
        ).path(in: rect)
    }
}

@main
struct RemiComplicationBundle: WidgetBundle {
    var body: some Widget {
        RemiComplication()
    }
}
