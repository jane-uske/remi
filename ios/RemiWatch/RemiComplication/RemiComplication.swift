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
                Image(systemName: "message.fill")
                    .font(.title3)
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
            Image(systemName: "message.fill")
                .font(.title3)
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

@main
struct RemiComplicationBundle: WidgetBundle {
    var body: some Widget {
        RemiComplication()
    }
}
