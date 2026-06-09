import SwiftUI
import WebKit

@MainActor
struct RemiLive2DView: UIViewRepresentable {

    let renderer: RemiLive2DRenderer
    let emotion: String
    let phase: RemiAvatarPhase
    let lipWeight: Float

    func makeCoordinator() -> Coordinator {
        Coordinator(renderer: renderer)
    }

    func makeUIView(context: Context) -> WKWebView {
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "remiLive2D")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContentController
        configuration.setURLSchemeHandler(context.coordinator, forURLScheme: "remi-live2d")
        configuration.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.navigationDelegate = context.coordinator

        renderer.attach(webView: webView)
        webView.loadHTMLString(renderer.html(), baseURL: URL(string: "remi-live2d://bundle/"))
        renderer.update(emotion: emotion, phase: phase, lipWeight: lipWeight)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        renderer.update(emotion: emotion, phase: phase, lipWeight: lipWeight)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "remiLive2D")
        webView.navigationDelegate = nil
        webView.stopLoading()
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKURLSchemeHandler {
        private weak var renderer: RemiLive2DRenderer?

        init(renderer: RemiLive2DRenderer) {
            self.renderer = renderer
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }
            Task { @MainActor [weak renderer] in
                switch type {
                case "ready":
                    renderer?.markReady()
                case "error":
                    renderer?.markError((body["message"] as? String) ?? "Live2D runtime failed")
                default:
                    break
                }
            }
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            Task { @MainActor [weak renderer] in
                renderer?.markError(error.localizedDescription)
            }
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            Task { @MainActor [weak renderer] in
                renderer?.markError(error.localizedDescription)
            }
        }

        func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
            guard let url = urlSchemeTask.request.url,
                  let fileURL = bundleURL(for: url),
                  let data = try? Data(contentsOf: fileURL) else {
                urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
                return
            }

            let response = URLResponse(
                url: url,
                mimeType: mimeType(for: fileURL),
                expectedContentLength: data.count,
                textEncodingName: nil
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        }

        func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

        private func bundleURL(for url: URL) -> URL? {
            let fileName = url.lastPathComponent
            guard !fileName.isEmpty else { return nil }

            if let directURL = Bundle.main.resourceURL?.appendingPathComponent(fileName),
               FileManager.default.fileExists(atPath: directURL.path) {
                return directURL
            }

            let name = (fileName as NSString).deletingPathExtension
            let ext = (fileName as NSString).pathExtension
            return Bundle.main.url(forResource: name, withExtension: ext.isEmpty ? nil : ext)
        }

        private func mimeType(for fileURL: URL) -> String {
            switch fileURL.pathExtension.lowercased() {
            case "js":
                return "application/javascript"
            case "json":
                return "application/json"
            case "png":
                return "image/png"
            default:
                return "application/octet-stream"
            }
        }
    }
}
